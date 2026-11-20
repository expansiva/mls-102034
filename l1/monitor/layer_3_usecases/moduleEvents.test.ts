/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/moduleEvents.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { ModuleEventDb } from '/_102034_/l1/server/layer_1_external/events/moduleEventQueue.js';
import { monitorModuleEventsListHandler } from '/_102034_/l1/monitor/layer_2_controllers/moduleEventsHandlers.js';
import {
  MODULE_EVENT_DELIVERIES_SQL,
  MODULE_EVENT_FAILURES_SQL,
  MODULE_EVENT_PUBLISHED_SQL,
  moduleEventsOf,
  type ModuleEventsDeps,
} from '/_102034_/l1/monitor/layer_3_usecases/moduleEvents.js';

const SECRET = 'payload-secret-do-not-leak';

/** A database that answers each of the three queries with the rows the test gives, and records what was asked. */
function db(rows: { published?: unknown[]; deliveries?: unknown[]; failures?: unknown[] }): ModuleEventsDeps & { asked: Array<{ sql: string; params: readonly unknown[] }> } {
  const asked: Array<{ sql: string; params: readonly unknown[] }> = [];
  const query: ModuleEventDb['query'] = async (sql, params = []) => {
    asked.push({ sql, params });
    if (sql === MODULE_EVENT_PUBLISHED_SQL) return { rows: rows.published ?? [] };
    if (sql === MODULE_EVENT_DELIVERIES_SQL) return { rows: rows.deliveries ?? [] };
    if (sql === MODULE_EVENT_FAILURES_SQL) return { rows: rows.failures ?? [] };
    throw new Error('unexpected query');
  };
  return { db: { query }, asked };
}

function keysOf(value: unknown, found: string[] = []): string[] {
  if (value === null || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, found);
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    found.push(key);
    keysOf(child, found);
  }
  return found;
}

test('no query reads the event body or the actor, and every one is scoped to the project', async () => {
  const fake = db({});
  await moduleEventsOf(fake, '102047', 'shop');
  assert.equal(fake.asked.length, 3);
  for (const { sql, params } of fake.asked) {
    for (const column of ['payload', 'actorId', 'actorKind', 'requestId']) assert.equal(sql.includes(column), false, column);
    assert.equal(sql.includes('"projectId" = $1'), true);
    assert.deepEqual(params, ['102047', 'shop']);
  }
});

test('the view is the counts of the database, with the event name and sorted subscribers', async () => {
  const view = await moduleEventsOf(db({
    published: [
      { moduleId: 'shop', event: 'ordered', published24h: 1, published7d: 2 },
      { moduleId: 'shop', event: 'shop.quiet', published24h: 0, published7d: 1 },
    ],
    deliveries: [
      { moduleId: 'shop', event: 'ordered', consumerModule: 'mail', result: 'pending', n: 1 },
      { moduleId: 'shop', event: 'ordered', consumerModule: 'mail', result: 'delivering', n: 1 },
      { moduleId: 'shop', event: 'ordered', consumerModule: 'billing', result: 'delivered', n: '3' },
      { moduleId: 'shop', event: 'ordered', consumerModule: 'billing', result: 'failed', n: 1 },
    ],
    failures: [{ moduleId: 'shop', event: 'ordered', consumerModule: 'billing', attempts: 5, reason: 'x'.repeat(250), publishedAt: '2026-11-19 12:00:00+00' }],
  }), 'p');
  assert.deepEqual(view.events.map((row) => row.event), ['shop.ordered', 'shop.quiet']);
  assert.deepEqual(view.events[0], {
    event: 'shop.ordered', subscribers: ['billing', 'mail'], published24h: 1, published7d: 2, delivered: 3, pending: 2, failed: 1,
  });
  assert.equal(view.events[1]?.subscribers.length, 0);
  assert.equal(view.failures.length, 1);
  assert.equal(view.failures[0]?.event, 'shop.ordered');
  assert.equal(view.failures[0]?.reason.length, 200);
  assert.equal(view.failures[0]?.attempts, 5);
  assert.equal(view.failures[0]?.publishedAt, '2026-11-19 12:00:00+00');
});

test('the view has no field of the event body even when a row carries one', async () => {
  const view = await moduleEventsOf(db({
    published: [{ moduleId: 'shop', event: 'ordered', published24h: 1, published7d: 1, payload: SECRET, actorId: 'actor-secret', requestId: 'request-secret' }],
    failures: [{ moduleId: 'shop', event: 'ordered', consumerModule: 'billing', attempts: 1, reason: 'no-route', publishedAt: 'x', payload: SECRET }],
  }), 'p');
  const packed = JSON.stringify(view);
  for (const leaked of [SECRET, 'actor-secret', 'request-secret']) assert.equal(packed.includes(leaked), false);
  const names = keysOf(view);
  for (const name of ['payload', 'actorId', 'actorKind', 'requestId']) assert.equal(names.includes(name), false, name);
});

test('the handler refuses shop:admin and an empty authority list, and monitor:admin passes', async () => {
  const call = (authorities: string[]) => monitorModuleEventsListHandler({
    request: {
      routine: 'monitor.moduleEvents.list',
      params: { module: 'shop', projectId: 'other-project' },
      meta: { verifiedUserId: 'u1', verifiedAuthorities: authorities },
    },
    ctx: {} as never,
  });
  const forbidden = (error: unknown) => error instanceof AppError && error.statusCode === 403;
  await assert.rejects(() => call(['shop:admin']), forbidden);
  await assert.rejects(() => call([]), forbidden);
  const passed = await call(['monitor:admin']);
  assert.equal(passed.ok, true);
  assert.equal(JSON.stringify(passed).includes('payload'), false);
});
