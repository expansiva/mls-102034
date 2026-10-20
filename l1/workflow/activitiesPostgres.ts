/// <mls fileReference="_102034_/l1/workflow/activitiesPostgres.ts" enhancement="_blank"/>
import type { Pool, PoolClient } from 'pg';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { getSharedPgPool, queryRows, withPgTransaction } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import type { ResolvedTableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import { findResolvedTableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import type { OccurrenceKey, TaskOccurrenceSnapshot } from '/_102034_/l1/workflow/contracts.js';
import { projectWorkflowActivities, type WorkflowActivity } from '/_102034_/l1/workflow/activities.js';
import type {
  WorkflowActivityListItem,
  WorkflowActivityListQuery,
  WorkflowActivityListResult,
  WorkflowActivityRefreshResult,
  WorkflowActivityStore,
} from '/_102034_/l1/workflow/activitiesStore.js';

const SOURCE_TIMEOUT_MS = 30_000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 200;
const TASKS_REPOSITORY = 'workflowProjectionTasks';
const ACTIVITIES_REPOSITORY = 'workflowProjectionActivities';
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const TASK_COLUMNS = [
  'projectId', 'moduleId', 'taskId', 'processId', 'entity', 'recordId', 'workflowVersion',
  'revision', 'syncedAt', 'status', 'taskTitle', 'processTitle', 'moduleTitle',
] as const;

const ACTIVITY_COLUMNS = [
  'projectId', 'moduleId', 'taskId', 'stepKey', 'title', 'kind', 'ownerKind',
  'actorRef', 'journeyRef', 'functionRef', 'actorNow', 'pass', 'state', 'actionable',
] as const;

export interface PostgresWorkflowActivityDefinitions {
  tasks: ResolvedTableDefinition;
  activities: ResolvedTableDefinition;
}

export interface PostgresWorkflowActivityStoreOptions {
  projectId: string;
  moduleId: string;
  env?: AppEnv;
  pool?: Pool;
  definitions?: PostgresWorkflowActivityDefinitions;
}

interface TaskHeaderRow {
  taskId: string;
  revision: number;
}

interface ActivityRecord {
  stepKey: string;
  title: string;
  kind: WorkflowActivity['kind'];
  ownerKind: WorkflowActivity['ownerKind'];
  actorRef: string | null;
  journeyRef: string | null;
  functionRef: string | null;
  actorNow: string | null;
  pass: number;
  state: WorkflowActivity['state'];
  actionable: boolean;
}

interface ListRow extends ActivityRecord {
  projectId: string;
  moduleId: string;
  taskId: string;
  processId: string;
  entity: string;
  recordId: string;
  workflowVersion: string | null;
  revision: number;
  syncedAt: string;
  status: TaskOccurrenceSnapshot['status'];
  taskTitle: string;
  processTitle: string;
  moduleTitle: string;
}

interface CursorPayload {
  v: 1;
  projectId: string;
  moduleId: string;
  personMdmId: string;
  actorRefs: string[];
  includeNonActionable: boolean;
  taskId: string;
  stepKey: string;
}

interface ReadyStore {
  pool: Pool;
  definitions: PostgresWorkflowActivityDefinitions;
}

export function workflowProjectionLockToken(
  projectId: string,
  moduleId: string,
  key: Pick<OccurrenceKey, 'processId' | 'entity' | 'recordId'>,
): string {
  return JSON.stringify([
    'workflow-projection-v1',
    projectId,
    moduleId,
    key.processId,
    key.entity,
    key.recordId,
  ]);
}

export function createPostgresWorkflowActivityStore(
  options: PostgresWorkflowActivityStoreOptions,
): WorkflowActivityStore {
  const projectId = requireScopeId(options.projectId, 'projectId');
  const moduleId = requireScopeId(options.moduleId, 'moduleId');
  if (options.definitions) validateDefinitions(options.definitions);
  const boundEnv = options.env;
  if (!options.pool && (boundEnv ?? readAppEnv()).runtimeMode === 'memory') {
    throw new AppError(
      'WORKFLOW_PROJECTION_RUNTIME_INVALID',
      'Workflow projection does not run on the memory runtime.',
      400,
    );
  }

  let pool = options.pool;
  let definitions = options.definitions;

  async function ready(): Promise<ReadyStore> {
    const env = boundEnv ?? readAppEnv();
    if (!pool) {
      if (env.runtimeMode === 'memory') {
        throw new AppError(
          'WORKFLOW_PROJECTION_RUNTIME_INVALID',
          'Workflow projection does not run on the memory runtime.',
          400,
        );
      }
      pool = getSharedPgPool(env);
    }
    if (!definitions) {
      definitions = {
        tasks: await findResolvedTableDefinition(TASKS_REPOSITORY, env),
        activities: await findResolvedTableDefinition(ACTIVITIES_REPOSITORY, env),
      };
      validateDefinitions(definitions);
    }
    return { pool, definitions };
  }

  return {
    projectId,
    moduleId,
    async refresh(ctx, key, loadOccurrence) {
      assertSessionScope(projectId, ctx);
      assertKeyScope(projectId, moduleId, key);
      const resolved = await ready();
      try {
        return await withPgTransaction(resolved.pool, async (client) => {
          await client.query("SET LOCAL lock_timeout = '5s'");
          await client.query("SET LOCAL statement_timeout = '30s'");
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
            workflowProjectionLockToken(projectId, moduleId, key),
          ]);
          const occurrence = await awaitSource(loadOccurrence);
          if (occurrence === null) {
            await deleteRef(client, resolved.definitions, projectId, moduleId, key);
            return { state: 'absent', occurrence: null };
          }
          assertSnapshotScope(projectId, moduleId, key, occurrence);
          const projected = projectWorkflowActivities(occurrence);
          const header = await loadHeader(client, resolved.definitions.tasks, projectId, moduleId, key);
          if (header) {
            if (header.taskId !== projected.taskId || projected.revision < header.revision) {
              throw new AppError(
                'WORKFLOW_PROJECTION_SOURCE_STALE',
                'Workflow source is older than the stored projection.',
                503,
              );
            }
          }
          await deleteRef(client, resolved.definitions, projectId, moduleId, key);
          await insertHeader(client, resolved.definitions.tasks, projected, ctx.clock.nowIso());
          await insertActivities(client, resolved.definitions.activities, projected.taskId, projectId, moduleId, projected.activities);
          const result: WorkflowActivityRefreshResult = { state: 'synced', occurrence };
          return result;
        });
      } catch (error) {
        throw sanitizeError(error, 'Workflow projection could not be updated.');
      }
    },
    async list(ctx, query) {
      assertSessionScope(projectId, ctx);
      const subject = normalizeSubject(query);
      const pageSize = normalizePageSize(query.pageSize);
      const includeNonActionable = query.includeNonActionable === true;
      const cursor = query.cursor === undefined
        ? undefined
        : decodeCursor(query.cursor, projectId, moduleId, subject, includeNonActionable);
      const resolved = await ready();
      try {
        const rows = await queryRows<ListRow>(
          resolved.pool,
          listSql(resolved.definitions, cursor !== undefined),
          cursor === undefined
            ? [projectId, moduleId, subject.personMdmId, subject.actorRefs, includeNonActionable, pageSize + 1]
            : [projectId, moduleId, subject.personMdmId, subject.actorRefs, includeNonActionable, cursor.taskId, cursor.stepKey, pageSize + 1],
        );
        const page = rows.length > pageSize ? rows.slice(0, pageSize) : rows;
        const last = page[page.length - 1];
        const result: WorkflowActivityListResult = { items: page.map(toListItem) };
        if (rows.length > pageSize && last) {
          result.cursor = encodeCursor({
            v: 1,
            projectId,
            moduleId,
            personMdmId: subject.personMdmId,
            actorRefs: subject.actorRefs,
            includeNonActionable,
            taskId: last.taskId,
            stepKey: last.stepKey,
          });
        }
        return result;
      } catch (error) {
        throw sanitizeError(error, 'Workflow projection could not be read.');
      }
    },
  };
}

