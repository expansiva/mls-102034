/// <mls fileReference="_102034_/l1/workflow/messagesRoutineOwner.cm.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createServerMessagesClient } from '/_102034_/l1/server/layer_1_external/collabMessages/client.js';
import {
  createMessagesTaskOccurrencePort,
  createWorkflowEngine,
  type MessagesWorkflowIdentities,
  type TaskWorkflowOpen,
} from '/_102034_/l1/workflow/index.js';

/**
 * Round trip of a routine occurrence with no person (`owner: null`) through the real cm. Off by default: it writes a task.
 *   RUN_CM_PROBE=true CM_PROBE_PROJECT=<project id of the app> CM_PROBE_MODULE=<module> CM_PROBE_AS_USER=<cm user id>
 * with the MSG_PROXY_* of the app in the environment, run from the app that talks to the cm under test.
 * No person is translated anywhere in it: the resolver below fails the test if it is ever called.
 */
const ON = process.env.RUN_CM_PROBE === 'true';
const PROJECT = process.env.CM_PROBE_PROJECT ?? '';
const MODULE = process.env.CM_PROBE_MODULE ?? '';
const AS_USER = process.env.CM_PROBE_AS_USER ?? '';

const noPerson: MessagesWorkflowIdentities = {
  async toCmUserId() { throw new Error('a person was translated'); },
  async toMdmId() { throw new Error('a person was translated'); },
  async toCmUserIds() { throw new Error('a person was translated'); },
  async toMdmIds() { throw new Error('a person was translated'); },
};

test('rt244: a routine with no person opens, is found, advances and is reopened as existing through the real cm', { skip: !ON }, async () => {
  assert.ok(PROJECT && MODULE && AS_USER, 'CM_PROBE_PROJECT, CM_PROBE_MODULE and CM_PROBE_AS_USER are required');
  let calls = 0;
  const real = createServerMessagesClient({ projectId: PROJECT });
  const client = new Proxy(real, {
    get(target, name, receiver) {
      const value = Reflect.get(target, name, receiver);
      return typeof value === 'function' ? (...args: unknown[]) => { calls += 1; return (value as (...a: unknown[]) => unknown).apply(target, args); } : value;
    },
  });
  const engine = createWorkflowEngine(createMessagesTaskOccurrencePort({ projectId: PROJECT, moduleId: MODULE, asUserId: AS_USER, identities: noPerson, client }));
  const ctx = createRequestContext();
  ctx.requestMeta = { requestId: 'rt244-probe', userId: 'rt244-probe', source: 'test' };

  const recordId = `rt244-${Date.now()}`;
  const key = { project: PROJECT, module: MODULE, processId: 'rt244Rotina', entity: 'Rt244', recordId };
  const open: TaskWorkflowOpen = {
    key,
    plan: {
      processId: 'rt244Rotina',
      title: 'rt244 routine without a person',
      moduleTitle: 'rt244 probe',
      steps: [
        { stepId: 'S', kind: 'mechanical', title: 'Start', next: ['A'], functionRef: 'rt244.start' },
        { stepId: 'A', kind: 'mechanical', title: 'Act', next: [], functionRef: 'rt244.act' },
      ],
    },
    title: 'rt244 probe occurrence',
    firstStep: 'S',
    actorNow: null,
    owner: null,
    origin: { kind: 'event', config: 'platform.releaseCatalogChanged' },
    executor: { kind: 'routine', name: 'rt244Rotina.S' },
    room: { mode: 'exclusive' },
  };

  const created = await engine.open(ctx, open);
  console.log('RT244 open', JSON.stringify({ outcome: created.outcome, taskId: created.occurrence.taskId, owner: created.occurrence.owner, revision: created.occurrence.revision }));
  assert.equal(created.outcome, 'created');
  assert.equal(created.occurrence.owner, null);

  const found = await engine.find(ctx, key);
  console.log('RT244 find', JSON.stringify({ taskId: found?.taskId, owner: found?.owner, step: found?.step, actorNow: found?.actorNow }));
  assert.equal(found?.owner, null);
  assert.equal(found?.taskId, created.occurrence.taskId);

  const advanced = await engine.advance(ctx, key, {
    commandId: `rt244-adv-${recordId}`,
    expectedRevision: found!.revision,
    from: 'S',
    to: 'A',
    actorNow: null,
    executor: { kind: 'routine', name: 'rt244Rotina.S' },
  });
  console.log('RT244 advance', JSON.stringify({ outcome: advanced.outcome, step: advanced.occurrence.step, revision: advanced.occurrence.revision, owner: advanced.occurrence.owner }));
  assert.equal(advanced.outcome, 'advanced');
  assert.equal(advanced.occurrence.step, 'A');
  assert.equal(advanced.occurrence.owner, null);

  const again = await engine.open(ctx, open);
  console.log('RT244 reopen', JSON.stringify({ outcome: again.outcome, taskId: again.occurrence.taskId }));
  assert.equal(again.outcome, 'existing');
  assert.equal(again.occurrence.taskId, created.occurrence.taskId);

  const before = calls;
  await assert.rejects(
    () => engine.open(ctx, { ...open, key: { ...key, recordId: `${recordId}-person` }, room: { mode: 'person' } }),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_ROUTINE_OWNER_INVALID',
  );
  assert.equal(calls, before, 'the cm received nothing for the personal room');
  console.log('RT244 personal room refused by the engine, cm calls unchanged:', calls === before);
});
