/// <mls fileReference="_102034_/l1/server/layer_1_external/events/publishModuleEvent.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DefsReader } from '/_102034_/l1/workflow/assistantCatalogDefs.js';
import { buildConsumesIndex, findConsumesRoute } from '/_102034_/l1/workflow/connectionServe.js';
import { createModuleEventPublisher } from '/_102034_/l1/server/layer_1_external/events/publishModuleEvent.js';
import type { ModuleEventEnvelope, ModuleEventsIndex } from '/_102034_/l1/server/layer_1_external/events/types.js';
import { createFakeConsumesRoute, exampleEventIndex } from '/_102034_/testing/events/eventFixtures.js';

const REF = { module: 'sourceModule', eventId: 'happened' };
const CONTEXT = {
  moduleId: 'sourceModule',
  project: { projectId: '900281' },
  sessionContext: { actorId: 'person-1' },
  requestMeta: { actorType: 'user' as const, requestId: 'req-1' },
};

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
