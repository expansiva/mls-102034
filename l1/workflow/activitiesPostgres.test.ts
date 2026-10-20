/// <mls fileReference="_102034_/l1/workflow/activitiesPostgres.test.ts" enhancement="_blank"/>
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { queryRows } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import type { ResolvedTableDefinition, TableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import { buildCreateIndexSql, buildCreateTableSql } from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';
import { tableDefinitions } from '/_102034_/l1/server/persistence.js';
import type { OccurrenceKey, TaskOccurrenceSnapshot } from '/_102034_/l1/workflow/contracts.js';
import { prepareWorkflowPlan, type WorkflowPlan } from '/_102034_/l1/workflow/plan.js';
import {
  createPostgresWorkflowActivityStore,
  workflowProjectionLockToken,
  type PostgresWorkflowActivityDefinitions,
} from '/_102034_/l1/workflow/activitiesPostgres.js';

const integration = process.env.RUN_INTEGRATION_TESTS === 'true' && process.env.WORKFLOW_TEST_PG_URL !== undefined && process.env.WORKFLOW_TEST_PG_URL !== '';

function ctx(projectId = 'app-a'): RequestContext {
  return {
    clock: { nowIso: () => '2026-10-20T12:00:00.000Z' },
    sessionContext: { project: { projectId } },
  } as RequestContext;
}

function plan(): WorkflowPlan {
  return prepareWorkflowPlan({
    processId: 'proc',
    title: 'Process title',
    moduleTitle: 'Module title',
    steps: [
      { stepId: 'review', kind: 'human', title: 'Review', next: ['wait'], actorRef: 'role.reviewer' },
      { stepId: 'wait', kind: 'wait', title: 'Wait', next: [] },
    ],
  });
}

function occurrence(input: {
  project?: string;
  module?: string;
  recordId?: string;
  taskId?: string;
  revision?: number;
  status?: TaskOccurrenceSnapshot['status'];
  actorNow?: string | null;
  title?: string;
}): TaskOccurrenceSnapshot {
  const actorNow = input.actorNow === undefined ? 'person-1' : input.actorNow;
  return {
    ref: {
      project: input.project ?? 'app-a',
      module: input.module ?? 'mod-a',
      processId: 'proc',
      entity: 'order',
      recordId: input.recordId ?? 'rec-1',
      workflowVersion: 'v1',
    },
    plan: plan(),
    title: input.title ?? 'Task title',
    // One Task per ref: tests share a schema, so a fixed task id would collide on the header key.
    taskId: input.taskId ?? `task-${input.recordId ?? 'rec-1'}`,
    revision: input.revision ?? 1,
    status: input.status ?? 'in progress',
    owner: 'person-1',
    origin: { kind: 'screen', by: 'person-1' },
    room: { mode: 'person' },
    roomId: 'room-1',
    step: 'review',
    actorNow,
    done: false,
    pass: 1,
    history: [{
      at: '2026-10-20T00:00:00.000Z',
      by: 'person-1',
      from: null,
      step: 'review',
      actorNow,
      done: false,
      commandId: 'cmd-1',
      executor: { kind: 'person', mdmId: 'person-1' },
    }],
  };
}

function keyOf(snapshot: TaskOccurrenceSnapshot): OccurrenceKey {
  const { workflowVersion: _version, ...key } = snapshot.ref;
  return key;
}

function definitionsFor(projectId: string): PostgresWorkflowActivityDefinitions {
  const tasks = tableDefinitions.find((definition) => definition.repositoryName === 'workflowProjectionTasks');
  const activities = tableDefinitions.find((definition) => definition.repositoryName === 'workflowProjectionActivities');
  if (!tasks || !activities) throw new Error('workflow projection definitions are missing');
  return { tasks: resolve(tasks, projectId), activities: resolve(activities, projectId) };
}

function resolve(definition: TableDefinition, projectId: string): ResolvedTableDefinition {
  return {
    ...definition,
    projectId,
    repositoryName: definition.repositoryName ?? definition.tableName,
    logicalTableName: definition.tableName,
    dynamoResolvedTableName: null,
  };
}

function createBarrier() {
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolveWait) => {
    release = resolveWait;
  });
  return { wait, release: () => release() };
}

