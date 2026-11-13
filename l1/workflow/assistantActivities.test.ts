/// <mls fileReference="_102034_/l1/workflow/assistantActivities.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type {
  WorkflowActivityListItem,
  WorkflowActivityListQuery,
  WorkflowActivityStore,
} from '/_102034_/l1/workflow/activitiesStore.js';
import {
  decodeAssistantCursor,
  encodeAssistantCursor,
  listAssistantActivities,
  type AssistantActivitiesDeps,
  type AssistantOnBehalfOf,
} from '/_102034_/l1/workflow/assistantActivities.js';

const ctx = { sessionContext: { project: { projectId: '102047' } } } as unknown as RequestContext;

function item(moduleId: string, taskId: string, syncedAt: string): WorkflowActivityListItem {
  return {
    projectId: '102047', moduleId, taskId, syncedAt, revision: 1, status: 'open',
    taskTitle: taskId, processTitle: 'p', moduleTitle: moduleId,
    ref: { project: '102047', module: moduleId, processId: 'p', entity: 'e', recordId: taskId },
    activity: { kind: 'step', stepKey: 's', actorRef: 'actor' },
  } as unknown as WorkflowActivityListItem;
}

/** A store that answers from a fixed list in pages of `size`, and records every query it received. */
function fakeStore(moduleId: string, items: WorkflowActivityListItem[], size = 2): WorkflowActivityStore & { queries: WorkflowActivityListQuery[] } {
  const queries: WorkflowActivityListQuery[] = [];
  return {
    projectId: '102047',
    moduleId,
    queries,
    async refresh() { throw new Error('not used'); },
    async list(_ctx, query) {
      queries.push(query);
      const from = query.cursor === undefined ? 0 : Number(query.cursor);
      const page = items.slice(from, from + size);
      const more = from + size < items.length;
      return { items: page, ...(more ? { cursor: String(from + size) } : {}) };
    },
  };
}

const onBehalfOf = (authorities: string[], cmUserId = 'cm-1'): AssistantOnBehalfOf => ({
  cmUserId, authorities, snapshotAt: '2026-11-13T10:00:00.000Z', via: 'nora',
});

function deps(stores: Record<string, WorkflowActivityStore>, extra: Partial<AssistantActivitiesDeps> = {}): AssistantActivitiesDeps & { alphaCalls: string[] } {
  const alphaCalls: string[] = [];
  return {
    alphaCalls,
    projectId: '102047',
    modules: Object.keys(stores).map((moduleId) => ({ moduleId, backendControllers: `dist/${moduleId}/controllers` })),
    identities: { toMdmId: async (_ctx, cmUserId) => (cmUserId === 'cm-1' ? 'person-1' : (() => { throw new AppError('WORKFLOW_IDENTITY_UNLINKED', 'unlinked', 409); })()) },
    storeFor: (moduleId) => stores[moduleId],
    withAlpha: async (meta, moduleId) => { alphaCalls.push(moduleId); return meta; },
    ...extra,
  };
}

test('two modules are joined newest first, with the actor ids of each module only', async () => {
  const a = fakeStore('modA', [item('modA', 'a1', '2026-11-13T09:00:00Z'), item('modA', 'a2', '2026-11-13T07:00:00Z')]);
  const b = fakeStore('modB', [item('modB', 'b1', '2026-11-13T08:00:00Z')]);
  const result = await listAssistantActivities(ctx, deps({ modA: a, modB: b }), {
    onBehalfOf: onBehalfOf(['modA:actor', 'modA:other', 'modB:third', 'modC:fourth']),
  });
  assert.equal(result.outcome, 'done');
  assert.deepEqual(result.items.map((entry) => entry.taskId), ['a1', 'b1', 'a2']);
  assert.equal(result.cursor, undefined);
  assert.deepEqual(result.partial, []);
  assert.deepEqual(a.queries[0].subject, { personMdmId: 'person-1', actorRefs: ['actor', 'other'] });
  assert.deepEqual(b.queries[0].subject, { personMdmId: 'person-1', actorRefs: ['third'] });
});

test('the composite cursor holds one cursor per module with more, and the next page asks only those', async () => {
  const a = fakeStore('modA', ['a1', 'a2', 'a3', 'a4', 'a5'].map((id, i) => item('modA', id, `2026-11-13T0${9 - i}:00:00Z`)), 2);
  const b = fakeStore('modB', [item('modB', 'b1', '2026-11-13T08:30:00Z')], 2);
  const d = deps({ modA: a, modB: b });
  const first = await listAssistantActivities(ctx, d, { onBehalfOf: onBehalfOf(['modA:x', 'modB:y']) });
  assert.deepEqual(first.items.map((entry) => entry.taskId), ['a1', 'b1', 'a2']);
  assert.ok(first.cursor);
  assert.deepEqual(decodeAssistantCursor(first.cursor!), { modA: '2' });
  const second = await listAssistantActivities(ctx, d, { onBehalfOf: onBehalfOf(['modA:x', 'modB:y']), cursor: first.cursor });
  assert.deepEqual(second.items.map((entry) => entry.taskId), ['a3', 'a4']);
  assert.equal(b.queries.length, 1);
  const third = await listAssistantActivities(ctx, d, { onBehalfOf: onBehalfOf(['modA:x', 'modB:y']), cursor: second.cursor });
  assert.deepEqual(third.items.map((entry) => entry.taskId), ['a5']);
  assert.equal(third.cursor, undefined);
});

