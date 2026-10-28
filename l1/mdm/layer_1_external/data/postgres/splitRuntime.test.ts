/// <mls fileReference="_102034_/l1/mdm/layer_1_external/data/postgres/splitRuntime.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { getMdmPgPool, getSharedPgPool } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import { createPostgresDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/postgres/MdmDataRuntimePostgres.js';

interface Call { pool: Pool; sql: string }

/** Every pool.connect() hands out a client that records BEGIN/COMMIT/ROLLBACK in one shared log. */
function fakePools(log: Call[]): () => void {
  const originalConnect = Pool.prototype.connect;
  const originalQuery = Pool.prototype.query;
  Pool.prototype.connect = async function connect(this: Pool) {
    const pool = this;
    return {
      query: async (sql: string) => { log.push({ pool, sql }); return { rows: [], command: '', rowCount: 0, oid: 0, fields: [] }; },
      release() {},
    };
  } as unknown as typeof Pool.prototype.connect;
  Pool.prototype.query = async function query(this: Pool, sql: string) {
    log.push({ pool: this, sql });
    return { rows: [], command: '', rowCount: 0, oid: 0, fields: [] };
  } as unknown as typeof Pool.prototype.query;
  return () => {
    Pool.prototype.connect = originalConnect;
    Pool.prototype.query = originalQuery;
  };
}

function withMdmUrl(url: string | undefined, run: () => Promise<void>): Promise<void> {
  const previousUrl = process.env.MDM_DATABASE_URL;
  const previousMode = process.env.RUNTIME_MODE;
  if (url === undefined) delete process.env.MDM_DATABASE_URL;
  else process.env.MDM_DATABASE_URL = url;
  process.env.RUNTIME_MODE = 'postgres';
  return run().finally(() => {
    if (previousUrl === undefined) delete process.env.MDM_DATABASE_URL;
    else process.env.MDM_DATABASE_URL = previousUrl;
    if (previousMode === undefined) delete process.env.RUNTIME_MODE;
    else process.env.RUNTIME_MODE = previousMode;
  });
}

test('rt147: with MDM_DATABASE_URL the MDM tables use the MDM pool and the module data keeps the shared pool', async () => {
  await withMdmUrl('postgres://mdm-pool/app', async () => {
    const log: Call[] = [];
    const restore = fakePools(log);
    try {
      const env = readAppEnv();
      const mdm = getMdmPgPool(env);
      const shared = getSharedPgPool(env);
      assert.notEqual(mdm, shared);
      const runtime = createPostgresDataRuntime(env, mdm, shared);
      // The module tables carry the executor in a private field: the only place that says which database they use.
      assert.equal((runtime.moduleData as unknown as { executor: unknown }).executor, shared);

      await runtime.runInTransaction(async () => undefined);
      const events = log.map((call) => `${call.pool === mdm ? 'mdm' : call.pool === shared ? 'module' : '?'}:${call.sql}`);
      assert.deepEqual(events, ['mdm:BEGIN', 'module:BEGIN', 'module:COMMIT', 'mdm:COMMIT']);
    } finally {
      restore();
    }
  });
});

test('rt147: an error inside the split transaction rolls back both databases', async () => {
  await withMdmUrl('postgres://mdm-pool/app', async () => {
    const log: Call[] = [];
    const restore = fakePools(log);
    try {
      const env = readAppEnv();
      const mdm = getMdmPgPool(env);
      const shared = getSharedPgPool(env);
      const runtime = createPostgresDataRuntime(env, mdm, shared);
      await assert.rejects(runtime.runInTransaction(async () => { throw new Error('boom'); }), /boom/);
      const events = log.map((call) => `${call.pool === mdm ? 'mdm' : call.pool === shared ? 'module' : '?'}:${call.sql}`);
      assert.deepEqual(events, ['mdm:BEGIN', 'module:BEGIN', 'module:ROLLBACK', 'mdm:ROLLBACK']);
    } finally {
      restore();
    }
  });
});

test('rt147: without MDM_DATABASE_URL there is one pool and one transaction, as before', async () => {
  await withMdmUrl(undefined, async () => {
    const log: Call[] = [];
    const restore = fakePools(log);
    try {
      const env = readAppEnv();
      const shared = getSharedPgPool(env);
      assert.equal(getMdmPgPool(env), shared);
      const runtime = createPostgresDataRuntime(env, getMdmPgPool(env), getSharedPgPool(env));
      assert.equal((runtime.moduleData as unknown as { executor: unknown }).executor, shared);
      await runtime.runInTransaction(async () => undefined);
      assert.deepEqual(log.map((call) => call.sql), ['BEGIN', 'COMMIT']);
      assert.ok(log.every((call) => call.pool === shared));
    } finally {
      restore();
    }
  });
});