function requireScopeId(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) {
    throw new AppError('MSG_APP_SCOPE_INVALID', `Workflow projection ${field} is empty.`, 400);
  }
  return value;
}

function assertSessionScope(projectId: string, ctx: RequestContext): void {
  const sessionProject = ctx.sessionContext?.project?.projectId;
  if (sessionProject !== undefined && sessionProject !== projectId) {
    throw new AppError('MSG_APP_SCOPE_INVALID', 'Module operation is outside the configured application.', 400);
  }
}

function assertKeyScope(projectId: string, moduleId: string, key: OccurrenceKey): void {
  if (key.project !== projectId || key.module !== moduleId) {
    throw new AppError('MSG_APP_SCOPE_INVALID', 'Module operation is outside the configured application.', 400);
  }
  if (
    typeof key.processId !== 'string' || key.processId === ''
    || typeof key.entity !== 'string' || key.entity === ''
    || typeof key.recordId !== 'string' || key.recordId === ''
  ) {
    throw new AppError('MSG_APP_SCOPE_INVALID', 'Workflow occurrence key is outside the configured application.', 400);
  }
}

function assertSnapshotScope(
  projectId: string,
  moduleId: string,
  key: OccurrenceKey,
  occurrence: TaskOccurrenceSnapshot,
): void {
  const ref = occurrence.ref;
  if (
    ref.project !== projectId
    || ref.module !== moduleId
    || ref.processId !== key.processId
    || ref.entity !== key.entity
    || ref.recordId !== key.recordId
    || occurrence.taskId.trim() === ''
    || !Number.isInteger(occurrence.revision)
  ) {
    throw new AppError('WORKFLOW_PROJECTION_INVALID', 'Workflow projection source does not match the occurrence.', 502);
  }
}

