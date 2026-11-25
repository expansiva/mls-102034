/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/retentionPolicy.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { Client } from 'pg';
import { applyRetentionPolicy, assertRetentionDeclarations, retentionProblem, retentionWarning } from '/_102034_/l1/server/layer_1_external/persistence/retentionPolicy.js';

const HYPER = { hypertable: { timeColumn: 'at' } };

test('retentionDays must be a whole number of days, 0 or more: anything else fails by the name of the table', () => {
  assert.equal(retentionProblem({ tableName: 't', retentionDays: 30, timescale: HYPER }), undefined);
  assert.equal(retentionProblem({ tableName: 't', retentionDays: 0 }), undefined);
  assert.equal(retentionProblem({ tableName: 't' }), undefined);
  assert.equal(retentionProblem({ tableName: 'payment', retentionDays: 365 }), undefined);
  for (const bad of [-1, 1.5, Number.NaN, Infinity, '30' as unknown as number]) {
    assert.match(retentionProblem({ tableName: 'telegram_messageaudit', retentionDays: bad, timescale: HYPER }) ?? '', /^retentionDays must be a whole number of days, 0 or more: telegram_messageaudit$/u, String(bad));
  }
  assert.throws(() => assertRetentionDeclarations([{ tableName: 'fine', retentionDays: 7, timescale: HYPER }, { tableName: 'bad', retentionDays: -3 }]), /: bad$/u);
  assert.doesNotThrow(() => assertRetentionDeclarations([{ tableName: 'plain', retentionDays: 30 }, { tableName: 'kept', retentionDays: 0 }]));
});

test('a plain table with 1 day or more comes up with one warning line; 0, none and a hypertable have none', () => {
  assert.equal(retentionWarning({ tableName: 'payment', retentionDays: 365 }), 'retentionDays not applied: payment is not a hypertable');
  assert.equal(retentionWarning({ tableName: 'payment', retentionDays: 1 }), 'retentionDays not applied: payment is not a hypertable');
  assert.equal(retentionWarning({ tableName: 'payment', retentionDays: 0 }), undefined);
  assert.equal(retentionWarning({ tableName: 'payment' }), undefined);
  assert.equal(retentionWarning({ tableName: 'audit', retentionDays: 30, timescale: HYPER }), undefined);
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

test('real Postgres: the policy of a hypertable is applied, is not repeated, changes with retentionDays; a plain table gets none', { skip: !integration && 'needs RUN_INTEGRATION_TESTS=true and WORKFLOW_TEST_PG_URL' }, async () => {
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
  // (4) a plain table with retentionDays comes up with no policy and the warning line
  await client.query('CREATE TABLE plain_audit (id text PRIMARY KEY, at timestamptz NOT NULL)');
  assert.doesNotThrow(() => assertRetentionDeclarations([{ tableName: 'plain_audit', retentionDays: 30 }]));
  assert.equal(retentionWarning({ tableName: 'plain_audit', retentionDays: 30 }), 'retentionDays not applied: plain_audit is not a hypertable');
  const plainJobs = await client.query("SELECT 1 FROM timescaledb_information.jobs WHERE proc_name = 'policy_retention' AND hypertable_schema = current_schema() AND hypertable_name = 'plain_audit'");
  assert.equal(plainJobs.rows.length, 0);
});