async function advisoryWaiters(pool: Pool, lockKey: string): Promise<number> {
  const rows = await queryRows<{ waiting: number }>(
    pool,
    `SELECT COUNT(*)::int AS waiting
     FROM pg_locks
     WHERE locktype = 'advisory'
       AND NOT granted
       AND classid = ((hashtextextended($1, 0) >> 32) & 4294967295)::oid
       AND objid = (hashtextextended($1, 0) & 4294967295)::oid
       AND objsubid = 1`,
    [lockKey],
  );
  return rows[0]?.waiting ?? 0;
}

async function waitUntil(predicate: () => Promise<boolean>): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - started > 4000) throw new Error('timed out waiting for postgres advisory lock');
    await new Promise((resolveWait) => setTimeout(resolveWait, 15));
  }
}

function localTestUrl(): string {
  const raw = process.env.WORKFLOW_TEST_PG_URL ?? '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('WORKFLOW_TEST_PG_URL must be a local collab_app_test URL');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || database !== 'collab_app_test') {
    throw new Error('WORKFLOW_TEST_PG_URL must be a local collab_app_test URL');
  }
  return raw;
}

let pool: Pool | undefined;
let schema = '';
let ready: Promise<void> | undefined;
let tail: Promise<void> = Promise.resolve();

function serial<T>(run: () => Promise<T>): Promise<T> {
  const next = tail.then(run, run);
  tail = next.then(() => undefined, () => undefined);
  return next;
}

async function pg(): Promise<Pool> {
  if (!ready) {
    schema = `workflow_projection_${randomBytes(8).toString('hex')}`;
    const connectionString = new URL(localTestUrl());
    connectionString.searchParams.set('options', `-c search_path=${schema}`);
    pool = new Pool({ connectionString: connectionString.toString(), max: 4 });
    ready = (async () => {
      const client = await pool!.connect();
      try {
        await client.query(`CREATE SCHEMA ${schema}`);
        await client.query(`SET search_path TO ${schema}`);
        const definitions = definitionsFor('app-a');
        await client.query(buildCreateTableSql(definitions.tasks));
        await client.query(buildCreateTableSql(definitions.activities));
        for (const sql of [...buildCreateIndexSql(definitions.tasks), ...buildCreateIndexSql(definitions.activities)]) {
          await client.query(sql);
        }
      } finally {
        client.release();
      }
    })();
  }
  await ready;
  return pool as Pool;
}

after(async () => {
  if (!pool || schema === '') return;
  const closing = pool;
  const name = schema;
  pool = undefined;
  try {
    await closing.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
  } finally {
    await closing.end();
  }
});

async function countTasks(client: Pool | PoolClient, recordId: string): Promise<number> {
  const rows = await queryRows<{ count: number }>(
    client,
    'SELECT COUNT(*)::int AS count FROM platform_workflow_projection_tasks WHERE "recordId" = $1',
    [recordId],
  );
  return rows[0]?.count ?? 0;
}

test('refuses a memory runtime, an empty scope and a foreign session before SQL', async () => {
  const memory = { runtimeMode: 'memory', appEnv: 'development' } as AppEnv;
  assert.throws(
    () => createPostgresWorkflowActivityStore({ projectId: 'app-a', moduleId: 'mod-a', env: memory }),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_PROJECTION_RUNTIME_INVALID',
  );
  assert.throws(
    () => createPostgresWorkflowActivityStore({ projectId: '', moduleId: 'mod-a', env: memory, pool: {} as Pool }),
    (error: unknown) => error instanceof AppError && error.code === 'MSG_APP_SCOPE_INVALID',
  );
  const store = createPostgresWorkflowActivityStore({
    projectId: 'app-a',
    moduleId: 'mod-a',
    env: memory,
    pool: { connect() { throw new Error('sql'); } } as unknown as Pool,
    definitions: definitionsFor('app-a'),
  });
  let loaded = false;
  await assert.rejects(
    () => store.refresh(ctx('other-app'), keyOf(occurrence({})), async () => {
      loaded = true;
      return null;
    }),
    (error: unknown) => error instanceof AppError && error.code === 'MSG_APP_SCOPE_INVALID' && error.statusCode === 400,
  );
  assert.equal(loaded, false);
  await assert.rejects(
    () => store.list(ctx(), { subject: { personMdmId: ' ' } }),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_PROJECTION_QUERY_INVALID',
  );
  await assert.rejects(
    () => store.list(ctx(), { subject: { personMdmId: 'person-1' }, cursor: 'not-a-cursor' }),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_PROJECTION_QUERY_INVALID',
  );
});