async function awaitSource(
  loadOccurrence: () => Promise<TaskOccurrenceSnapshot | null>,
): Promise<TaskOccurrenceSnapshot | null> {
  const pending = loadOccurrence();
  pending.then(() => undefined, () => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new AppError(
            'WORKFLOW_PROJECTION_SOURCE_TIMEOUT',
            'Workflow source did not answer in time.',
            504,
          ));
        }, SOURCE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function quoteIdent(identifier: string): string {
  if (!IDENTIFIER.test(identifier)) {
    throw new AppError('WORKFLOW_PROJECTION_RUNTIME_INVALID', 'Workflow projection table name is not valid.', 500);
  }
  return `"${identifier}"`;
}

function validateDefinitions(definitions: PostgresWorkflowActivityDefinitions): void {
  assertTable(definitions.tasks, TASKS_REPOSITORY, TASK_COLUMNS, ['projectId', 'moduleId', 'taskId']);
  assertTable(definitions.activities, ACTIVITIES_REPOSITORY, ACTIVITY_COLUMNS, ['projectId', 'moduleId', 'taskId', 'stepKey']);
  if (definitions.tasks.tableName === definitions.activities.tableName) {
    throw new AppError('WORKFLOW_PROJECTION_RUNTIME_INVALID', 'Workflow projection tables are not distinct.', 500);
  }
}

function assertTable(
  definition: ResolvedTableDefinition,
  repositoryName: string,
  columns: readonly string[],
  primaryKey: string[],
): void {
  const names = definition.columns.map((column) => column.name);
  if (
    definition.repositoryName !== repositoryName
    || definition.storageProfile !== 'postgres'
    || definition.moduleId !== 'platform'
    || names.length !== columns.length
    || columns.some((column) => !names.includes(column))
    || definition.primaryKey.length !== primaryKey.length
    || definition.primaryKey.some((column, index) => column !== primaryKey[index])
    || !IDENTIFIER.test(definition.tableName)
  ) {
    throw new AppError('WORKFLOW_PROJECTION_RUNTIME_INVALID', 'Workflow projection table definition is not valid.', 500);
  }
}

async function loadHeader(
  client: PoolClient,
  definition: ResolvedTableDefinition,
  projectId: string,
  moduleId: string,
  key: OccurrenceKey,
): Promise<TaskHeaderRow | null> {
  const table = quoteIdent(definition.tableName);
  const rows = await queryRows<TaskHeaderRow>(
    client,
    `SELECT "taskId", "revision"
     FROM ${table}
     WHERE "projectId" = $1 AND "moduleId" = $2 AND "processId" = $3 AND "entity" = $4 AND "recordId" = $5
     FOR UPDATE`,
    [projectId, moduleId, key.processId, key.entity, key.recordId],
  );
  return rows[0] ?? null;
}

