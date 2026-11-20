/// <mls fileReference="_102034_/l1/server/layer_1_external/events/publishModuleEvent.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { RequestContext, RequestSessionContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { DefsReader } from '/_102034_/l1/workflow/assistantCatalogDefs.js';
import { buildConsumesIndex, findConsumesRoute } from '/_102034_/l1/workflow/connectionServe.js';
import type { IModuleDataRuntime, ITableRepository } from '/_102034_/l1/server/layer_1_external/data/moduleDataRuntime.js';
import {
  MODULE_EVENT_DELIVERY_TABLE,
  MODULE_EVENT_TABLE,
} from '/_102034_/l1/server/layer_1_external/events/moduleEventQueue.js';
import {
  createModuleEventPublisher,
  createPublishModuleEvent,
  publishModuleEvent,
  type PublishModuleEvent,
} from '/_102034_/l1/server/layer_1_external/events/publishModuleEvent.js';
import type { ModuleEventEnvelope, ModuleEventsIndex } from '/_102034_/l1/server/layer_1_external/events/types.js';
import {
  createFakeConsumesRoute,
  exampleEventIndex,
  publishModuleEvent as fakePublishModuleEvent,
} from '/_102034_/testing/events/eventFixtures.js';

const REF = { module: 'sourceModule', eventId: 'happened' };
/**
 * The context is built by the server's own factory, the way a request of a module gets it: the project in
 * `sessionContext.project`, the caller module in `moduleId`, the actor in `sessionContext.actorId` and `requestMeta`.
 * Never a hand-made object (a test of 19/11 used `project` at the top, which the real context does not have).
 */
function realContext(options: { moduleId?: string; actorType?: 'user' | 'agent' | 'system'; actorId?: string } = {}): RequestContext {
  const ctx = createRequestContext(createMemoryDataRuntime(), {
    moduleId: options.moduleId ?? 'sourceModule',
    sessionContext: { project: { projectId: '900281' }, actorId: options.actorId ?? 'person-1' } as RequestSessionContext,
  });
  ctx.requestMeta = { actorType: options.actorType ?? 'user', requestId: 'req-1' };
  return ctx;
}
const CONTEXT = realContext();

function publisher(index: ModuleEventsIndex) {
  const queued: Array<{ envelope: ModuleEventEnvelope; consumers: readonly string[] }> = [];
  const publish = createModuleEventPublisher({
    index: async () => index,
    enqueue: async (envelope, consumers) => {
      queued.push({ envelope, consumers });
    },
    now: () => new Date('2026-11-19T12:00:00.000Z'),
    newId: () => 'event-1',
    log: () => undefined,
  });
  return { publish, queued };
}

describe('publishModuleEvent', () => {
  it('enqueues a declared event for the subscribers in the index', async () => {
    const { publish, queued } = publisher(exampleEventIndex());
    const result = await publish(REF, { n: 1 }, CONTEXT, { requestId: 'req-opts' });
    assert.deepEqual(result, { ok: true, output: { eventId: 'event-1' } });
    assert.equal(queued.length, 1);
    assert.deepEqual(queued[0].consumers, ['readerModule']);
    assert.equal(queued[0].envelope.eventId, 'event-1');
    assert.deepEqual(queued[0].envelope.ref, REF);
    assert.equal(queued[0].envelope.publishedAt, '2026-11-19T12:00:00.000Z');
    assert.deepEqual(queued[0].envelope.payload, { n: 1 });
    assert.deepEqual(queued[0].envelope.actor, { kind: 'person', id: 'person-1' });
    assert.equal(queued[0].envelope.requestId, 'req-opts');
  });

  it('refuses a payload that cannot be serialized or is too large, and does not enqueue it', async () => {
    const { publish, queued } = publisher(exampleEventIndex());
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const payload of [circular, 'x'.repeat(1024 * 1024 + 1), undefined]) {
      const result = await publish(REF, payload, CONTEXT);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'invalid');
    }
    assert.equal(queued.length, 0);
  });

  it('refuses an event the caller does not publish', async () => {
    const { publish, queued } = publisher(exampleEventIndex());
    const result = await publish({ module: 'sourceModule', eventId: 'unknown' }, {}, CONTEXT);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'forbidden');
    assert.equal(queued.length, 0);
  });

  it('answers ok and does not enqueue when nobody subscribes', async () => {
    const { publish, queued } = publisher(exampleEventIndex());
    const result = await publish({ module: 'sourceModule', eventId: 'quiet' }, { n: 0 }, CONTEXT);
    assert.deepEqual(result, { ok: true, output: { eventId: 'event-1' } });
    assert.equal(queued.length, 0);
  });

  it('finds the route of a module by the consumes mark', async () => {
    const fake = createFakeConsumesRoute({
      moduleId: 'readerModule',
      route: 'readerModule.inbox.take',
      consumes: 'sourceModule.happened',
    });
    const files = new Map<string, unknown>([
      [`l1/${fake.moduleId}/layer_2_application/requests/inbox.defs.js`, { data: { requests: [fake.request] } }],
    ]);
    const reader: DefsReader = {
      list: (folder) => [...files.keys()].filter((file) => file.startsWith(`${folder}/`)).map((file) => file.slice(folder.length + 1)).sort(),
      read: async (file) => files.get(file),
      json: () => undefined,
      text: () => undefined,
    };
    const index = await buildConsumesIndex(reader, [fake.moduleId]);
    assert.deepEqual(index.issues, []);
    assert.deepEqual(findConsumesRoute(index, fake.moduleId, fake.request.consumes), {
      moduleId: 'readerModule',
      route: 'readerModule.inbox.take',
    });
    assert.equal(findConsumesRoute(index, 'otherModule', fake.request.consumes), undefined);
  });
});

