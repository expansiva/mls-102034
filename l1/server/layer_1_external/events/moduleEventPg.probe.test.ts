/// <mls fileReference="_102034_/l1/server/layer_1_external/events/moduleEventPg.probe.test.ts" enhancement="_blank" />
/**
 * Probe against a REAL PostgreSQL. Off by default. The tester of the monitor step runs it
 * with DATABASE_URL_TEST of a presentation app whose migration already created the tables:
 *
 *   RUN_MODULE_EVENT_PG_PROBE=true DATABASE_URL_TEST=<app database> \
 *     tsx --import test/register-hooks.mjs --import test/setup-l1.ts --test l1/server/layer_1_external/events/moduleEventPg.probe.test.ts
 *
 * Rows use project `probe9` and are removed at the end. Payload is not logged.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import {
  MODULE_EVENT_DELIVERY_TABLE,
  MODULE_EVENT_TABLE,
  claimDue,
  enqueue,
  markDelivered,
  markFailed,
  purgeModuleEvents,
  type ModuleEventDb,
} from '/_102034_/l1/server/layer_1_external/events/moduleEventQueue.js';
import { moduleEventsOf } from '/_102034_/l1/monitor/layer_3_usecases/moduleEvents.js';
import type { ModuleEventEnvelope } from '/_102034_/l1/server/layer_1_external/events/types.js';

const URL = process.env.DATABASE_URL_TEST ?? '';
const ENABLED = process.env.RUN_MODULE_EVENT_PG_PROBE === 'true' && URL !== '';
const PROJECT = 'probe9';
const LEASE_MS = 30_000;

function envelope(eventId: string, publishedAt: string): ModuleEventEnvelope {
  return {
    eventId,
    ref: { module: 'orders', eventId: 'placed' },
    publishedAt,
    payload: { secret: 'module-data' },
    actor: { kind: 'agent', id: 'agent-1' },
    requestId: 'req-probe',
  };
}

function poolDb(pool: pg.Pool): ModuleEventDb {
  return {
    query: (sql, params) => pool.query(sql, params as never[]),
    transaction: async (work) => {
      const client = await pool.connect();
      const tx: ModuleEventDb = {
        query: (sql, params) => client.query(sql, params as never[]),
        transaction: (inner) => inner(tx),
      };
      try {
        await client.query('BEGIN');
        const result = await work(tx);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

describe('module event queue on a real PostgreSQL', { skip: !ENABLED }, () => {
  let pool: pg.Pool;

  before(() => { pool = new pg.Pool({ connectionString: URL }); });

  after(async () => {
    await pool.query(
      `DELETE FROM "${MODULE_EVENT_DELIVERY_TABLE}" d USING "${MODULE_EVENT_TABLE}" e
       WHERE d."eventId" = e."eventId" AND e."projectId" = $1`,
      [PROJECT],
    );
    await pool.query(`DELETE FROM "${MODULE_EVENT_TABLE}" WHERE "projectId" = $1`, [PROJECT]);
    await pool.end();
  });

  it('the two tables exist and are not hypertables', async () => {
    for (const table of [MODULE_EVENT_TABLE, MODULE_EVENT_DELIVERY_TABLE]) {
      const found = await pool.query('SELECT to_regclass($1) AS name', [`"${table}"`]);
      assert.notEqual(found.rows[0]?.name, null, `${table} is missing`);
    }
    const column = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = $1 AND column_name = 'leaseUntil'`,
      [MODULE_EVENT_DELIVERY_TABLE],
    );
    assert.equal(column.rows.length, 1);
    const hyper = await pool.query(
      'SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name = ANY($1)',
      [[MODULE_EVENT_TABLE, MODULE_EVENT_DELIVERY_TABLE]],
    );
    assert.equal(hyper.rows.length, 0);
    console.log('MODULE-EVENT-PG tables ok');
  });

  it('a duplicate subscriber rolls the event back', async () => {
    await assert.rejects(() => enqueue(poolDb(pool), PROJECT, envelope('probe-atomic', '2026-11-19T00:00:00.000Z'), ['billing', 'billing']));
    const left = await pool.query(`SELECT count(*)::int AS n FROM "${MODULE_EVENT_TABLE}" WHERE "eventId" = $1`, ['probe-atomic']);
    assert.equal(left.rows[0]?.n, 0);
    console.log('MODULE-EVENT-PG enqueue atomic ok');
  });

  it('two claims at once do not take the same delivery', async () => {
    const db = poolDb(pool);
    await enqueue(db, PROJECT, envelope('probe-claim', '2026-11-19T00:00:00.000Z'), ['billing']);
    const now = new Date('2026-11-19T00:00:00.000Z');
    const [first, second] = await Promise.all([
      claimDue(db, 10, now, LEASE_MS),
      claimDue(db, 10, now, LEASE_MS),
    ]);
    const taken = [...first, ...second];
    assert.equal(taken.length, 1);
    assert.equal(taken[0]?.consumerModule, 'billing');
    assert.equal(taken[0]?.attempts, 1);
    console.log('MODULE-EVENT-PG claim lease ok');
  });

  it('claims the delivery again after the lease', async () => {
    const db = poolDb(pool);
    await enqueue(db, PROJECT, envelope('probe-lease', '2026-11-19T00:00:00.000Z'), ['billing']);
    const now = new Date('2026-11-19T00:00:00.000Z');
    const first = await claimDue(db, 10, now, 1_000);
    const again = await claimDue(db, 10, new Date(now.getTime() + 1_000), 1_000);
    assert.equal(first[0]?.attempts, 1);
    assert.equal(again[0]?.consumerModule, 'billing');
    assert.equal(again[0]?.attempts, 2);
    console.log('MODULE-EVENT-PG expired lease ok');
  });

  it('retention keeps a failure for 90 days and drops a full delivery after 7', async () => {
    const db = poolDb(pool);
    const old = '2026-10-01T00:00:00.000Z';
    await enqueue(db, PROJECT, envelope('probe-done', old), ['billing']);
    await enqueue(db, PROJECT, envelope('probe-bad', old), ['billing']);
    await enqueue(db, PROJECT, envelope('probe-wait', old), ['billing']);
    await enqueue(db, PROJECT, envelope('probe-held', old), ['billing']);
    const now = new Date(old);
    await claimDue(db, 10, now, LEASE_MS);
    await markDelivered(db, 'probe-done', 'billing', new Date(old));
    await markFailed(db, 'probe-bad', 'billing', 'down');
    await purgeModuleEvents(pool, new Date('2026-11-19T00:00:00.000Z'));
    const afterSeven = await pool.query(
      `SELECT "eventId" FROM "${MODULE_EVENT_TABLE}" WHERE "projectId" = $1 AND "eventId" LIKE 'probe-%' ORDER BY 1`,
      [PROJECT],
    );
    assert.deepEqual(afterSeven.rows.map((row) => row.eventId), ['probe-bad', 'probe-claim', 'probe-held', 'probe-lease', 'probe-wait']);
    await purgeModuleEvents(pool, new Date('2027-02-01T00:00:00.000Z'));
    const afterNinety = await pool.query(
      `SELECT "eventId" FROM "${MODULE_EVENT_TABLE}" WHERE "eventId" = ANY($1) ORDER BY 1`,
      [['probe-bad', 'probe-held', 'probe-wait']],
    );
    assert.deepEqual(afterNinety.rows.map((row) => row.eventId), ['probe-held', 'probe-wait']);
    console.log('MODULE-EVENT-PG retention 7/90 ok');
  });
  it('the monitor view counts by window in the database and never returns the body (rt272 s1)', async () => {
    const db = poolDb(pool);
    const recent = new Date(Date.now() - 3600_000).toISOString();
    const middle = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await enqueue(db, PROJECT, envelope('probe-view-new', recent), ['billing', 'mail']);
    await enqueue(db, PROJECT, envelope('probe-view-mid', middle), ['billing']);
    await markFailed(db, 'probe-view-mid', 'billing', 'no-route');
    const view = await moduleEventsOf({ db: pool }, PROJECT);
    const row = view.events.find((item) => item.event === 'orders.placed');
    assert.ok(row, 'the event appears with the module in front');
    assert.ok(row.published24h >= 1 && row.published7d >= row.published24h + 1);
    assert.ok(row.subscribers.includes('billing') && row.subscribers.includes('mail'));
    assert.ok(row.failed >= 1 && row.pending >= 2);
    const failure = view.failures.find((item) => item.consumerModule === 'billing' && item.reason === 'no-route');
    assert.ok(failure && failure.publishedAt.length > 0, 'a failure carries when it was published, as text');
    assert.equal(JSON.stringify(view).includes('module-data'), false);
    assert.equal((await moduleEventsOf({ db: pool }, PROJECT, 'nobody')).events.length, 0);
    console.log('MODULE-EVENT-PG monitor view ok');
  });
});
