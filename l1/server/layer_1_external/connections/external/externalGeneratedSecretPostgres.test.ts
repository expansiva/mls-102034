/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/externalGeneratedSecretPostgres.test.ts" enhancement="_blank" />
// rt331 s2: the generated secret on REAL Postgres (an isolated schema, dropped at the end). Skipped without WORKFLOW_TEST_PG_URL.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { Pool } from 'pg';
import { createFakeAdapterContext, exampleExternalSystem } from '/_102034_/testing/connections/externalFixtures.js';
import {
  createExternalSettingsStore,
  externalSettingsDefinition,
  type ExternalSettingsDb,
} from '/_102034_/l1/server/layer_1_external/connections/external/externalSettingsStore.js';
import type { ExternalRef } from '/_102034_/l1/server/layer_1_external/connections/external/sendExternal.js';
import { buildCreateIndexSql, buildCreateTableSql } from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';
import type { ExternalSystemDeclaration } from '/_102034_/l2/shared/contracts/connections/externalSystem.js';

const url = process.env.RUN_INTEGRATION_TESTS === 'true' ? process.env.WORKFLOW_TEST_PG_URL ?? '' : '';
const schema = `extsecret_${randomBytes(8).toString('hex')}`;
const KEY = randomBytes(32);
const declaration: ExternalSystemDeclaration = {
  ...exampleExternalSystem,
  settings: [{ id: 'account', secret: false }, { id: 'signingKey', secret: true, generated: true }],
};
const ref: ExternalRef = { projectId: '102034', moduleId: 'exampleModule', systemId: declaration.systemId };
let pool: Pool | undefined;
let ready: Promise<Pool> | undefined;

function setup(): Promise<Pool> {
  ready ??= (async () => {
    const parsed = new URL(url);
    parsed.searchParams.set('options', `-c search_path=${schema}`);
    pool = new Pool({ connectionString: parsed.toString(), max: 6 });
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      const definition = { ...externalSettingsDefinition, projectId: '102034', repositoryName: externalSettingsDefinition.tableName, logicalTableName: externalSettingsDefinition.tableName, dynamoResolvedTableName: null };
      await client.query(buildCreateTableSql(definition));
      for (const sql of buildCreateIndexSql(definition)) await client.query(sql);
    } finally {
      client.release();
    }
    return pool;
  })();
  return ready;
}

after(async () => {
  if (!pool) return;
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.end();
});

describe('rt331 s2: the generated secret on real Postgres', { skip: url === '' }, () => {
  async function storeOf(lines: string[] = []) {
    const db: ExternalSettingsDb = { query: async (sql, params) => (await (await setup()).query(sql, params as unknown[])) };
    return createExternalSettingsStore({ declarationOf: () => declaration, moduleOf: () => ref.moduleId, db, key: KEY, log: (line) => lines.push(line) });
  }
  const rowsOf = async (settingId: string) => (await (await setup()).query(`SELECT "value", "writtenBy" FROM platform_external_settings WHERE "settingId" = $1`, [settingId])).rows;

  it('six at the same time get the same value and one row; it is stored sealed; the author is the platform', async () => {
    const lines: string[] = [];
    const store = await storeOf(lines);
    const made = await Promise.all(Array.from({ length: 6 }, () => store.ensureGeneratedSecret(ref, 'signingKey')));
    const values = new Set(made.map((read) => (read.ok ? read.value : 'failed')));
    assert.equal(values.size, 1);
    const value = [...values][0] ?? '';
    assert.match(value, /^[A-Za-z0-9_-]{43}$/u);
    const rows = await rowsOf('signingKey');
    assert.equal(rows.length, 1);
    assert.equal(String(rows[0].value).includes(value), false, 'sealed in the table');
    assert.equal(rows[0].writtenBy, 'platform:generated');
    assert.equal(lines.some((line) => line.includes(value)), false, 'not in the log');
    assert.deepEqual(await store.secretOf(ref, 'signingKey'), { ok: true, value });
  });

  it('a value typed by hand before is returned as it is and not replaced', async () => {
    const hand: ExternalSystemDeclaration = { ...declaration, settings: [{ id: 'account', secret: false }, { id: 'signingKey', secret: true }] };
    const db: ExternalSettingsDb = { query: async (sql, params) => (await (await setup()).query(sql, params as unknown[])) };
    await (await setup()).query(`DELETE FROM platform_external_settings`);
    const old = createExternalSettingsStore({ declarationOf: () => hand, moduleOf: () => ref.moduleId, db, key: KEY });
    assert.deepEqual(await old.set(ref, 'signingKey', 'typed-by-hand-123', 'wagner'), { ok: true });
    const store = await storeOf();
    assert.deepEqual(await store.ensureGeneratedSecret(ref, 'signingKey'), { ok: true, value: 'typed-by-hand-123' });
    assert.equal((await rowsOf('signingKey')).length, 1);
  });

  it('clear and generate again gives another value, and the context of an adapter can read nothing of it', async () => {
    const store = await storeOf();
    const first = await store.ensureGeneratedSecret(ref, 'signingKey');
    assert.deepEqual(await store.clear(ref, 'signingKey', 'admin'), { ok: true });
    assert.equal((await rowsOf('signingKey')).length, 0);
    const second = await store.ensureGeneratedSecret(ref, 'signingKey');
    assert.equal(first.ok && second.ok && first.value !== second.value, true);
    const ctx = createFakeAdapterContext({ settings: { account: 'acme' }, secrets: ['signingKey'] });
    assert.equal(ctx.setting('signingKey'), undefined, 'a secret is never readable by the adapter');
  });
});