interface StoredRow {
  eventId?: string;
  consumerModule?: string;
}

function copyTables(source: Map<string, StoredRow[]>): Map<string, StoredRow[]> {
  return new Map([...source].map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
}

/** Joins a nested `runInTransaction` and restores the snapshot when the outer one throws. */
function createRollingRuntime(failDelivery: boolean): { runtime: IModuleDataRuntime; tables: Map<string, StoredRow[]> } {
  const tables = new Map<string, StoredRow[]>();
  let depth = 0;
  let snapshot: Map<string, StoredRow[]> | undefined;

  const runtime: IModuleDataRuntime = {
    async getTable<TRecord extends object>(name: string): Promise<ITableRepository<TRecord>> {
      const rows = tables.get(name) ?? [];
      tables.set(name, rows);
      const repository = {
        async insert(input: { record: TRecord }): Promise<void> {
          const row = input.record as StoredRow;
          if (failDelivery && name === MODULE_EVENT_DELIVERY_TABLE) throw new Error('delivery insert failed');
          rows.push({ ...row });
        },
      };
      return repository as ITableRepository<TRecord>;
    },
    async listTables() {
      return [];
    },
    async runInTransaction<TValue>(callback: (tx: IModuleDataRuntime) => Promise<TValue>): Promise<TValue> {
      const outer = depth === 0;
      if (outer) snapshot = copyTables(tables);
      depth += 1;
      try {
        const value = await callback(runtime);
        depth -= 1;
        if (outer) snapshot = undefined;
        return value;
      } catch (error) {
        depth -= 1;
        if (outer && snapshot) {
          tables.clear();
          for (const [name, rows] of snapshot) tables.set(name, rows);
          snapshot = undefined;
        }
        throw error;
      }
    },
  };
  return { runtime, tables };
}

function publishContext(runtime: IModuleDataRuntime): RequestContext {
  const ctx = realContext();
  ctx.data = { ...ctx.data, moduleData: runtime };
  return ctx;
}

// The index is injected into the publisher, not carried by the context.
const publishWithExampleIndex = createPublishModuleEvent(async (): Promise<ModuleEventsIndex> => exampleEventIndex());

describe('publishModuleEvent on the use-case transaction', () => {
  it('leaves no event and no delivery when the use-case transaction fails', async () => {
    const { runtime, tables } = createRollingRuntime(false);
    await assert.rejects(
      () => runtime.runInTransaction(async () => {
        const result = await publishWithExampleIndex(REF, { n: 1 }, publishContext(runtime));
        assert.equal(result.ok, true);
        throw new Error('use case failed');
      }),
      /use case failed/,
    );
    assert.equal(tables.get(MODULE_EVENT_TABLE)?.length ?? 0, 0);
    assert.equal(tables.get(MODULE_EVENT_DELIVERY_TABLE)?.length ?? 0, 0);
  });

  it('keeps the event and the delivery when the use-case transaction commits', async () => {
    const { runtime, tables } = createRollingRuntime(false);
    await runtime.runInTransaction(async () => {
      const result = await publishWithExampleIndex(REF, { n: 1 }, publishContext(runtime));
      assert.equal(result.ok, true);
    });
    assert.equal(tables.get(MODULE_EVENT_TABLE)?.length, 1);
    assert.equal(tables.get(MODULE_EVENT_DELIVERY_TABLE)?.length, 1);
    assert.equal(tables.get(MODULE_EVENT_DELIVERY_TABLE)?.[0]?.consumerModule, 'readerModule');
  });

  it('rolls back both inserts when it opens its own transaction and the second insert fails', async () => {
    const { runtime, tables } = createRollingRuntime(true);
    const result = await publishWithExampleIndex(REF, { n: 1 }, publishContext(runtime));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'unavailable');
    assert.equal(tables.get(MODULE_EVENT_TABLE)?.length ?? 0, 0);
    assert.equal(tables.get(MODULE_EVENT_DELIVERY_TABLE)?.length ?? 0, 0);
  });

  it('has the same signature on the fake', () => {
    const same: PublishModuleEvent = fakePublishModuleEvent;
    assert.equal(typeof same, 'function');
    const real: PublishModuleEvent = publishModuleEvent;
    assert.equal(typeof real, 'function');
  });
});