test('same ref serializes two connections and the second loader starts after the first', { skip: !integration, timeout: 10000 }, async () => serial(async () => {
  const shared = await pg();
  const definitions = definitionsFor('app-a');
  const store = createPostgresWorkflowActivityStore({ projectId: 'app-a', moduleId: 'mod-a', pool: shared, definitions });
  const snapshot = occurrence({ recordId: `serial-${randomBytes(3).toString('hex')}` });
  const key = keyOf(snapshot);
  const inside = createBarrier();
  const order: string[] = [];
  const first = store.refresh(ctx(), key, async () => {
    order.push('a-start');
    inside.release();
    await waitUntil(async () => (await advisoryWaiters(shared, workflowProjectionLockToken('app-a', 'mod-a', key))) >= 1);
    order.push('a-end');
    return snapshot;
  });
  await inside.wait;
  const second = store.refresh(ctx(), key, async () => {
    order.push('b');
    return { ...snapshot, revision: 2, title: 'Later' };
  });
  const results = await Promise.all([first, second]);
  assert.deepEqual(order, ['a-start', 'a-end', 'b']);
  assert.equal(results[1]?.state, 'synced');
  assert.equal(results[1]?.occurrence?.revision, 2);
}));

test('different refs progress on two connections', { skip: !integration, timeout: 10000 }, async () => serial(async () => {
  const shared = await pg();
  const store = createPostgresWorkflowActivityStore({
    projectId: 'app-a', moduleId: 'mod-a', pool: shared, definitions: definitionsFor('app-a'),
  });
  const left = occurrence({ recordId: `left-${randomBytes(3).toString('hex')}`, taskId: 'task-left' });
  const right = occurrence({ recordId: `right-${randomBytes(3).toString('hex')}`, taskId: 'task-right' });
  const leftInside = createBarrier();
  const rightInside = createBarrier();
  const releaseBoth = createBarrier();
  const first = store.refresh(ctx(), keyOf(left), async () => {
    leftInside.release();
    await rightInside.wait;
    await releaseBoth.wait;
    return left;
  });
  const second = store.refresh(ctx(), keyOf(right), async () => {
    rightInside.release();
    await leftInside.wait;
    return right;
  });
  await Promise.all([leftInside.wait, rightInside.wait]);
  releaseBoth.release();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((result) => result.state), ['synced', 'synced']);
}));

