/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/retentionPolicy.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { Client } from 'pg';
import { applyRetentionPolicy, assertRetentionDeclarations, retentionProblem } from '/_102034_/l1/server/layer_1_external/persistence/retentionPolicy.js';

const HYPER = { hypertable: { timeColumn: 'at' } };

test('retentionDays: a hypertable takes a whole number of days from 1; 0 and none keep the rows', () => {
  assert.equal(retentionProblem({ tableName: 't', retentionDays: 30, timescale: HYPER }), undefined);
  assert.equal(retentionProblem({ tableName: 't', timescale: HYPER }), undefined);
  assert.equal(retentionProblem({ tableName: 't', retentionDays: 0 }), undefined);
  assert.equal(retentionProblem({ tableName: 't' }), undefined);
  for (const bad of [-1, 1.5, Number.NaN, Infinity, '30' as unknown as number]) {
    assert.match(retentionProblem({ tableName: 'telegram_messageaudit', retentionDays: bad, timescale: HYPER }) ?? '', /^retentionDays must be an integer of 1 or more: telegram_messageaudit$/u, String(bad));
  }
});

test('retentionDays on a plain table fails by the name of the table, never ignored', () => {
  assert.equal(retentionProblem({ tableName: 'payment', retentionDays: 365 }), 'retentionDays needs a timescale hypertable: payment');
  assert.throws(
    () => assertRetentionDeclarations([{ tableName: 'fine', retentionDays: 7, timescale: HYPER }, { tableName: 'payment', retentionDays: 365 }]),
    /retentionDays needs a timescale hypertable: payment/u,
  );
  assert.doesNotThrow(() => assertRetentionDeclarations([{ tableName: 'fine', retentionDays: 7, timescale: HYPER }, { tableName: 'kept', retentionDays: 0 }]));
});

test('the policy is added when missing, kept when it is already that, replaced when it is another', async () => {
  const run = async (existing: Array<{ same: boolean }>) => {
    const sql: string[] = [];
    const pool = {
      query: async (text: string): Promise<{ rows: Array<{ same: boolean }> }> => {
        sql.push(text.trim().split(/\s+/u)[0] === 'SELECT' && text.includes('timescaledb_information.jobs') ? 'read' : /(add|remove)_retention_policy/u.exec(text)?.[0] ?? text);
        return { rows: text.includes('timescaledb_information.jobs') ? existing : [] };
      },
    };
    const outcome = await applyRetentionPolicy(pool as never, 'logs', 30);
    return { outcome, sql };
  };
  assert.deepEqual(await run([]), { outcome: 'added', sql: ['read', 'add_retention_policy'] });
  assert.deepEqual(await run([{ same: true }]), { outcome: 'kept', sql: ['read'] });
  assert.deepEqual(await run([{ same: false }]), { outcome: 'replaced', sql: ['read', 'remove_retention_policy', 'add_retention_policy'] });
});

/** Real Postgres with TimescaleDB, in a schema of its own inside the local test database (a tunnel to it), dropped at the end. */
const integration = process.env.RUN_INTEGRATION_TESTS === 'true' && (process.env.WORKFLOW_TEST_PG_URL ?? '') !== '';
let client: Client | undefined;
let schema = '';

after(async () => {
  if (!client) return;
  const closing = client;
  client = undefined;
  try {
    if (schema) await closing.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await closing.end();
  }
});

test('real Postgres: the policy of a hypertable is applied, is not repeated, and changes with retentionDays', { skip: !integration && 'needs RUN_INTEGRATION_TESTS=true and WORKFLOW_TEST_PG_URL' }, async () => {
  const raw = process.env.WORKFLOW_TEST_PG_URL ?? '';
  const url = new URL(raw);
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ''));
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(url.hostname) && database === 'collab_app_test', 'WORKFLOW_TEST_PG_URL must be a local collab_app_test URL');
  client = new Client({ connectionString: raw });
  await client.connect();
  schema = `retention_probe_${Date.now().toString(36)}`;
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}", public`);
  await client.query('CREATE TABLE audit (id text NOT NULL, at timestamptz NOT NULL, PRIMARY KEY (id, at))');
  await client.query("SELECT create_hypertable('audit'::regclass, 'at'::name)");
  const policies = async () => (await client!.query<{ drop_after: string }>(
    "SELECT config->>'drop_after' AS drop_after FROM timescaledb_information.jobs WHERE proc_name = 'policy_retention' AND hypertable_schema = current_schema() AND hypertable_name = 'audit'",
  )).rows;
  assert.deepEqual(await policies(), []);
  // (1) 30 days: the policy exists
  assert.equal(await applyRetentionPolicy(client, 'audit', 30), 'added');
  assert.deepEqual((await policies()).map((row) => row.drop_after), ['30 days']);
  // (2) again: nothing is duplicated
  assert.equal(await applyRetentionPolicy(client, 'audit', 30), 'kept');
  assert.equal((await policies()).length, 1);
  // (3) 7 days: the policy is replaced, not added
  assert.equal(await applyRetentionPolicy(client, 'audit', 7), 'replaced');
  assert.deepEqual((await policies()).map((row) => row.drop_after), ['7 days']);
  // (4) a plain table with retentionDays fails with the name of the table
  assert.throws(() => assertRetentionDeclarations([{ tableName: 'plain_audit', retentionDays: 30 }]), /retentionDays needs a timescale hypertable: plain_audit/u);
});
