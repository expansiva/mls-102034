/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/externalPg.probe.test.ts" enhancement="_blank" />
/**
 * Probe against a REAL PostgreSQL with TimescaleDB (rt263, rt264). Off by default, like the cm probe:
 *
 *   RUN_EXTERNAL_PG_PROBE=true EXTERNAL_PROBE_DATABASE_URL=<the app database, already migrated> \
 *     tsx --import test/register-hooks.mjs --import test/setup-l1.ts --test l1/server/layer_1_external/connections/external/externalPg.probe.test.ts
 *
 * The tables are the ones the platform migration created (`platform_external_*`). The probe writes only rows of the
 * project `probe9`, and removes them at the end. Each step prints one `EXTERNAL-PG ...` line.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import {
  EXTERNAL_CALL_AUDIT_TABLE,
  EXTERNAL_CALL_LOG_TABLE,
  EXTERNAL_NOTICE_SEEN_TABLE,
  forgetNotice,
  purgeSeenNotices,
  readRecentExternalCalls,
  recordNoticeSeen,
  writeExternalCallPair,
  type ExternalCallRow,
} from '/_102034_/l1/server/layer_1_external/connections/external/externalCallStore.js';
import {
  EXTERNAL_SETTINGS_TABLE,
  createExternalSettingsStore,
} from '/_102034_/l1/server/layer_1_external/connections/external/externalSettingsStore.js';
import type { ExternalSystemDeclaration } from '/_102034_/l2/shared/contracts/connections/externalSystem.js';

const URL = process.env.EXTERNAL_PROBE_DATABASE_URL ?? '';
const ENABLED = process.env.RUN_EXTERNAL_PG_PROBE === 'true' && URL !== '';
const PROJECT = 'probe9';
const SECRET = 'probe-secret-value-rt263';

const declaration: ExternalSystemDeclaration = {
  schemaVersion: 'external-system-v1',
  systemId: 'probeSystem',
  title: 'Probe',
  description: 'Declared only for the probe.',
  hosts: [{ host: 'probe.example.com' }],
  settings: [{ id: 'account', secret: false }, { id: 'signingKey', secret: true }],
  operations: [],
};

function row(id: string, occurredAt: string): ExternalCallRow {
  return {
    id, occurredAt, direction: 'out', projectId: PROJECT, moduleId: 'probeModule', systemId: 'probeSystem',
    operationId: 'ping', server: 'probe.example.com', path: '/ping', outcome: 'ok', denialReason: null,
    httpStatus: 200, durationMs: 12, bytes: 34, actorKind: 'person', actorId: 'person-1', requestId: 'req-probe',
  };
}

describe('external tables on a real PostgreSQL', { skip: !ENABLED }, () => {
  let pool: pg.Pool;
  const db = { query: (sql: string, params?: readonly unknown[]) => pool.query(sql, params as never[]) };

  before(() => { pool = new pg.Pool({ connectionString: URL }); });

  after(async () => {
    for (const table of [EXTERNAL_CALL_LOG_TABLE, EXTERNAL_CALL_AUDIT_TABLE, EXTERNAL_NOTICE_SEEN_TABLE, EXTERNAL_SETTINGS_TABLE]) {
      await pool.query(`DELETE FROM "${table}" WHERE "projectId" = $1`, [PROJECT]);
    }
    await pool.end();
  });

  it('the four tables exist, the two call tables are hypertables, and the retention is 7 and 90 days', async () => {
    for (const table of [EXTERNAL_CALL_LOG_TABLE, EXTERNAL_CALL_AUDIT_TABLE, EXTERNAL_NOTICE_SEEN_TABLE, EXTERNAL_SETTINGS_TABLE]) {
      const found = await pool.query('SELECT to_regclass($1) AS name', [`"${table}"`]);
      assert.notEqual(found.rows[0]?.name, null, `${table} is missing`);
    }
    const hyper = await pool.query(
      'SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name = ANY($1)',
      [[EXTERNAL_CALL_LOG_TABLE, EXTERNAL_CALL_AUDIT_TABLE]],
    );
    assert.deepEqual(hyper.rows.map((item) => item.hypertable_name).sort(), [EXTERNAL_CALL_AUDIT_TABLE, EXTERNAL_CALL_LOG_TABLE].sort());
    const jobs = await pool.query(
      `SELECT hypertable_name, config->>'drop_after' AS drop_after FROM timescaledb_information.jobs
       WHERE proc_name = 'policy_retention' AND hypertable_name = ANY($1)`,
      [[EXTERNAL_CALL_LOG_TABLE, EXTERNAL_CALL_AUDIT_TABLE]],
    );
    const byTable = new Map(jobs.rows.map((item) => [String(item.hypertable_name), String(item.drop_after)]));
    console.log(`EXTERNAL-PG retention log=${byTable.get(EXTERNAL_CALL_LOG_TABLE)} audit=${byTable.get(EXTERNAL_CALL_AUDIT_TABLE)}`);
    assert.match(byTable.get(EXTERNAL_CALL_LOG_TABLE) ?? '', /^(7 days|168:00:00|7 day)/);
    assert.match(byTable.get(EXTERNAL_CALL_AUDIT_TABLE) ?? '', /^(90 days|2160:00:00|90 day)/);
  });

  it('a call is written to the log and the audit and read back, newest first', async () => {
    await writeExternalCallPair(db, row('probe-1', new Date(Date.now() - 2000).toISOString()));
    await writeExternalCallPair(db, row('probe-2', new Date().toISOString()));
    const recent = await readRecentExternalCalls(db, PROJECT, 'probeModule', 'probeSystem');
    assert.deepEqual(recent.map((item) => item.id), ['probe-2', 'probe-1']);
    const audit = await pool.query(`SELECT count(*)::int AS n FROM "${EXTERNAL_CALL_AUDIT_TABLE}" WHERE "projectId" = $1`, [PROJECT]);
    assert.equal(audit.rows[0]?.n, 2);
    console.log('EXTERNAL-PG call log+audit ok');
  });

  it('the same noticeId inserts once even with 20 at the same time, and can be given back and purged', async () => {
    const key = { projectId: PROJECT, systemId: 'probeSystem', operationId: 'receive', noticeId: 'evt-1' };
    const results = await Promise.all(Array.from({ length: 20 }, () => recordNoticeSeen(db, { ...key, arrivedAt: new Date().toISOString() })));
    assert.equal(results.filter(Boolean).length, 1);
    await forgetNotice(db, key);
    assert.equal(await recordNoticeSeen(db, { ...key, arrivedAt: new Date().toISOString() }), true);
    await recordNoticeSeen(db, { ...key, noticeId: 'evt-old', arrivedAt: new Date(Date.now() - 100 * 86_400_000).toISOString() });
    await purgeSeenNotices(db, new Date());
    const left = await pool.query(`SELECT "noticeId" FROM "${EXTERNAL_NOTICE_SEEN_TABLE}" WHERE "projectId" = $1 ORDER BY 1`, [PROJECT]);
    assert.deepEqual(left.rows.map((item) => item.noticeId), ['evt-1']);
    console.log('EXTERNAL-PG notice seen: atomic once, give back, purge 90d ok');
  });

  it('the vault seals a secret, never stores it in plain text, overwrites on conflict and opens only with the key', async () => {
    const key = randomBytes(32);
    const store = createExternalSettingsStore({ declarationOf: () => declaration, db, key, log: () => undefined });
    const ref = { projectId: PROJECT, moduleId: 'probeModule', systemId: 'probeSystem' };
    assert.deepEqual(await store.set(ref, 'account', 'acme', 'probe'), { ok: true });
    assert.deepEqual(await store.set(ref, 'signingKey', SECRET, 'probe'), { ok: true });
    assert.deepEqual(await store.set(ref, 'account', 'acme-2', 'probe'), { ok: true });
    assert.equal(await store.settingOf(ref, 'account'), 'acme-2');
    assert.equal(await store.settingOf(ref, 'signingKey'), undefined);
    assert.deepEqual(await store.secretOf(ref, 'signingKey'), { ok: true, value: SECRET });
    const raw = await pool.query(`SELECT "settingId", "value", "secret" FROM "${EXTERNAL_SETTINGS_TABLE}" WHERE "projectId" = $1`, [PROJECT]);
    const stored = raw.rows.find((item) => item.settingId === 'signingKey');
    assert.equal(stored?.secret, true);
    assert.ok(String(stored?.value).startsWith('enc1:'));
    assert.equal(JSON.stringify(raw.rows).includes(SECRET), false);
    const other = createExternalSettingsStore({ declarationOf: () => declaration, db, key: randomBytes(32), log: () => undefined });
    assert.deepEqual(await other.secretOf(ref, 'signingKey'), { ok: false, code: 'disabled' });
    assert.deepEqual((await store.status(PROJECT, 'probeSystem')).map((item) => item.filled), [true, true]);
    console.log('EXTERNAL-PG vault: sealed, no plain text, conflict update, wrong key refused ok');
  });
});