async function deleteRef(
  client: PoolClient,
  definitions: PostgresWorkflowActivityDefinitions,
  projectId: string,
  moduleId: string,
  key: OccurrenceKey,
): Promise<void> {
  const tasks = quoteIdent(definitions.tasks.tableName);
  const activities = quoteIdent(definitions.activities.tableName);
  const params = [projectId, moduleId, key.processId, key.entity, key.recordId];
  await client.query(
    `DELETE FROM ${activities}
     WHERE "projectId" = $1 AND "moduleId" = $2 AND "taskId" IN (
       SELECT "taskId" FROM ${tasks}
       WHERE "projectId" = $1 AND "moduleId" = $2 AND "processId" = $3 AND "entity" = $4 AND "recordId" = $5
     )`,
    params,
  );
  await client.query(
    `DELETE FROM ${tasks}
     WHERE "projectId" = $1 AND "moduleId" = $2 AND "processId" = $3 AND "entity" = $4 AND "recordId" = $5`,
    params,
  );
}

async function insertHeader(
  client: PoolClient,
  definition: ResolvedTableDefinition,
  projected: ReturnType<typeof projectWorkflowActivities>,
  syncedAt: string,
): Promise<void> {
  const table = quoteIdent(definition.tableName);
  await client.query(
    `INSERT INTO ${table} (
      "projectId", "moduleId", "taskId", "processId", "entity", "recordId", "workflowVersion",
      "revision", "syncedAt", "status", "taskTitle", "processTitle", "moduleTitle"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      projected.ref.project,
      projected.ref.module,
      projected.taskId,
      projected.ref.processId,
      projected.ref.entity,
      projected.ref.recordId,
      projected.ref.workflowVersion,
      projected.revision,
      syncedAt,
      projected.taskStatus,
      projected.taskTitle,
      projected.processTitle,
      projected.moduleTitle,
    ],
  );
}

async function insertActivities(
  client: PoolClient,
  definition: ResolvedTableDefinition,
  taskId: string,
  projectId: string,
  moduleId: string,
  activities: WorkflowActivity[],
): Promise<void> {
  if (activities.length === 0) return;
  const table = quoteIdent(definition.tableName);
  const payload = activities.map((activity) => ({
    stepKey: activity.stepKey,
    title: activity.title,
    kind: activity.kind,
    ownerKind: activity.ownerKind,
    actorRef: activity.actorRef ?? null,
    journeyRef: activity.journeyRef ?? null,
    functionRef: activity.functionRef ?? null,
    actorNow: activity.actorNow,
    pass: activity.pass,
    state: activity.state,
    actionable: activity.actionable,
  }));
  await client.query(
    `INSERT INTO ${table} (
      "projectId", "moduleId", "taskId", "stepKey", "title", "kind", "ownerKind",
      "actorRef", "journeyRef", "functionRef", "actorNow", "pass", "state", "actionable"
    )
    SELECT $1, $2, $3, row."stepKey", row."title", row."kind", row."ownerKind",
      row."actorRef", row."journeyRef", row."functionRef", row."actorNow", row."pass", row."state", row."actionable"
    FROM jsonb_to_recordset($4::jsonb) AS row(
      "stepKey" text,
      "title" text,
      "kind" text,
      "ownerKind" text,
      "actorRef" text,
      "journeyRef" text,
      "functionRef" text,
      "actorNow" text,
      "pass" integer,
      "state" text,
      "actionable" boolean
    )`,
    [projectId, moduleId, taskId, JSON.stringify(payload)],
  );
}

function listSql(definitions: PostgresWorkflowActivityDefinitions, paged: boolean): string {
  const tasks = quoteIdent(definitions.tasks.tableName);
  const activities = quoteIdent(definitions.activities.tableName);
  const cursorSql = paged
    ? 'AND (activity."taskId", activity."stepKey") > ($6::text, $7::text)'
    : '';
  const limit = paged ? '$8' : '$6';
  return `SELECT
    task."projectId", task."moduleId", task."taskId", task."processId", task."entity", task."recordId",
    task."workflowVersion", task."revision", task."syncedAt", task."status", task."taskTitle",
    task."processTitle", task."moduleTitle",
    activity."stepKey", activity."title", activity."kind", activity."ownerKind", activity."actorRef",
    activity."journeyRef", activity."functionRef", activity."actorNow", activity."pass", activity."state",
    activity."actionable"
  FROM ${tasks} AS task
  INNER JOIN ${activities} AS activity
    ON activity."projectId" = task."projectId"
    AND activity."moduleId" = task."moduleId"
    AND activity."taskId" = task."taskId"
  WHERE task."projectId" = $1 AND task."moduleId" = $2
    AND (
      activity."actorNow" = $3
      OR (activity."actorNow" IS NULL AND activity."actorRef" = ANY($4::text[]))
    )
    AND ($5::boolean OR activity."actionable" = TRUE)
    ${cursorSql}
  ORDER BY activity."taskId", activity."stepKey"
  LIMIT ${limit}`;
}

function normalizeSubject(query: WorkflowActivityListQuery): { personMdmId: string; actorRefs: string[] } {
  const personMdmId = query.subject?.personMdmId;
  if (typeof personMdmId !== 'string' || personMdmId.trim() === '' || personMdmId !== personMdmId.trim()) {
    throw new AppError('WORKFLOW_PROJECTION_QUERY_INVALID', 'Workflow subject is required.', 400);
  }
  const seen = new Set<string>();
  const actorRefs: string[] = [];
  for (const actorRef of query.subject.actorRefs ?? []) {
    if (typeof actorRef !== 'string' || actorRef.trim() === '' || actorRef !== actorRef.trim() || seen.has(actorRef)) {
      throw new AppError('WORKFLOW_PROJECTION_QUERY_INVALID', 'Workflow subject roles are not valid.', 400);
    }
    seen.add(actorRef);
    actorRefs.push(actorRef);
  }
  return { personMdmId, actorRefs };
}

function normalizePageSize(pageSize: number | undefined): number {
  if (pageSize === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new AppError('WORKFLOW_PROJECTION_QUERY_INVALID', 'Page size is not valid.', 400);
  }
  return Math.min(pageSize, MAX_PAGE_SIZE);
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(
  cursor: string,
  projectId: string,
  moduleId: string,
  subject: { personMdmId: string; actorRefs: string[] },
  includeNonActionable: boolean,
): CursorPayload {
  let parsed: CursorPayload;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorPayload;
  } catch {
    throw new AppError('WORKFLOW_PROJECTION_QUERY_INVALID', 'Workflow cursor is not valid.', 400);
  }
  const refs = parsed.actorRefs;
  const sameRefs = Array.isArray(refs)
    && refs.length === subject.actorRefs.length
    && refs.every((actorRef, index) => actorRef === subject.actorRefs[index]);
  if (
    parsed.v !== 1
    || parsed.projectId !== projectId
    || parsed.moduleId !== moduleId
    || parsed.personMdmId !== subject.personMdmId
    || parsed.includeNonActionable !== includeNonActionable
    || !sameRefs
    || typeof parsed.taskId !== 'string' || parsed.taskId === ''
    || typeof parsed.stepKey !== 'string' || parsed.stepKey === ''
  ) {
    throw new AppError('WORKFLOW_PROJECTION_QUERY_INVALID', 'Workflow cursor is not valid.', 400);
  }
  return parsed;
}

function toListItem(row: ListRow): WorkflowActivityListItem {
  const activity: WorkflowActivity = {
    stepKey: row.stepKey,
    title: row.title,
    kind: row.kind,
    ownerKind: row.ownerKind,
    actorNow: row.actorNow,
    pass: row.pass,
    state: row.state,
    actionable: row.actionable,
  };
  if (row.actorRef !== null) activity.actorRef = row.actorRef;
  if (row.journeyRef !== null) activity.journeyRef = row.journeyRef;
  if (row.functionRef !== null) activity.functionRef = row.functionRef;
  return {
    projectId: row.projectId,
    moduleId: row.moduleId,
    taskId: row.taskId,
    ref: {
      project: row.projectId,
      module: row.moduleId,
      processId: row.processId,
      entity: row.entity,
      recordId: row.recordId,
      workflowVersion: row.workflowVersion,
    },
    revision: row.revision,
    syncedAt: row.syncedAt,
    status: row.status,
    taskTitle: row.taskTitle,
    processTitle: row.processTitle,
    moduleTitle: row.moduleTitle,
    activity,
  };
}

function sanitizeError(error: unknown, message: string): AppError {
  if (error instanceof AppError) return error;
  return new AppError('WORKFLOW_PROJECTION_UNAVAILABLE', message, 503);
}
