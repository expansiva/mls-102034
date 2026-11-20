/// <mls fileReference="_102034_/l1/server/layer_1_external/events/deliverModuleEvents.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import type { RequestSessionContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { bindModuleDataContext } from '/_102034_/l1/server/layer_1_external/events/persistence.js';
import type { IModuleDataRuntime, ITableRepository } from '/_102034_/l1/server/layer_1_external/data/moduleDataRuntime.js';
import {
  MODULE_EVENT_DELIVERY_TABLE,
  claimDue,
  enqueue,
  type ModuleEventDb,
} from '/_102034_/l1/server/layer_1_external/events/moduleEventQueue.js';
import {
  MODULE_EVENT_MAX_ATTEMPTS,
  createDeliveryRunner,
  deliverDueModuleEvents,
  type DeliverModuleEventsDeps,
} from '/_102034_/l1/server/layer_1_external/events/deliverModuleEvents.js';
import type { ModuleEventEnvelope } from '/_102034_/l1/server/layer_1_external/events/types.js';
import type { ServeRoute } from '/_102034_/l1/workflow/connectionServe.js';

const SECRET = 'PAYLOAD_SECRET_XYZ';
const NOW = new Date('2026-11-19T12:00:00.000Z');

interface EventRow {
  eventId: string;
  projectId: string;
  moduleId: string;
  event: string;
  payload: unknown;
  actorKind: 'person' | 'agent' | null;
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

interface NoteRow {
  id: string;
  eventId: string;
}

function queueDb(events: Map<string, EventRow>, deliveries: DeliveryRow[]): ModuleEventDb {
  const find = (eventId: unknown, consumer: unknown) =>
    deliveries.find((row) => row.eventId === eventId && row.consumerModule === consumer);
  return {
    async query(statement, params = []) {
      const values = params;
      if (statement.startsWith('INSERT INTO "platform_module_events"')) {
        events.set(String(values[0]), {
          eventId: String(values[0]),
          projectId: String(values[1]),
          moduleId: String(values[2]),
          event: String(values[3]),
          payload: JSON.parse(String(values[4])),
          actorKind: values[5] === 'person' || values[5] === 'agent' ? values[5] : null,
          actorId: typeof values[6] === 'string' ? values[6] : null,
          requestId: typeof values[7] === 'string' ? values[7] : null,
          publishedAt: String(values[8]),
        });
        return { rows: [] };
      }
      if (statement.startsWith('INSERT INTO "platform_module_event_deliveries"')) {
        deliveries.push({
          eventId: String(values[0]),
          consumerModule: String(values[1]),
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
        return {
          rows: due.map((row) => {
            row.result = 'delivering';
            row.leaseUntil = leaseUntil;
            row.attempts += 1;
            const event = events.get(row.eventId);
            return { ...event, consumerModule: row.consumerModule, attempts: row.attempts, nextAttemptAt: row.nextAttemptAt };
          }),
        };
      }
      if (statement.includes(`"result" = 'pending'`) && statement.includes('"nextAttemptAt"')) {
        const row = find(values[0], values[1]);
        const attempts = values.length > 3 ? Number(values[3]) : undefined;
        if (row?.result === 'delivering' && (attempts === undefined || row.attempts === attempts)) {
          row.result = 'pending';
          row.nextAttemptAt = String(values[2]);
          row.leaseUntil = null;
          row.reason = null;
        }
        return { rows: [] };
      }
      if (statement.includes(`"result" = 'failed'`)) {
        const row = find(values[0], values[1]);
        const attempts = values.length > 3 ? Number(values[3]) : undefined;
        if (row?.result === 'delivering' && (attempts === undefined || row.attempts === attempts)) {
          row.result = 'failed';
          row.reason = String(values[2]);
          row.leaseUntil = null;
        }
        return { rows: [] };
      }
      throw new Error(`unexpected sql: ${statement}`);
    },
    async transaction(work) {
      return work(this);
    },
  };
}

function world() {
  const events = new Map<string, EventRow>();
  const deliveries: DeliveryRow[] = [];
  const notes: NoteRow[] = [];
  let snapshot: { deliveries: DeliveryRow[]; notes: NoteRow[] } | undefined;
  const copy = () => ({
    deliveries: deliveries.map((row) => ({ ...row })),
    notes: notes.map((row) => ({ ...row })),
  });
  const restore = (saved: { deliveries: DeliveryRow[]; notes: NoteRow[] }) => {
    deliveries.splice(0, deliveries.length, ...saved.deliveries.map((row) => ({ ...row })));
    notes.splice(0, notes.length, ...saved.notes.map((row) => ({ ...row })));
  };
  const moduleData: IModuleDataRuntime = {
    async getTable<TRecord extends object>(name: string): Promise<ITableRepository<TRecord>> {
      const repository = {
        async insert(input: { record: TRecord }) {
          if (name !== 'subscriber_notes') return;
          notes.push({ ...(input.record as NoteRow) });
        },
        async update(input: { where: Partial<DeliveryRow>; patch: Partial<DeliveryRow> }) {
          if (name !== MODULE_EVENT_DELIVERY_TABLE) return;
          const row = deliveries.find((item) =>
            item.eventId === input.where.eventId
            && item.consumerModule === input.where.consumerModule
            && item.result === input.where.result
            && item.attempts === input.where.attempts);
          if (!row) return;
          Object.assign(row, input.patch);
        },
        async findOne(input: { where: Partial<DeliveryRow> }) {
          return deliveries.find((item) =>
            item.eventId === input.where.eventId
            && item.consumerModule === input.where.consumerModule
            && item.result === input.where.result
            && item.deliveredAt === input.where.deliveredAt
            && item.attempts === input.where.attempts) ?? null;
        },
      };
      return repository as ITableRepository<TRecord>;
    },
    async listTables() {
      return [];
    },
    async runInTransaction(callback) {
      const outer = snapshot === undefined;
      if (outer) snapshot = copy();
      try {
        const value = await callback(moduleData);
        if (outer) snapshot = undefined;
        return value;
      } catch (error) {
        if (outer && snapshot) restore(snapshot);
        if (outer) snapshot = undefined;
        throw error;
      }
    },
  };
  return { db: queueDb(events, deliveries), moduleData, deliveries, notes };
}

function envelope(eventId: string): ModuleEventEnvelope {
  return {
    eventId,
    ref: { module: 'orders', eventId: 'placed' },
    publishedAt: NOW.toISOString(),
    payload: { token: SECRET },
    actor: { kind: 'person', id: 'person-1' },
  };
}

/** The context the platform tick receives: the server's own factory, never a hand-made object. */
function tickContext() {
  return createRequestContext(createMemoryDataRuntime(), {
    moduleId: 'platformModuleEvents',
    sessionContext: { project: { projectId: '900281' } } as RequestSessionContext,
  });
}

function harness(
  store: ReturnType<typeof world>,
  call: DeliverModuleEventsDeps['callRoute'],
  routes: Record<string, string | undefined> = { billing: 'billing.inbox.take', stock: 'stock.inbox.take' },
  deadlineMs?: number,
) {
  const lines: string[] = [];
  const run = (now = NOW) => deliverDueModuleEvents({
    db: store.db,
    moduleData: store.moduleData,
    now,
    bindContext: bindModuleDataContext(tickContext()),
    findRoute: async (_project, consumer) => {
      const route = routes[consumer];
      return route ? { moduleId: consumer, route } : undefined;
    },
    callRoute: call,
    log: (line) => lines.push(line),
    ...(deadlineMs !== undefined ? { deadlineMs } : {}),
  });
  return { run, lines };
}

describe('module event delivery', () => {
  it('delivers one event to two subscribers and does not call a confirmed route again', async () => {
    const store = world();
    await enqueue(store.db, '102034', envelope('evt-1'), ['billing', 'stock']);
    const seen: string[] = [];
    const { run } = harness(store, async (route, body, ctx) => {
      assert.equal(ctx.data.moduleData, store.moduleData);
      // the delivery keeps the project and the module of the tick context (the route's own module comes from execBff)
      assert.equal(ctx.sessionContext.project?.projectId, '900281');
      assert.equal(ctx.moduleId, 'platformModuleEvents');
      assert.equal(body.eventId, 'evt-1');
      seen.push(route.moduleId);
      return 200;
    });
    await run();
    assert.deepEqual(seen.sort(), ['billing', 'stock']);
    assert.equal(store.deliveries.every((row) => row.result === 'delivered'), true);
    seen.length = 0;
    await run();
    assert.deepEqual(seen, []);
  });

  it('retries one subscriber without touching the one that confirmed', async () => {
    const store = world();
    await enqueue(store.db, '102034', envelope('evt-2'), ['billing', 'stock']);
    const { run } = harness(store, async (route) => (route.moduleId === 'stock' ? 500 : 204));
    await run();
    const billing = store.deliveries.find((row) => row.consumerModule === 'billing');
    const stock = store.deliveries.find((row) => row.consumerModule === 'stock');
    assert.equal(billing?.result, 'delivered');
    assert.equal(stock?.result, 'pending');
    assert.equal(stock?.attempts, 1);
    assert.equal(stock?.nextAttemptAt, new Date(NOW.getTime() + 10_000).toISOString());
  });

  it('fails the delivery after five attempts', async () => {
    const store = world();
    await enqueue(store.db, '102034', envelope('evt-3'), ['stock']);
    const { run } = harness(store, async () => 500);
    let now = NOW;
    for (let attempt = 1; attempt <= MODULE_EVENT_MAX_ATTEMPTS; attempt += 1) {
      await run(now);
      const row = store.deliveries[0];
      if (attempt < MODULE_EVENT_MAX_ATTEMPTS) {
        assert.equal(row?.result, 'pending');
        now = new Date(row!.nextAttemptAt);
      }
    }
    assert.equal(store.deliveries[0]?.result, 'failed');
    assert.equal(store.deliveries[0]?.attempts, 5);
    assert.equal(store.deliveries[0]?.reason, 'status');
  });

  it('fails with no-route when the subscriber dropped the mark', async () => {
    const store = world();
    await enqueue(store.db, '102034', envelope('evt-4'), ['stock']);
    let calls = 0;
    const { run } = harness(store, async () => {
      calls += 1;
      return 200;
    }, {});
    await run();
    assert.equal(calls, 0);
    assert.equal(store.deliveries[0]?.result, 'failed');
    assert.equal(store.deliveries[0]?.reason, 'no-route');
  });

  it('two deliverers claim one delivery once', async () => {
    const store = world();
    await enqueue(store.db, '102034', envelope('evt-5'), ['billing']);
    let calls = 0;
    const { run } = harness(store, async () => {
      calls += 1;
      return 200;
    });
    await Promise.all([run(), run()]);
    assert.equal(calls, 1);
    assert.equal(store.deliveries[0]?.result, 'delivered');
    assert.equal(await claimDue(store.db, 10, NOW, 1000).then((rows) => rows.length), 0);
  });

  it('rolls back the subscriber write and the mark when the route fails, then writes once', async () => {
    const store = world();
    await enqueue(store.db, '102034', envelope('evt-6'), ['billing']);
    let calls = 0;
    const { run } = harness(store, async (_route, body, ctx) => {
      calls += 1;
      const table = await ctx.data.moduleData.getTable<NoteRow>('subscriber_notes');
      await table.insert({ record: { id: `n-${calls}`, eventId: body.eventId } });
      if (calls === 1) throw new Error(`boom ${SECRET}`);
      return 200;
    });
    await run();
    assert.equal(store.notes.length, 0);
    assert.equal(store.deliveries[0]?.result, 'pending');
    await run(new Date(store.deliveries[0]!.nextAttemptAt));
    assert.equal(calls, 2);
    assert.equal(store.notes.length, 1);
    assert.equal(store.deliveries[0]?.result, 'delivered');
    await run(new Date(store.deliveries[0]!.nextAttemptAt));
    assert.equal(calls, 2);
    assert.equal(store.notes.length, 1);
  });

  it('a route that outlives the deadline is a failure, and its late write is still rolled back with the transaction', async () => {
    const store = world();
    await enqueue(store.db, '102034', envelope('evt-late'), ['billing']);
    const { run, lines } = harness(store, async (_route, body, ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      // after the deadline (20 ms): the transaction must still be open, so this write is undone with it
      const table = await ctx.data.moduleData.getTable<NoteRow>('subscriber_notes');
      await table.insert({ record: { id: 'late', eventId: body.eventId } });
      return 200;
    }, undefined, 20);
    await run();
    assert.equal(store.notes.length, 0);
    assert.equal(store.deliveries[0]?.result, 'pending');
    assert.match(lines.join('\n'), /retry/);
  });

  it('does not write the payload on the delivery log', async () => {
    const store = world();
    await enqueue(store.db, '102034', envelope('evt-7'), ['billing']);
    const { run, lines } = harness(store, async () => 200);
    await run();
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.includes(SECRET), false);
    assert.match(lines[0] ?? '', /orders\.placed billing delivered ms=\d+/);
  });
});

describe('delivery runner apart from the common tick', () => {
  it('start returns at once with a route that never ends, and no second round starts meanwhile', async () => {
    const lines: string[] = [];
    const runner = createDeliveryRunner({ log: (line) => lines.push(line), busyLogEveryMs: 1000 });
    let release: () => void = () => undefined;
    const stuck = new Promise<void>((resolve) => { release = resolve; });
    let rounds = 0;
    const round = () => { rounds += 1; return stuck; };
    assert.equal(runner.start(round, 0), true);
    assert.equal(runner.inFlight(), true);
    // the common tick came back at once and the next tick finds the round still running
    assert.equal(runner.start(round, 60_000), false);
    assert.equal(runner.start(round, 120_000), false);
    assert.equal(rounds, 1);
    // the stuck route shows up, but not at every tick
    assert.equal(lines.length, 2);
    assert.equal(runner.start(round, 120_500), false);
    assert.equal(lines.length, 2);
    release();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(runner.inFlight(), false);
    assert.equal(runner.start(async () => undefined, 180_000), true);
  });

  it('a round that fails is logged, not a loose promise, and the next one can start', async () => {
    const lines: string[] = [];
    const runner = createDeliveryRunner({ log: (line) => lines.push(line) });
    assert.equal(runner.start(async () => { throw new TypeError('boom'); }, 0), true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.match(lines.join('\n'), /delivery round failed: TypeError/);
    assert.equal(lines.join('\n').includes('boom'), false);
    assert.equal(runner.inFlight(), false);
    assert.equal(runner.start(async () => undefined, 60_000), true);
  });
});
