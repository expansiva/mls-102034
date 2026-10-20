/// <mls fileReference="_102034_/l1/workflow/wakeInboxPostgres.test.ts" enhancement="_blank"/>
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { queryRows } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import type { ResolvedTableDefinition, TableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import { buildCreateIndexSql, buildCreateTableSql } from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';
import { tableDefinitions } from '/_102034_/l1/server/persistence.js';
import type { ModuleWakeEvent } from '/_102036_/l2/shared/interfaces.js';
import { workflowWakeCommandId } from '/_102034_/l1/workflow/wakeContracts.js';
import { createPostgresWorkflowWakeInbox } from '/_102034_/l1/workflow/wakeInboxPostgres.js';

const integration = process.env.RUN_INTEGRATION_TESTS === 'true'
  && process.env.WORKFLOW_TEST_PG_URL !== undefined
  && process.env.WORKFLOW_TEST_PG_URL !== '';

function event(input: Partial<ModuleWakeEvent> & { recordId?: string; n?: number } = {}): ModuleWakeEvent {
  const recordId = input.recordId ?? input.ref?.recordId ?? 'rec-1';
  // One Task per record: a fixed task id would give two apps the same eventId, and rowOf reads by eventId.
  const taskId = input.taskId ?? `task-${recordId}`;
  const stepKey = input.stepKey ?? 'wait';
  const seq = input.seq ?? 1;
  const n = input.n ?? 1;
  return {
    eventId: input.eventId ?? `${taskId}:${stepKey}:${seq}:${n}`,
    scheduledAt: input.scheduledAt ?? '2026-10-20T12:00:00.000Z',
    attempt: input.attempt ?? 1,
    ref: {
      project: input.ref?.project ?? '102030',
      module: input.ref?.module ?? 'mod-a',
      entity: input.ref?.entity ?? 'order',
      recordId,
      processId: input.ref?.processId ?? 'proc',
      workflowVersion: input.ref?.workflowVersion === undefined ? 'v1' : input.ref.workflowVersion,
    },
    taskId,
    stepKey,
    pass: input.pass ?? 1,
    seq,
    revision: input.revision ?? 1,
    routine: input.routine ?? 'onWake',
  };
}

function definitionFor(projectId: string): ResolvedTableDefinition {
  const found = tableDefinitions.find((definition) => definition.repositoryName === 'workflowWakeInbox');
  if (!found) throw new Error('workflow wake inbox definition is missing');
  return resolve(found, projectId);
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
let connectionString = '';
let ready: Promise<void> | undefined;
let tail: Promise<void> = Promise.resolve();

// Every integration test starts from an empty inbox in its own isolated schema:
// a due row left by an earlier test would be picked first and stall the barriers.
async function emptyInbox(): Promise<void> {
  await (await pg()).query('DELETE FROM platform_workflow_wake_inbox');
}

function serial<T>(run: () => Promise<T>): Promise<T> {
  const fresh = async () => {
    await emptyInbox();
    return run();
  };
  const next = tail.then(fresh, fresh);
  tail = next.then(() => undefined, () => undefined);
  return next;
}

async function pg(): Promise<Pool> {
  if (!ready) {
    schema = `workflow_wake_${randomBytes(8).toString('hex')}`;
    const url = new URL(localTestUrl());
    url.searchParams.set('options', `-c search_path=${schema}`);
    connectionString = url.toString();
    pool = new Pool({ connectionString, max: 4 });
    ready = (async () => {
      const client = await pool!.connect();
      try {
        await client.query(`CREATE SCHEMA ${schema}`);
        await client.query(`SET search_path TO ${schema}`);
        const definition = definitionFor('102030');
        await client.query(buildCreateTableSql(definition));
        for (const sql of buildCreateIndexSql(definition)) await client.query(sql);
        await client.query(
          `CREATE TABLE wake_effect (
            command_id TEXT PRIMARY KEY,
            hits INTEGER NOT NULL
          )`,
        );
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

async function rowOf(client: Pool | PoolClient, eventId: string): Promise<{
  state: string;
  outcome: string | null;
  attempts: number;
  lastErrorCode: string | null;
  payload: ModuleWakeEvent;
  due: boolean;
}> {
  const rows = await queryRows<{
    state: string;
    outcome: string | null;
    attempts: number;
    lastErrorCode: string | null;
    payload: ModuleWakeEvent;
    due: boolean;
  }>(
    client,
    `SELECT "state", "outcome", "attempts", "lastErrorCode", "payload",
            ("nextAttemptAt" <= NOW()) AS due
     FROM platform_workflow_wake_inbox WHERE "eventId" = $1`,
    [eventId],
  );
  const row = rows[0];
  if (!row) throw new Error(`missing inbox row ${eventId}`);
  return row;
}

function storeFor(shared: Pool, projectId = '102030') {
  return createPostgresWorkflowWakeInbox({
    projectId,
    pool: shared,
    definition: definitionFor(projectId),
  });
}

function failOnCommit(inner: Pool): Pool {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop !== 'connect') {
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async () => {
        const client = await target.connect();
        return new Proxy(client, {
          get(innerClient, clientProp, clientReceiver) {
            if (clientProp === 'query') {
              return (sql: unknown, params?: unknown) => {
                const text = typeof sql === 'string' ? sql : '';
                if (text === 'COMMIT') throw new Error('commit failed');
                return (innerClient.query as (q: unknown, p?: unknown) => Promise<unknown>)(sql, params);
              };
            }
            if (clientProp === 'release') return () => client.release();
            const value = Reflect.get(innerClient, clientProp, clientReceiver);
            return typeof value === 'function' ? value.bind(innerClient) : value;
          },
        });
      };
    },
  }) as Pool;
}

test('refuses a memory runtime, an empty project and a foreign definition before SQL', () => {
  const memory = { runtimeMode: 'memory', appEnv: 'development' } as AppEnv;
  assert.throws(
    () => createPostgresWorkflowWakeInbox({ projectId: '102030', env: memory }),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_WAKE_RUNTIME_INVALID',
  );
  assert.throws(
    () => createPostgresWorkflowWakeInbox({ projectId: ' ', env: memory, pool: {} as Pool }),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_WAKE_SCOPE_INVALID',
  );
  const broken = { ...definitionFor('102030'), repositoryName: 'other' };
  assert.throws(
    () => createPostgresWorkflowWakeInbox({ projectId: '102030', pool: {} as Pool, definition: broken }),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_WAKE_RUNTIME_INVALID',
  );
});

test('enqueue rejects a foreign project before SQL', async () => {
  const inbox = createPostgresWorkflowWakeInbox({
    projectId: '102030',
    pool: { connect() { throw new Error('sql'); } } as unknown as Pool,
    definition: definitionFor('102030'),
  });
  await assert.rejects(
    () => inbox.enqueue(event({ ref: { ...event().ref, project: '102031' } })),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_WAKE_SCOPE_INVALID',
  );
  await assert.rejects(
    () => inbox.runNext('102031', async () => 'accepted'),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_WAKE_SCOPE_INVALID',
  );
});

test('a commit failure returns 503 and leaves no receipt row', { skip: !integration, timeout: 10000 }, async () => serial(async () => {
  const shared = await pg();
  const inbox = createPostgresWorkflowWakeInbox({
    projectId: '102030',
    pool: failOnCommit(shared),
    definition: definitionFor('102030'),
  });
  const body = event({ recordId: `commit-${randomBytes(3).toString('hex')}`, n: 1 });
  await assert.rejects(
    () => inbox.enqueue(body),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_WAKE_UNAVAILABLE' && error.statusCode === 503,
  );
  const left = await queryRows<{ count: number }>(
    shared,
    'SELECT COUNT(*)::int AS count FROM platform_workflow_wake_inbox WHERE "eventId" = $1',
    [body.eventId],
  );
  assert.equal(left[0]?.count, 0);
}));

test('duplicate attempt and revision keep one pending row; a stable conflict does not change it', { skip: !integration, timeout: 10000 }, async () => serial(async () => {
  const shared = await pg();
  const inbox = storeFor(shared);
  const body = event({ recordId: `dup-${randomBytes(3).toString('hex')}` });
  const first = await inbox.enqueue(body);
  const replay = await inbox.enqueue({ ...body, attempt: 4, revision: 9 });
  assert.equal(first.statusCode, 202);
  assert.deepEqual(replay, { receipt: { eventId: body.eventId, outcome: 'accepted' }, statusCode: 202 });
  const stored = await rowOf(shared, body.eventId);
  assert.equal(stored.state, 'pending');
  assert.equal(stored.payload.attempt, 1);
  assert.equal(stored.payload.revision, 1);
  await assert.rejects(
    () => inbox.enqueue({ ...body, routine: 'otherRoutine' }),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_WAKE_IDENTITY_CONFLICT' && error.statusCode === 409,
  );
  const after = await rowOf(shared, body.eventId);
  assert.equal(after.payload.routine, 'onWake');
  assert.equal(after.attempts, 0);
}));

test('two connections: one callback per ref, the other ref progresses, and the next firing stays', { skip: !integration, timeout: 10000 }, async () => serial(async () => {
  const shared = await pg();
  const firstStore = storeFor(shared);
  const secondStore = storeFor(shared);
  const suffix = randomBytes(3).toString('hex');
  const held = event({ recordId: `held-${suffix}`, taskId: `task-held-${suffix}`, n: 1 });
  const next = event({ recordId: `held-${suffix}`, taskId: `task-held-${suffix}`, n: 2 });
  const other = event({ recordId: `other-${suffix}`, taskId: `task-other-${suffix}`, n: 1 });
  await firstStore.enqueue(held);
  const inside = createBarrier();
  const release = createBarrier();
  let heldCalls = 0;
  let otherCalls = 0;
  const holding = firstStore.runNext('102030', async (incoming) => {
    assert.equal(incoming.eventId, held.eventId);
    heldCalls += 1;
    inside.release();
    await release.wait;
    return 'accepted';
  });
  await inside.wait;
  await firstStore.enqueue(next);
  const busy = await secondStore.runNext('102030', async () => {
    otherCalls += 1;
    return 'accepted';
  });
  assert.equal(busy, 'busy');
  assert.equal(otherCalls, 0);
  await firstStore.enqueue(other);
  const progressed = await secondStore.runNext('102030', async (incoming) => {
    assert.equal(incoming.eventId, other.eventId);
    otherCalls += 1;
    return 'accepted';
  });
  assert.equal(progressed, 'accepted');
  assert.equal(otherCalls, 1);
  const waiting = await rowOf(shared, next.eventId);
  assert.equal(waiting.state, 'pending');
  assert.equal(waiting.due, false);
  release.release();
  assert.equal(await holding, 'accepted');
  assert.equal(heldCalls, 1);
  const done = await rowOf(shared, held.eventId);
  assert.equal(done.state, 'completed');
  assert.equal(done.outcome, 'accepted');
  assert.equal(done.attempts, 1);
  const replay = await firstStore.enqueue({ ...held, attempt: 2, revision: 3 });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.receipt.outcome, 'accepted');
  assert.equal((await rowOf(shared, held.eventId)).state, 'completed');
}));

test('a failed completion rolls back metadata and a new instance resumes the pending row', { skip: !integration, timeout: 10000 }, async () => serial(async () => {
  const shared = await pg();
  const suffix = randomBytes(3).toString('hex');
  const body = event({ recordId: `roll-${suffix}` });
  const inbox = storeFor(shared);
  await inbox.enqueue(body);
  await shared.query(`
    CREATE FUNCTION rt106_block_complete() RETURNS trigger AS $$
    BEGIN
      IF NEW.state = 'completed' THEN
        RAISE EXCEPTION 'blocked completion';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql
  `);
  await shared.query(`
    CREATE TRIGGER rt106_block_complete
    BEFORE UPDATE ON platform_workflow_wake_inbox
    FOR EACH ROW EXECUTE FUNCTION rt106_block_complete()
  `);
  await assert.rejects(
    () => inbox.runNext('102030', async () => 'accepted'),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_WAKE_UNAVAILABLE',
  );
  const pending = await rowOf(shared, body.eventId);
  assert.equal(pending.state, 'pending');
  assert.equal(pending.attempts, 0);
  assert.equal(pending.outcome, null);
  await shared.query('DROP TRIGGER rt106_block_complete ON platform_workflow_wake_inbox');
  const resumed = storeFor(shared);
  assert.equal(await resumed.runNext('102030', async () => 'stale'), 'stale');
  const completed = await rowOf(shared, body.eventId);
  assert.equal(completed.state, 'completed');
  assert.equal(completed.outcome, 'stale');
  assert.equal(completed.attempts, 1);
}));

test('a handler error stays pending and retryable, and a foreign app row is left alone', { skip: !integration, timeout: 10000 }, async () => serial(async () => {
  const shared = await pg();
  const suffix = randomBytes(3).toString('hex');
  const body = event({ recordId: `retry-${suffix}` });
  const foreign = event({
    recordId: `foreign-${suffix}`,
    ref: { ...event().ref, project: '102031', recordId: `foreign-${suffix}` },
  });
  const inbox = storeFor(shared);
  await inbox.enqueue(body);
  await storeFor(shared, '102031').enqueue(foreign);
  const retried = await inbox.runNext('102030', async () => {
    throw new Error('handler blew up with payload detail');
  });
  assert.equal(retried, 'retry');
  const row = await rowOf(shared, body.eventId);
  assert.equal(row.state, 'pending');
  assert.equal(row.attempts, 1);
  assert.equal(row.lastErrorCode, 'WORKFLOW_WAKE_HANDLER_FAILED');
  assert.equal(row.due, false);
  assert.equal((await rowOf(shared, foreign.eventId)).state, 'pending');
  assert.equal(await inbox.runNext('102030', async () => 'accepted'), 'empty');
  await shared.query(
    'UPDATE platform_workflow_wake_inbox SET "nextAttemptAt" = NOW() WHERE "eventId" = $1',
    [body.eventId],
  );
  const coded = await inbox.runNext('102030', async () => ({ retry: { code: 'secret message' } }));
  assert.equal(coded, 'retry');
  assert.equal((await rowOf(shared, body.eventId)).lastErrorCode, 'WORKFLOW_WAKE_HANDLER_FAILED');
  assert.equal((await rowOf(shared, body.eventId)).attempts, 2);
  await shared.query(
    'UPDATE platform_workflow_wake_inbox SET "nextAttemptAt" = NOW() WHERE "eventId" = $1',
    [body.eventId],
  );
  assert.equal(
    await inbox.runNext('102030', async () => ({ retry: { code: 'WORKFLOW_WAKE_SOURCE_UNAVAILABLE' } })),
    'retry',
  );
  assert.equal((await rowOf(shared, body.eventId)).lastErrorCode, 'WORKFLOW_WAKE_SOURCE_UNAVAILABLE');
  assert.equal((await rowOf(shared, foreign.eventId)).attempts, 0);
}));

test('an effect committed before the inbox receipt is not repeated on retry', { skip: !integration, timeout: 10000 }, async () => serial(async () => {
  const shared = await pg();
  const suffix = randomBytes(3).toString('hex');
  const body = event({ recordId: `effect-${suffix}` });
  const inbox = storeFor(shared);
  await inbox.enqueue(body);
  const effect = new Pool({ connectionString, max: 1 });
  let pass = 0;
  try {
    const first = await inbox.runNext('102030', async (incoming) => {
      pass += 1;
      const commandId = workflowWakeCommandId(incoming.eventId);
      await effect.query(
        'INSERT INTO wake_effect (command_id, hits) VALUES ($1, 1) ON CONFLICT (command_id) DO NOTHING',
        [commandId],
      );
      if (pass === 1) throw new Error('lost before inbox commit');
      return 'accepted';
    });
    assert.equal(first, 'retry');
    await shared.query(
      'UPDATE platform_workflow_wake_inbox SET "nextAttemptAt" = NOW() WHERE "eventId" = $1',
      [body.eventId],
    );
    assert.equal(await inbox.runNext('102030', async (incoming) => {
      pass += 1;
      await effect.query(
        'INSERT INTO wake_effect (command_id, hits) VALUES ($1, 1) ON CONFLICT (command_id) DO NOTHING',
        [workflowWakeCommandId(incoming.eventId)],
      );
      return 'accepted';
    }), 'accepted');
    const hits = await queryRows<{ hits: number }>(
      effect,
      'SELECT hits FROM wake_effect WHERE command_id = $1',
      [workflowWakeCommandId(body.eventId)],
    );
    assert.equal(hits[0]?.hits, 1);
    assert.equal((await rowOf(shared, body.eventId)).state, 'completed');
    assert.equal((await rowOf(shared, body.eventId)).attempts, 2);
  } finally {
    await effect.end();
  }
}));