test('a failed insert rolls back the delete and keeps the previous rows', { skip: !integration, timeout: 10000 }, async () => serial(async () => {
  const shared = await pg();
  const store = createPostgresWorkflowActivityStore({
    projectId: 'app-a', moduleId: 'mod-a', pool: shared, definitions: definitionsFor('app-a'),
  });
  const snapshot = occurrence({ recordId: `rollback-${randomBytes(3).toString('hex')}` });
  await store.refresh(ctx(), keyOf(snapshot), async () => snapshot);
  await shared.query('ALTER TABLE platform_workflow_projection_activities ADD CONSTRAINT rt104_fail_insert CHECK (false) NOT VALID');
  try {
    await assert.rejects(
      () => store.refresh(ctx(), keyOf(snapshot), async () => ({ ...snapshot, revision: 2, title: 'Broken' })),
      (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_PROJECTION_UNAVAILABLE',
    );
    assert.equal(await countTasks(shared, snapshot.ref.recordId), 1);
    const titles = await queryRows<{ taskTitle: string }>(
      shared,
      'SELECT "taskTitle" FROM platform_workflow_projection_tasks WHERE "recordId" = $1',
      [snapshot.ref.recordId],
    );
    assert.equal(titles[0]?.taskTitle, 'Task title');
  } finally {
    await shared.query('ALTER TABLE platform_workflow_projection_activities DROP CONSTRAINT rt104_fail_insert');
  }
}));

test('lower revision and a foreign ref or task id do not change the index', { skip: !integration, timeout: 10000 }, async () => serial(async () => {
  const shared = await pg();
  const store = createPostgresWorkflowActivityStore({
    projectId: 'app-a', moduleId: 'mod-a', pool: shared, definitions: definitionsFor('app-a'),
  });
  const recordId = `stale-${randomBytes(3).toString('hex')}`;
  const current = occurrence({ recordId, revision: 3, title: 'Current' });
  await store.refresh(ctx(), keyOf(current), async () => current);
  await assert.rejects(
    () => store.refresh(ctx(), keyOf(current), async () => ({ ...current, revision: 2, title: 'Older' })),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_PROJECTION_SOURCE_STALE' && error.statusCode === 503,
  );
  await assert.rejects(
    () => store.refresh(ctx(), keyOf(current), async () => ({ ...current, taskId: 'task-other', revision: 4 })),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_PROJECTION_SOURCE_STALE',
  );
  const wrong = { ...current, revision: 4, ref: { ...current.ref, recordId: 'other-record' } };
  await assert.rejects(
    () => store.refresh(ctx(), keyOf(current), async () => wrong),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_PROJECTION_INVALID',
  );
  const broken = occurrence({ recordId, revision: 4 });
  broken.plan = { ...broken.plan, steps: [{ ...broken.plan.steps[0], next: ['missing'] }] };
  await assert.rejects(
    () => store.refresh(ctx(), keyOf(current), async () => broken),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_PROJECTION_INVALID',
  );
  const rows = await queryRows<{ taskTitle: string; revision: number; taskId: string }>(
    shared,
    'SELECT "taskTitle", "revision", "taskId" FROM platform_workflow_projection_tasks WHERE "recordId" = $1',
    [recordId],
  );
  assert.deepEqual(rows, [{ taskTitle: 'Current', revision: 3, taskId: current.taskId }]);
}));

test('the same revision updates a pause and a continue, and null removes only that ref', { skip: !integration, timeout: 10000 }, async () => serial(async () => {
  const shared = await pg();
  const store = createPostgresWorkflowActivityStore({
    projectId: 'app-a', moduleId: 'mod-a', pool: shared, definitions: definitionsFor('app-a'),
  });
  const recordId = `pause-${randomBytes(3).toString('hex')}`;
  const otherId = `keep-${randomBytes(3).toString('hex')}`;
  const current = occurrence({ recordId, revision: 4, status: 'in progress' });
  const other = occurrence({ recordId: otherId, taskId: 'task-keep', revision: 1 });
  await store.refresh(ctx(), keyOf(current), async () => current);
  await store.refresh(ctx(), keyOf(other), async () => other);
  const paused = await store.refresh(ctx(), keyOf(current), async () => ({ ...current, status: 'paused' }));
  assert.equal(paused.state, 'synced');
  const pausedRows = await queryRows<{ status: string; actionable: boolean }>(
    shared,
    `SELECT task."status", activity."actionable"
     FROM platform_workflow_projection_tasks AS task
     JOIN platform_workflow_projection_activities AS activity USING ("projectId", "moduleId", "taskId")
     WHERE task."recordId" = $1 AND activity."stepKey" = 'review'`,
    [recordId],
  );
  assert.deepEqual(pausedRows, [{ status: 'paused', actionable: false }]);
  await store.refresh(ctx(), keyOf(current), async () => ({ ...current, status: 'in progress', title: 'Continued' }));
  const continued = await queryRows<{ status: string; taskTitle: string; actionable: boolean }>(
    shared,
    `SELECT task."status", task."taskTitle", activity."actionable"
     FROM platform_workflow_projection_tasks AS task
     JOIN platform_workflow_projection_activities AS activity USING ("projectId", "moduleId", "taskId")
     WHERE task."recordId" = $1 AND activity."stepKey" = 'review'`,
    [recordId],
  );
  assert.deepEqual(continued, [{ status: 'in progress', taskTitle: 'Continued', actionable: true }]);
  const removed = await store.refresh(ctx(), keyOf(current), async () => null);
  assert.deepEqual(removed, { state: 'absent', occurrence: null });
  assert.equal(await countTasks(shared, recordId), 0);
  assert.equal(await countTasks(shared, otherId), 1);
}));

test('project and module scopes stay isolated and pages follow actor or role', { skip: !integration, timeout: 10000 }, async () => serial(async () => {
  const shared = await pg();
  // Pages are compared exactly, so start from empty tables in this test's own isolated schema.
  await shared.query('DELETE FROM platform_workflow_projection_activities');
  await shared.query('DELETE FROM platform_workflow_projection_tasks');
  const definitions = definitionsFor('app-a');
  const appA = createPostgresWorkflowActivityStore({ projectId: 'app-a', moduleId: 'mod-a', pool: shared, definitions });
  const appB = createPostgresWorkflowActivityStore({ projectId: 'app-b', moduleId: 'mod-a', pool: shared, definitions });
  const moduleB = createPostgresWorkflowActivityStore({ projectId: 'app-a', moduleId: 'mod-b', pool: shared, definitions });
  const suffix = randomBytes(3).toString('hex');
  const own = occurrence({ recordId: `own-${suffix}`, taskId: `task-own-${suffix}`, actorNow: 'person-1' });
  const sharedRole = occurrence({
    recordId: `role-${suffix}`, taskId: `task-role-${suffix}`, actorNow: null, title: 'Unassigned',
  });
  const paused = occurrence({
    recordId: `paused-${suffix}`, taskId: `task-paused-${suffix}`, actorNow: 'person-1', status: 'paused',
  });
  const otherPerson = occurrence({
    recordId: `other-${suffix}`, taskId: `task-other-${suffix}`, actorNow: 'person-2',
  });
  const foreignApp = occurrence({
    project: 'app-b', recordId: `foreign-${suffix}`, taskId: `task-foreign-${suffix}`, actorNow: 'person-1',
  });
  const foreignModule = occurrence({
    module: 'mod-b', recordId: `module-${suffix}`, taskId: `task-module-${suffix}`, actorNow: 'person-1',
  });
  await appA.refresh(ctx(), keyOf(own), async () => own);
  await appA.refresh(ctx(), keyOf(sharedRole), async () => sharedRole);
  await appA.refresh(ctx(), keyOf(paused), async () => paused);
  await appA.refresh(ctx(), keyOf(otherPerson), async () => otherPerson);
  await appB.refresh(ctx('app-b'), keyOf(foreignApp), async () => foreignApp);
  await moduleB.refresh(ctx(), keyOf(foreignModule), async () => foreignModule);

  const query = { subject: { personMdmId: 'person-1', actorRefs: ['role.reviewer'] }, pageSize: 1 };
  const first = await appA.list(ctx(), query);
  const second = first.cursor ? await appA.list(ctx(), { ...query, cursor: first.cursor }) : { items: [], cursor: undefined };
  const seen = [...first.items, ...second.items].map((item) => item.taskId);
  assert.deepEqual(seen, [`task-own-${suffix}`, `task-role-${suffix}`]);
  assert.equal(second.cursor, undefined);
  for (const item of [...first.items, ...second.items]) {
    assert.equal(typeof item.syncedAt, 'string');
    assert.equal(new Date(item.syncedAt).toISOString(), item.syncedAt);
    assert.equal(Number.isInteger(item.revision), true);
  }
  assert.equal(seen.includes(`task-paused-${suffix}`), false);
  assert.equal(seen.includes(`task-other-${suffix}`), false);
  await assert.rejects(
    () => appA.list(ctx(), { ...query, subject: { personMdmId: 'person-9', actorRefs: ['role.reviewer'] }, cursor: first.cursor }),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_PROJECTION_QUERY_INVALID',
  );
  const other = await appA.list(ctx(), { subject: { personMdmId: 'person-2', actorRefs: [] } });
  assert.deepEqual(other.items.map((item) => item.taskId), [`task-other-${suffix}`]);
  const rolesOnly = await appA.list(ctx(), { subject: { personMdmId: 'person-9', actorRefs: [] } });
  assert.deepEqual(rolesOnly.items, []);
  const withPaused = await appA.list(ctx(), {
    subject: { personMdmId: 'person-1', actorRefs: ['role.reviewer'] },
    includeNonActionable: true,
  });
  assert.equal(withPaused.items.some((item) => item.activity.stepKey === 'wait'), false);
  assert.equal(withPaused.items.some((item) => item.taskId === `task-paused-${suffix}` && item.activity.actionable === false), true);
  assert.equal(withPaused.items.some((item) => item.taskId === `task-other-${suffix}`), false);
  const foreign = await appB.list(ctx('app-b'), { subject: { personMdmId: 'person-1', actorRefs: ['role.reviewer'] } });
  assert.deepEqual(foreign.items.map((item) => item.ref.recordId), [`foreign-${suffix}`]);
}));
