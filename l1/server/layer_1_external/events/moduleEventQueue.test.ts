/// <mls fileReference="_102034_/l1/server/layer_1_external/events/moduleEventQueue.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MODULE_EVENT_DELIVERY_TABLE,
  MODULE_EVENT_TABLE,
  claimDue,
  enqueue,
  markDelivered,
  markFailed,
  markRetry,
  moduleEventDefinition,
  moduleEventDeliveryDefinition,
  purgeModuleEvents,
  type ModuleEventDb,
} from '/_102034_/l1/server/layer_1_external/events/moduleEventQueue.js';
import type { ModuleEventEnvelope } from '/_102034_/l1/server/layer_1_external/events/types.js';

interface EventRow {
  eventId: string;
  projectId: string;
  moduleId: string;
  event: string;
  payload: unknown;
  actorKind: string | null;
  actorId: string | null;
  requestId: string | null;
  publishedAt: string;
}

interface DeliveryRow {
  eventId: string;
  consumerModule: string;
  attempts: number;
  nextAttemptAt: string;
  leaseUntil: string | null;
  result: string;
  reason: string | null;
  deliveredAt: string | null;
}

function memoryQueue(): ModuleEventDb & { events: Map<string, EventRow>; deliveries: DeliveryRow[]; setFailDelivery(value: boolean): void } {
  const events = new Map<string, EventRow>();
  const deliveries: DeliveryRow[] = [];
  const state = { failDelivery: false };

  function snapshot() {
    return {
      events: new Map(events),
      deliveries: deliveries.map((row) => ({ ...row })),
    };
  }

  function restore(saved: ReturnType<typeof snapshot>): void {
    events.clear();
    for (const [key, row] of saved.events) events.set(key, row);
    deliveries.splice(0, deliveries.length, ...saved.deliveries);
  }

  function find(eventId: unknown, consumerModule: unknown): DeliveryRow | undefined {
    return deliveries.find((row) => row.eventId === eventId && row.consumerModule === consumerModule);
  }

  function query(statement: string, values: readonly unknown[] = []): { rows: unknown[] } {
    if (statement.startsWith('INSERT INTO "platform_module_events"')) {
      const eventId = String(values[0]);
      if (events.has(eventId)) throw new Error('duplicate event');
      events.set(eventId, {
        eventId,
        projectId: String(values[1]),
        moduleId: String(values[2]),
        event: String(values[3]),
        payload: JSON.parse(String(values[4])),
        actorKind: typeof values[5] === 'string' ? values[5] : null,
        actorId: typeof values[6] === 'string' ? values[6] : null,
        requestId: typeof values[7] === 'string' ? values[7] : null,
        publishedAt: String(values[8]),
      });
      return { rows: [] };
    }
    if (statement.startsWith('INSERT INTO "platform_module_event_deliveries"')) {
      if (state.failDelivery) throw new Error('delivery write failed');
      const eventId = String(values[0]);
      const consumerModule = String(values[1]);
      if (find(eventId, consumerModule)) throw new Error('duplicate delivery');
      deliveries.push({
        eventId,
        consumerModule,
        attempts: 0,
        nextAttemptAt: String(values[2]),
        leaseUntil: null,
        result: 'pending',
        reason: null,
        deliveredAt: null,
      });
      return { rows: [] };
    }
    if (statement.startsWith('WITH due AS')) {
      const now = String(values[0]);
      const limit = Number(values[1]);
      const leaseUntil = String(values[2]);
      const due = deliveries
        .filter((row) => (row.result === 'pending' && row.nextAttemptAt <= now)
          || (row.result === 'delivering' && row.leaseUntil !== null && row.leaseUntil <= now))
        .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt) || a.eventId.localeCompare(b.eventId) || a.consumerModule.localeCompare(b.consumerModule))
        .slice(0, limit);
      const rows = due.map((row) => {
        row.result = 'delivering';
        row.leaseUntil = leaseUntil;
        row.attempts += 1;
        const event = events.get(row.eventId);
        return { ...event, payload: event?.payload ?? null, consumerModule: row.consumerModule, attempts: row.attempts, nextAttemptAt: row.nextAttemptAt };
      });
      return { rows };
    }
    if (statement.startsWith('DELETE FROM "platform_module_events"')) {
      const deliveredBefore = String(values[0]);
      const failedBefore = String(values[1]);
      for (const event of [...events.values()]) {
        const own = deliveries.filter((row) => row.eventId === event.eventId);
        const open = (row: DeliveryRow) => row.result === 'pending' || row.result === 'delivering';
        const allDelivered = own.length > 0 && own.every((row) => row.result === 'delivered') && event.publishedAt < deliveredBefore;
        const failedKept = own.some((row) => row.result === 'failed')
          && own.every((row) => !open(row))
          && event.publishedAt < failedBefore;
        if (allDelivered || failedKept) events.delete(event.eventId);
      }
      return { rows: [] };
    }
    if (statement.startsWith('DELETE FROM "platform_module_event_deliveries"')) {
      for (let index = deliveries.length - 1; index >= 0; index -= 1) {
        if (!events.has(deliveries[index].eventId)) deliveries.splice(index, 1);
      }
      return { rows: [] };
    }
    if (statement.includes(`"result" = 'delivered'`)) {
      const row = find(values[0], values[1]);
      if (row?.result === 'delivering') {
        row.result = 'delivered';
        row.deliveredAt = String(values[2]);
        row.leaseUntil = null;
      }
      return { rows: [] };
    }
    if (statement.includes(`"result" = 'pending'`) && statement.includes('"nextAttemptAt"')) {
      const row = find(values[0], values[1]);
      if (row?.result === 'delivering') {
        row.result = 'pending';
        row.nextAttemptAt = String(values[2]);
        row.leaseUntil = null;
        row.reason = null;
      }
      return { rows: [] };
    }
    if (statement.includes(`"result" = 'failed'`)) {
      const row = find(values[0], values[1]);
      if (row?.result === 'delivering') {
        row.result = 'failed';
        row.reason = String(values[2]);
        row.leaseUntil = null;
      }
      return { rows: [] };
    }
    throw new Error(`unexpected sql: ${statement}`);
  }

  const db: ModuleEventDb = {
    query: async (statement, params) => query(statement, params ?? []),
    transaction: async (work) => {
      const saved = snapshot();
      try {
        return await work(db);
      } catch (error) {
        restore(saved);
        throw error;
      }
    },
  };
  return Object.assign(db, {
    events,
    deliveries,
    setFailDelivery(value: boolean) { state.failDelivery = value; },
  });
}

