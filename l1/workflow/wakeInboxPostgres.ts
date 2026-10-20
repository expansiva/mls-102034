/// <mls fileReference="_102034_/l1/workflow/wakeInboxPostgres.ts" enhancement="_blank"/>
import type { Pool, PoolClient } from 'pg';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { getSharedPgPool, queryRows } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import type { ResolvedTableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import { findResolvedTableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import type { ModuleWakeEvent } from '/_102036_/l2/shared/interfaces.js';
import {
  parseWorkflowWakeEvent,
  sameWorkflowWakeIdentity,
  type WorkflowWakeDispatchResult,
  type WorkflowWakeEnqueueResult,
  type WorkflowWakeInbox,
  type WorkflowWakeRunNextResult,
} from '/_102034_/l1/workflow/wakeContracts.js';

const REPOSITORY = 'workflowWakeInbox';
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ERROR_CODE = /^WORKFLOW_WAKE_[A-Z0-9_]{1,48}$/;
const COLUMNS = [
  'projectId', 'eventId', 'moduleId', 'processId', 'entity', 'recordId', 'taskId',
  'payload', 'state', 'outcome', 'receivedAt', 'nextAttemptAt', 'completedAt',
  'attempts', 'lastErrorCode',
] as const;

/**
 * runNext keeps this transaction open for the whole dispatch Promise so the
 * advisory lock lasts until commit or rollback. A connection or process loss
 * can drop that exclusion; the handler effect must stay idempotent by
 * `wake:<eventId>`. This is at-least-once, not exactly-once.
 * The database must not use an idle-in-transaction timeout shorter than the
 * handler. This store does not change that installation setting.
 */
const LOCK_PREFIX = 'workflow-wake-inbox-v1';

export interface PostgresWorkflowWakeInboxOptions {
  projectId: string;
  env?: AppEnv;
  pool?: Pool;
  definition?: ResolvedTableDefinition;
}

interface InboxRow {
  eventId: string;
  payload: unknown;
  state: string;
  outcome: string | null;
  attempts: number;
}

interface ReadyStore {
  pool: Pool;
  definition: ResolvedTableDefinition;
}

export function createPostgresWorkflowWakeInbox(
  options: PostgresWorkflowWakeInboxOptions,
): WorkflowWakeInbox {
  const projectId = requireProjectId(options.projectId);
  if (options.definition) validateDefinition(options.definition);
  const boundEnv = options.env;
  if (!options.pool && (boundEnv ?? readAppEnv()).runtimeMode === 'memory') {
    throw new AppError(
      'WORKFLOW_WAKE_RUNTIME_INVALID',
      'Workflow wake inbox does not run on the memory runtime.',
      400,
    );
  }

  let pool = options.pool;
  let definition = options.definition;

  async function ready(): Promise<ReadyStore> {
    const env = boundEnv ?? readAppEnv();
    if (!pool) {
      if (env.runtimeMode === 'memory') {
        throw new AppError(
          'WORKFLOW_WAKE_RUNTIME_INVALID',
          'Workflow wake inbox does not run on the memory runtime.',
          400,
        );
      }
      pool = getSharedPgPool(env);
    }
    if (!definition) {
      definition = await findResolvedTableDefinition(REPOSITORY, env);
      validateDefinition(definition);
    }
    return { pool, definition };
  }

  return {
    async enqueue(event) {
      const wire = parseWorkflowWakeEvent(event);
      if (wire.ref.project !== projectId) {
        throw new AppError(
          'WORKFLOW_WAKE_SCOPE_INVALID',
          'Wake event is outside the configured application.',
          400,
        );
      }
      const resolved = await ready();
      const client = await resolved.pool.connect();
      try {
        await client.query('BEGIN');
        const inserted = await insertPending(client, resolved.definition, wire);
        if (inserted) {
          await client.query('COMMIT');
          return acceptedReceipt(wire.eventId, 202);
        }
        const existing = await loadEvent(client, resolved.definition, projectId, wire.eventId);
        const stored = storedEvent(existing);
        if (!stored || !sameWorkflowWakeIdentity(stored, wire)) {
          await client.query('COMMIT');
          throw new AppError(
            'WORKFLOW_WAKE_IDENTITY_CONFLICT',
            'Wake event identity does not match the stored delivery.',
            409,
          );
        }
        if (existing.state === 'pending') {
          await client.query('COMMIT');
          return acceptedReceipt(wire.eventId, 202);
        }
        if (existing.state === 'completed' && (existing.outcome === 'accepted' || existing.outcome === 'stale')) {
          await client.query('COMMIT');
          return {
            receipt: { eventId: wire.eventId, outcome: existing.outcome },
            statusCode: 200,
          };
        }
        await client.query('COMMIT');
        throw new AppError('WORKFLOW_WAKE_UNAVAILABLE', 'Wake inbox row cannot be confirmed.', 503);
      } catch (error) {
        await rollbackQuiet(client);
        throw asUnavailable(error);
      } finally {
        client.release();
      }
    },

    async runNext(requestedProjectId, dispatch) {
      if (requestedProjectId !== projectId) {
        throw new AppError(
          'WORKFLOW_WAKE_SCOPE_INVALID',
          'Wake inbox is outside the configured application.',
          400,
        );
      }
      const resolved = await ready();
      const client = await resolved.pool.connect();
      let opened = false;
      try {
        await client.query('BEGIN');
        opened = true;
        const due = await lockDue(client, resolved.definition, projectId);
        if (!due) {
          await client.query('COMMIT');
          opened = false;
          return 'empty';
        }
        const event = storedEvent(due);
        if (!event || event.ref.project !== projectId) {
          throw new AppError('WORKFLOW_WAKE_UNAVAILABLE', 'Wake inbox row cannot be read.', 503);
        }
        const locked = await tryOccurrenceLock(client, event);
        if (!locked) {
          await postpone(client, resolved.definition, projectId, due.eventId, '1 second');
          await client.query('COMMIT');
          opened = false;
          return 'busy';
        }
        const result = await runDispatch(dispatch, event);
        if (result === 'accepted' || result === 'stale') {
          await complete(client, resolved.definition, projectId, due.eventId, result);
          await client.query('COMMIT');
          opened = false;
          return result;
        }
        await retryLater(client, resolved.definition, projectId, due.eventId, result.retry.code);
        await client.query('COMMIT');
        opened = false;
        return 'retry';
      } catch (error) {
        if (opened) await rollbackQuiet(client);
        throw asUnavailable(error);
      } finally {
        client.release();
      }
    },
  };
}

function acceptedReceipt(eventId: string, statusCode: 202): WorkflowWakeEnqueueResult {
  return { receipt: { eventId, outcome: 'accepted' }, statusCode };
}

function requireProjectId(value: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) {
    throw new AppError('WORKFLOW_WAKE_SCOPE_INVALID', 'Workflow wake projectId is empty.', 400);
  }
  return value;
}

function validateDefinition(definition: ResolvedTableDefinition): void {
  const names = definition.columns.map((column) => column.name);
  if (
    definition.repositoryName !== REPOSITORY
    || definition.storageProfile !== 'postgres'
    || definition.moduleId !== 'platform'
    || names.length !== COLUMNS.length
    || COLUMNS.some((column) => !names.includes(column))
    || definition.primaryKey.length !== 2
    || definition.primaryKey[0] !== 'projectId'
    || definition.primaryKey[1] !== 'eventId'
    || !IDENTIFIER.test(definition.tableName)
  ) {
    throw new AppError('WORKFLOW_WAKE_RUNTIME_INVALID', 'Workflow wake inbox table definition is not valid.', 500);
  }
}

function quoteIdent(identifier: string): string {
  if (!IDENTIFIER.test(identifier)) {
    throw new AppError('WORKFLOW_WAKE_RUNTIME_INVALID', 'Workflow wake inbox table name is not valid.', 500);
  }
  return `"${identifier}"`;
}

function wirePayload(event: ModuleWakeEvent): ModuleWakeEvent {
  return {
    eventId: event.eventId,
    scheduledAt: event.scheduledAt,
    attempt: event.attempt,
    ref: {
      project: event.ref.project,
      module: event.ref.module,
      entity: event.ref.entity,
      recordId: event.ref.recordId,
      processId: event.ref.processId,
      workflowVersion: event.ref.workflowVersion,
    },
    taskId: event.taskId,
    stepKey: event.stepKey,
    pass: event.pass,
    seq: event.seq,
    revision: event.revision,
    routine: event.routine,
  };
}

async function insertPending(
  client: PoolClient,
  definition: ResolvedTableDefinition,
  event: ModuleWakeEvent,
): Promise<boolean> {
  const table = quoteIdent(definition.tableName);
  const wire = wirePayload(event);
  const rows = await queryRows<{ eventId: string }>(
    client,
    `INSERT INTO ${table} (
      "projectId", "eventId", "moduleId", "processId", "entity", "recordId", "taskId",
      "payload", "state", "outcome", "receivedAt", "nextAttemptAt", "completedAt", "attempts", "lastErrorCode"
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8::jsonb, 'pending', NULL, NOW(), NOW(), NULL, 0, NULL
    )
    ON CONFLICT ("projectId", "eventId") DO NOTHING
    RETURNING "eventId"`,
    [
      event.ref.project,
      event.eventId,
      event.ref.module,
      event.ref.processId,
      event.ref.entity,
      event.ref.recordId,
      event.taskId,
      JSON.stringify(wire),
    ],
  );
  return rows.length > 0;
}

async function loadEvent(
  client: PoolClient,
  definition: ResolvedTableDefinition,
  projectId: string,
  eventId: string,
): Promise<InboxRow> {
  const table = quoteIdent(definition.tableName);
  const rows = await queryRows<InboxRow>(
    client,
    `SELECT "eventId", "payload", "state", "outcome", "attempts"
     FROM ${table}
     WHERE "projectId" = $1 AND "eventId" = $2
     FOR UPDATE`,
    [projectId, eventId],
  );
  const row = rows[0];
  if (!row) {
    throw new AppError('WORKFLOW_WAKE_UNAVAILABLE', 'Wake inbox row cannot be confirmed.', 503);
  }
  return row;
}

function storedEvent(row: InboxRow): ModuleWakeEvent | null {
  try {
    return parseWorkflowWakeEvent(row.payload);
  } catch (error) {
    if (error instanceof AppError && error.code === 'WORKFLOW_WAKE_EVENT_INVALID') return null;
    if (error instanceof AppError && error.code === 'WORKFLOW_WAKE_BODY_TOO_LARGE') return null;
    throw error;
  }
}

async function lockDue(
  client: PoolClient,
  definition: ResolvedTableDefinition,
  projectId: string,
): Promise<InboxRow | null> {
  const table = quoteIdent(definition.tableName);
  const rows = await queryRows<InboxRow>(
    client,
    `SELECT "eventId", "payload", "state", "outcome", "attempts"
     FROM ${table}
     WHERE "projectId" = $1 AND "state" = 'pending' AND "nextAttemptAt" <= NOW()
     ORDER BY "nextAttemptAt", "receivedAt", "eventId"
     FOR UPDATE SKIP LOCKED
     LIMIT 1`,
    [projectId],
  );
  return rows[0] ?? null;
}

function lockToken(event: ModuleWakeEvent): string {
  return JSON.stringify([
    LOCK_PREFIX,
    event.ref.project,
    event.ref.module,
    event.ref.processId,
    event.ref.entity,
    event.ref.recordId,
  ]);
}

async function tryOccurrenceLock(client: PoolClient, event: ModuleWakeEvent): Promise<boolean> {
  const rows = await queryRows<{ locked: boolean }>(
    client,
    'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked',
    [lockToken(event)],
  );
  return rows[0]?.locked === true;
}

async function postpone(
  client: PoolClient,
  definition: ResolvedTableDefinition,
  projectId: string,
  eventId: string,
  interval: '1 second' | '60 seconds',
): Promise<void> {
  const table = quoteIdent(definition.tableName);
  await client.query(
    `UPDATE ${table}
     SET "nextAttemptAt" = NOW() + INTERVAL '${interval}'
     WHERE "projectId" = $1 AND "eventId" = $2 AND "state" = 'pending'`,
    [projectId, eventId],
  );
}

async function complete(
  client: PoolClient,
  definition: ResolvedTableDefinition,
  projectId: string,
  eventId: string,
  outcome: 'accepted' | 'stale',
): Promise<void> {
  const table = quoteIdent(definition.tableName);
  await client.query(
    `UPDATE ${table}
     SET "state" = 'completed',
         "outcome" = $3,
         "completedAt" = NOW(),
         "nextAttemptAt" = NULL,
         "attempts" = "attempts" + 1,
         "lastErrorCode" = NULL
     WHERE "projectId" = $1 AND "eventId" = $2 AND "state" = 'pending'`,
    [projectId, eventId, outcome],
  );
}

async function retryLater(
  client: PoolClient,
  definition: ResolvedTableDefinition,
  projectId: string,
  eventId: string,
  code: string,
): Promise<void> {
  const table = quoteIdent(definition.tableName);
  await client.query(
    `UPDATE ${table}
     SET "state" = 'pending',
         "outcome" = NULL,
         "completedAt" = NULL,
         "nextAttemptAt" = NOW() + INTERVAL '60 seconds',
         "attempts" = "attempts" + 1,
         "lastErrorCode" = $3
     WHERE "projectId" = $1 AND "eventId" = $2 AND "state" = 'pending'`,
    [projectId, eventId, sanitizeCode(code)],
  );
}

async function runDispatch(
  dispatch: (event: ModuleWakeEvent) => Promise<WorkflowWakeDispatchResult>,
  event: ModuleWakeEvent,
): Promise<WorkflowWakeDispatchResult> {
  try {
    const result = await dispatch(event);
    if (result === 'accepted' || result === 'stale') return result;
    if (result && typeof result === 'object' && 'retry' in result && result.retry && typeof result.retry.code === 'string') {
      return { retry: { code: sanitizeCode(result.retry.code) } };
    }
    return { retry: { code: 'WORKFLOW_WAKE_HANDLER_FAILED' } };
  } catch (error) {
    const code = error instanceof AppError ? error.code : undefined;
    return { retry: { code: sanitizeCode(code) } };
  }
}

function sanitizeCode(code: string | undefined): string {
  if (code && ERROR_CODE.test(code)) return code;
  return 'WORKFLOW_WAKE_HANDLER_FAILED';
}

function asUnavailable(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError('WORKFLOW_WAKE_UNAVAILABLE', 'Wake inbox could not be updated.', 503);
}

async function rollbackQuiet(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The connection is already unusable. The caller still reports the original failure.
  }
}