test('a module that fails goes to partial with its code and the others answer', async () => {
  const good = fakeStore('modA', [item('modA', 'a1', '2026-11-13T09:00:00Z')]);
  const bad: WorkflowActivityStore = { ...fakeStore('modB', []), list: async () => { throw new AppError('WORKFLOW_PROJECTION_RUNTIME_INVALID', 'boom', 400); } };
  const odd: WorkflowActivityStore = { ...fakeStore('modC', []), list: async () => { throw new Error('secret detail'); } };
  const result = await listAssistantActivities(ctx, deps({ modA: good, modB: bad, modC: odd }), { onBehalfOf: onBehalfOf(['modA:x']) });
  assert.equal(result.outcome, 'done');
  assert.deepEqual(result.items.map((entry) => entry.taskId), ['a1']);
  assert.deepEqual(result.partial, [
    { moduleId: 'modB', code: 'WORKFLOW_PROJECTION_RUNTIME_INVALID' },
    { moduleId: 'modC', code: 'ASSISTANT_MODULE_FAILED' },
  ]);
  assert.equal(JSON.stringify(result).includes('secret detail'), false);
});

test('a cm user without a linked person is no_person; another identity failure is not hidden', async () => {
  const a = fakeStore('modA', [item('modA', 'a1', '2026-11-13T09:00:00Z')]);
  const none = await listAssistantActivities(ctx, deps({ modA: a }), { onBehalfOf: onBehalfOf(['modA:x'], 'cm-unknown') });
  assert.deepEqual(none, { outcome: 'no_person', items: [], partial: [] });
  assert.equal(a.queries.length, 0);
  const broken = deps({ modA: a }, { identities: { toMdmId: async () => { throw new AppError('WORKFLOW_IDENTITY_INCOMPLETE', 'x', 503); } } });
  await assert.rejects(() => listAssistantActivities(ctx, broken, { onBehalfOf: onBehalfOf(['modA:x']) }), (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_IDENTITY_INCOMPLETE');
});

test('with the alpha on, the actors of the module are added; off, only the snapshot counts', async () => {
  const a = fakeStore('modA', []);
  const alphaOn = deps({ modA: a }, {
    withAlpha: async (meta, moduleId) => ({ ...meta, verifiedAuthorities: [...(meta?.verifiedAuthorities ?? []), `${moduleId}:alphaActor`] }),
  });
  await listAssistantActivities(ctx, alphaOn, { onBehalfOf: onBehalfOf(['modA:own']) });
  assert.deepEqual(a.queries[0].subject?.actorRefs, ['own', 'alphaActor']);
  const b = fakeStore('modA', []);
  const alphaOff = deps({ modA: b });
  await listAssistantActivities(ctx, alphaOff, { onBehalfOf: onBehalfOf(['modA:own']) });
  assert.deepEqual(b.queries[0].subject?.actorRefs, ['own']);
  assert.deepEqual(alphaOff.alphaCalls, ['modA']);
});

test('the authority of another module does not enter, and includeNonActionable is passed on', async () => {
  const a = fakeStore('modA', []);
  await listAssistantActivities(ctx, deps({ modA: a }), { onBehalfOf: onBehalfOf(['modB:actor', 'modA:']), includeNonActionable: true });
  assert.deepEqual(a.queries[0].subject?.actorRefs, []);
  assert.equal(a.queries[0].includeNonActionable, true);
});

test('a cursor this module did not make is refused with 400', async () => {
  const d = deps({ modA: fakeStore('modA', []) });
  for (const cursor of ['not-base64-json', encodeAssistantCursor({ modZ: '1' })!, Buffer.from('[]').toString('base64url'), Buffer.from('{}').toString('base64url'), Buffer.from('{"modA":7}').toString('base64url')]) {
    await assert.rejects(
      () => listAssistantActivities(ctx, d, { onBehalfOf: onBehalfOf(['modA:x']), cursor }),
      (error: unknown) => error instanceof AppError && error.code === 'ASSISTANT_CURSOR_INVALID' && error.statusCode === 400,
    );
  }
  assert.equal(encodeAssistantCursor({}), undefined);
});