const envelope: ModuleEventEnvelope = {
  eventId: 'evt-1',
  ref: { module: 'orders', eventId: 'placed' },
  publishedAt: '2026-11-01T00:00:00.000Z',
  payload: { orderId: 'o-1' },
  actor: { kind: 'person', id: 'person-1' },
  requestId: 'req-1',
};

const LEASE_MS = 5_000;

describe('module event queue', () => {
  it('writes the event and its deliveries in one transaction', async () => {
    const db = memoryQueue();
    await enqueue(db, '102034', envelope, ['billing', 'stock']);
    assert.equal(db.events.size, 1);
    assert.equal(db.deliveries.length, 2);
    assert.equal(moduleEventDefinition.tableName, MODULE_EVENT_TABLE);
    assert.deepEqual(moduleEventDeliveryDefinition.primaryKey, ['eventId', 'consumerModule']);
    assert.equal(moduleEventDefinition.timescale, undefined);
    assert.equal(moduleEventDeliveryDefinition.columns.some((column) => column.name === 'leaseUntil'), true);
  });

  it('rolls the event back when a delivery insert fails', async () => {
    const db = memoryQueue();
    db.setFailDelivery(true);
    await assert.rejects(() => enqueue(db, '102034', envelope, ['billing']));
    assert.equal(db.events.size, 0);
    assert.equal(db.deliveries.length, 0);
  });

  it('a second claim leaves the delivery while the lease holds', async () => {
    const db = memoryQueue();
    await enqueue(db, '102034', envelope, ['billing']);
    const now = new Date('2026-11-01T00:00:00.000Z');
    const first = await claimDue(db, 10, now, LEASE_MS);
    const second = await claimDue(db, 10, now, LEASE_MS);
    assert.deepEqual(first.map((row) => row.consumerModule), ['billing']);
    assert.equal(first[0]?.attempts, 1);
    assert.deepEqual(second, []);
    assert.equal(db.deliveries[0]?.result, 'delivering');
  });

  it('claims the same delivery again after the lease and counts the attempt', async () => {
    const db = memoryQueue();
    await enqueue(db, '102034', envelope, ['billing']);
    const now = new Date('2026-11-01T00:00:00.000Z');
    await claimDue(db, 10, now, LEASE_MS);
    const again = await claimDue(db, 10, new Date(now.getTime() + LEASE_MS), LEASE_MS);
    assert.deepEqual(again.map((row) => row.consumerModule), ['billing']);
    assert.equal(again[0]?.attempts, 2);
    assert.equal(db.deliveries[0]?.attempts, 2);
  });

  it('markRetry waits until the next time and markFailed keeps a short reason', async () => {
    const db = memoryQueue();
    await enqueue(db, '102034', envelope, ['billing']);
    const now = new Date('2026-11-01T00:00:00.000Z');
    await claimDue(db, 10, now, LEASE_MS);
    const next = new Date('2026-11-02T00:00:00.000Z');
    await markRetry(db, 'evt-1', 'billing', next);
    assert.equal(db.deliveries[0]?.result, 'pending');
    assert.equal(db.deliveries[0]?.leaseUntil, null);
    assert.deepEqual(await claimDue(db, 10, now, LEASE_MS), []);
    const later = await claimDue(db, 10, next, LEASE_MS);
    assert.equal(later[0]?.consumerModule, 'billing');
    await markFailed(db, 'evt-1', 'billing', 'x'.repeat(300));
    assert.equal(db.deliveries[0]?.result, 'failed');
    assert.equal(db.deliveries[0]?.reason?.length, 200);
    assert.equal(db.deliveries[0]?.attempts, 2);
  });

  it('does not purge an event that still has a delivering row', async () => {
    const db = memoryQueue();
    const old = '2026-10-01T00:00:00.000Z';
    await enqueue(db, '102034', { ...envelope, eventId: 'done', publishedAt: old }, ['billing']);
    await enqueue(db, '102034', { ...envelope, eventId: 'bad', publishedAt: old }, ['billing']);
    await enqueue(db, '102034', { ...envelope, eventId: 'wait', publishedAt: old }, ['billing']);
    await enqueue(db, '102034', { ...envelope, eventId: 'held', publishedAt: old }, ['billing']);
    await enqueue(db, '102034', { ...envelope, eventId: 'fresh', publishedAt: '2026-11-18T00:00:00.000Z' }, ['billing']);
    const now = new Date('2026-11-01T00:00:00.000Z');
    await claimDue(db, 10, now, LEASE_MS);
    await claimDue(db, 10, new Date('2026-11-18T00:00:00.000Z'), LEASE_MS);
    await markDelivered(db, 'done', 'billing', new Date(old));
    await markDelivered(db, 'fresh', 'billing', new Date('2026-11-18T00:00:00.000Z'));
    await markFailed(db, 'bad', 'billing', 'down');
    await markRetry(db, 'wait', 'billing', new Date('2026-12-01T00:00:00.000Z'));
    await purgeModuleEvents(db, new Date('2026-11-19T00:00:00.000Z'));
    assert.deepEqual([...db.events.keys()].sort(), ['bad', 'fresh', 'held', 'wait']);
    await purgeModuleEvents(db, new Date('2027-02-01T00:00:00.000Z'));
    assert.equal(db.events.has('bad'), false);
    assert.equal(db.events.has('fresh'), false);
    assert.equal(db.deliveries.some((row) => row.eventId === 'bad'), false);
    assert.equal(db.events.has('held'), true);
    assert.equal(db.deliveries.find((row) => row.eventId === 'held')?.result, 'delivering');
    assert.equal(db.events.has('wait'), true);
  });
});
