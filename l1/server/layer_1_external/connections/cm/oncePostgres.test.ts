/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/cm/oncePostgres.test.ts" enhancement="_blank" />
// Integration: Postgres local, an isolated schema, the REAL transaction of the module runtime. Skipped without WORKFLOW_TEST_PG_URL.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { Pool } from 'pg';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { runAsCallerModule } from '/_102034_/l1/server/layer_1_external/connections/callerModule.js';
import { once } from '/_102034_/l1/server/layer_1_external/connections/cm/once.js';
import { onceAnswerDefinition } from '/_102034_/l1/server/layer_1_external/connections/cm/onceStore.js';
import { createPostgresModuleDataRuntime } from '/_102034_/l1/server/layer_1_external/data/moduleDataRuntime.js';
import { platformTransactionAccess } from '/_102034_/l1/server/layer_1_external/data/postgres/txClient.js';
import { buildCreateIndexSql, buildCreateTableSql } from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

const url = process.env.RUN_INTEGRATION_TESTS === 'true' ? process.env.WORKFLOW_TEST_PG_URL ?? '' : '';
const schema = `once_${randomBytes(8).toString('hex')}`;
let pool: Pool | undefined;

let ready: Promise<Pool> | undefined;
function setup(): Promise<Pool> {
  ready ??= prepare();
  return ready;
}

async function prepare(): Promise<Pool> {
  const parsed = new URL(url);
  parsed.searchParams.set('options', `-c search_path=${schema}`);
  pool = new Pool({ connectionString: parsed.toString(), max: 6 });
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    const definition = { ...onceAnswerDefinition, projectId: '102030', repositoryName: onceAnswerDefinition.tableName, logicalTableName: onceAnswerDefinition.tableName, dynamoResolvedTableName: null };
    await client.query(buildCreateTableSql(definition));
    for (const sql of buildCreateIndexSql(definition)) await client.query(sql);
    await client.query('CREATE TABLE module_effect (id TEXT PRIMARY KEY)');
  } finally {
    client.release();
  }
  return pool;
}

after(async () => {
  if (!pool) return;
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.end();
});

describe('rt325 s1: once (Postgres, real transaction)', { skip: url === '' }, () => {
  const WHERE = { scope: 'sendChannelMessage', key: 'k-pg' };
  const env = { appEnv: 'development', projectId: '102030' } as unknown as AppEnv;

  async function call<T>(moduleId: string, where: { scope: string; key: string }, work: (ctx: RequestContext) => Promise<T>): Promise<T> {
    const runtime = createPostgresModuleDataRuntime(env, await setup());
    return runAsCallerModule(moduleId, () => runtime.runInTransaction((tx) => {
      const ctx = { data: { moduleData: tx } } as unknown as RequestContext;
      return once(ctx, where, () => work(ctx));
    }));
  }
  const write = async (ctx: RequestContext, id: string) => {
    await platformTransactionAccess(ctx.data.moduleData)?.sql?.query('INSERT INTO module_effect (id) VALUES ($1)', [id]);
  };

  it('two simultaneous requests with the same key: one execution, the same answer', async () => {
    let runs = 0;
    const work = async (ctx: RequestContext) => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      await write(ctx, `effect-${runs}`);
      return { n: runs };
    };
    const [a, b] = await Promise.all([call('telegram', { ...WHERE, key: 'k-par' }, work), call('telegram', { ...WHERE, key: 'k-par' }, work)]);
    assert.deepEqual(a, b);
    assert.equal(runs, 1);
    const effects = await (await setup()).query('SELECT count(*)::int AS n FROM module_effect');
    assert.equal(effects.rows[0].n, 1);
  });

  it('a repeat after the commit gets the stored answer (json, refusal included)', async () => {
    let runs = 0;
    const work = async () => { runs += 1; return { ok: false, code: 'refused', message: 'no', list: [1, null] }; };
    const first = await call('telegram', { ...WHERE, key: 'k-rep' }, work);
    const second = await call('telegram', { ...WHERE, key: 'k-rep' }, work);
    assert.deepEqual(second, first);
    assert.equal(runs, 1);
    const rows = await (await setup()).query(`SELECT "module", "createdAt" FROM platform_once_answer WHERE "key" = 'k-rep'`);
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].module, 'telegram');
  });

  it('an exception rolls back what the work wrote and the answer; the repeat runs again', async () => {
    await assert.rejects(call('telegram', { ...WHERE, key: 'k-exc' }, async (ctx) => { await write(ctx, 'lost'); throw new Error('boom'); }), /boom/u);
    const stored = await (await setup()).query(`SELECT count(*)::int AS n FROM platform_once_answer WHERE "key" = 'k-exc'`);
    const lost = await (await setup()).query(`SELECT count(*)::int AS n FROM module_effect WHERE id = 'lost'`);
    assert.equal(stored.rows[0].n, 0);
    assert.equal(lost.rows[0].n, 0);
    let runs = 0;
    const again = await call('telegram', { ...WHERE, key: 'k-exc' }, async () => { runs += 1; return 'ok'; });
    assert.equal(again, 'ok');
    assert.equal(runs, 1);
  });

  it('the same key in another module is another entry; outside a transaction it throws', async () => {
    let runs = 0;
    const work = async () => ++runs;
    await call('agents', { ...WHERE, key: 'k-mod' }, work);
    await call('telegram', { ...WHERE, key: 'k-mod' }, work);
    assert.equal(runs, 2);
    const runtime = createPostgresModuleDataRuntime(env, await setup());
    const ctx = { data: { moduleData: runtime } } as unknown as RequestContext;
    await assert.rejects(runAsCallerModule('telegram', () => once(ctx, WHERE, async () => 1)), /inside a transaction/u);
  });
});
