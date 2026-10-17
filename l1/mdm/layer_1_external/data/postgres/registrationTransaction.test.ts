/// <mls fileReference="_102034_/l1/mdm/layer_1_external/data/postgres/registrationTransaction.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createPostgresDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/postgres/MdmDataRuntimePostgres.js';
import { getSharedPgPool, queryRows } from '/_102034_/l1/mdm/layer_1_external/data/postgres/pg.js';
import type { MdmTagRecord } from '/_102034_/l1/mdm/module.js';

const shouldRunIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';

function createBarrier() {
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release: () => release() };
}

function benchTag(id: string): MdmTagRecord {
  return {
    id,
    entityType: 'Company',
    entityId: id,
    tag: 'rt80-s2',
    namespace: 'runtime.onboarding',
    module: 'rt80-s2',
    createdBy: 'rt80-s2',
    createdByType: 'system',
    createdAt: '2026-10-17T00:00:00.000Z',
  };
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
    if (await predicate()) {
      return;
    }
    if (Date.now() - started > 8000) {
      throw new Error('timed out waiting for postgres advisory lock');
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

test('same lockKey serializes two postgres connections', { skip: !shouldRunIntegration, timeout: 10000 }, async () => {
  const env = readAppEnv();
  const firstRuntime = createPostgresDataRuntime(env);
  const secondRuntime = createPostgresDataRuntime(env);
  const pool = getSharedPgPool(env);
  const lockKey = `rt80-s2:same:${Date.now()}`;
  const firstInside = createBarrier();
  const order: string[] = [];

  const first = firstRuntime.runInTransaction(
    async () => {
      order.push('a-start');
      firstInside.release();
      await waitUntil(async () => (await advisoryWaiters(pool, lockKey)) >= 1);
      order.push('a-end');
      return 'a';
    },
    { lockKey },
  );

  await firstInside.wait;

  const second = secondRuntime.runInTransaction(
    async () => {
      order.push('b');
      return 'b';
    },
    { lockKey },
  );

  assert.deepEqual(await Promise.all([first, second]), ['a', 'b']);
  assert.deepEqual(order, ['a-start', 'a-end', 'b']);
});

test('different lockKeys progress on two connections', { skip: !shouldRunIntegration, timeout: 10000 }, async () => {
  const env = readAppEnv();
  const firstRuntime = createPostgresDataRuntime(env);
  const secondRuntime = createPostgresDataRuntime(env);
  const aInside = createBarrier();
  const bInside = createBarrier();
  const releaseBoth = createBarrier();

  const first = firstRuntime.runInTransaction(
    async () => {
      aInside.release();
      await bInside.wait;
      await releaseBoth.wait;
      return 'a';
    },
    { lockKey: `rt80-s2:diff-a:${Date.now()}` },
  );
  const second = secondRuntime.runInTransaction(
    async () => {
      bInside.release();
      await aInside.wait;
      return 'b';
    },
    { lockKey: `rt80-s2:diff-b:${Date.now()}` },
  );

  await Promise.all([aInside.wait, bInside.wait]);
  releaseBoth.release();
  assert.deepEqual(await Promise.all([first, second]), ['a', 'b']);
});

test('keyed error releases the lock and rolls back the write', { skip: !shouldRunIntegration, timeout: 10000 }, async () => {
  const env = readAppEnv();
  const runtime = createPostgresDataRuntime(env);
  const other = createPostgresDataRuntime(env);
  const id = `rt80-s2-rollback-${Date.now()}`;
  const lockKey = `rt80-s2:rollback:${id}`;

  await assert.rejects(
    runtime.runInTransaction(
      async (trx) => {
        await trx.mdmTag.insert({ record: benchTag(id) });
        throw new Error('rt80-s2 rollback');
      },
      { lockKey },
    ),
    /rt80-s2 rollback/,
  );

  const after = await runtime.mdmTag.findOne({ where: { id } });
  assert.equal(after, null);

  const entered = await other.runInTransaction(async () => 'open', { lockKey });
  assert.equal(entered, 'open');
});

test('bound runtime rejects a nested lockKey and keeps an unkeyed nest', { skip: !shouldRunIntegration, timeout: 10000 }, async () => {
  const env = readAppEnv();
  const runtime = createPostgresDataRuntime(env);
  const value = await runtime.runInTransaction(async (trx) => {
    await assert.rejects(
      trx.runInTransaction(async () => 'no', { lockKey: 'rt80-s2:nested' }),
      (error: unknown) => error instanceof AppError && error.code === 'NESTED_KEYED_TRANSACTION',
    );
    return trx.runInTransaction(async (inner) => inner.mode);
  });
  assert.equal(value, 'postgres');
});
