/// <mls fileReference="_102034_/l1/workflow/messagesTask.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type {
  AIModuleStep,
  ModulePlanStep,
  TaskData,
  TaskModuleHistoryEntry,
} from '/_102036_/l2/shared/interfaces.js';
import type { OccurrenceKey, TaskOccurrenceOpenCommand } from '/_102034_/l1/workflow/contracts.js';
import { prepareWorkflowPlan, type WorkflowPlan } from '/_102034_/l1/workflow/plan.js';
import {
  decodeTaskSnapshot,
  encodeOpenModuleTask,
  type MessagesWorkflowIdentities,
} from '/_102034_/l1/workflow/messagesTask.js';

const PAIRS: Record<string, string> = {
  'mdm-owner': 'cm-owner',
  'mdm-by': 'cm-by',
  'mdm-actor': 'cm-actor',
  'mdm-member': 'cm-member',
  'mdm-old': 'cm-old',
};
const CM_OF = Object.fromEntries(Object.entries(PAIRS).map(([mdm, cm]) => [cm, mdm]));

function identities(seen: string[]): MessagesWorkflowIdentities {
  return {
    async toCmUserId(_ctx, mdmId) {
      seen.push(`cm:${mdmId}`);
      const cm = PAIRS[mdmId];
      if (cm === undefined) throw new AppError('IDENTITY_NOT_FOUND', `missing ${mdmId}`, 404);
      return cm;
    },
    async toMdmId(_ctx, userId) {
      seen.push(`mdm:${userId}`);
      const mdm = CM_OF[userId];
      if (mdm === undefined) throw new AppError('IDENTITY_NOT_FOUND', `missing ${userId}`, 404);
      return mdm;
    },
  };
}

function ctx(): RequestContext {
  const context = createRequestContext();
  context.requestMeta = { userId: 'telemetry-only', source: 'test' };
  return context;
}

const KEY: OccurrenceKey = {
  project: '10',
  module: 'tarefas',
  processId: 'ciclo',
  entity: 'ordem',
  recordId: 'rec-1',
};

function plan(): WorkflowPlan {
  return prepareWorkflowPlan({
    processId: 'ciclo',
    title: 'Process title',
    moduleTitle: 'Module title',
    steps: [
      {
        stepId: 'S',
        kind: 'human',
        title: 'Start title',
        actorRef: 'role-start',
        journeyRef: 'journey-start',
        next: ['A'],
        conditions: 'ready',
        params: { lane: 'left' },
      },
      {
        stepId: 'A',
        kind: 'mechanical',
        title: 'Act title',
        functionRef: 'fn-act',
        next: ['S'],
      },
    ],
  });
}

function child(step: ModulePlanStep, status: AIModuleStep['status'], passes: number, actorNow?: string | null): AIModuleStep {
  return {
    type: 'module',
    stepId: 2,
    status,
    stepTitle: step.title,
    interaction: null,
    nextSteps: [],
    module: {
      key: step.key,
      kind: step.kind,
      ownerKind: step.ownerKind,
      next: [...step.next],
      passes,
      ...(step.actorRef === undefined ? {} : { actorRef: step.actorRef }),
      ...(step.journeyRef === undefined ? {} : { journeyRef: step.journeyRef }),
      ...(step.functionRef === undefined ? {} : { functionRef: step.functionRef }),
      ...(step.conditions === undefined ? {} : { conditions: step.conditions }),
      ...(step.params === undefined ? {} : { params: { ...step.params } }),
      ...(actorNow === undefined ? {} : { actorNow }),
    },
  };
}

function historyEntry(over: Partial<TaskModuleHistoryEntry> & Pick<TaskModuleHistoryEntry, 'commandId' | 'step' | 'done'>): TaskModuleHistoryEntry {
  return {
    at: '2026-10-19T12:00:00.000Z',
    executor: { kind: 'routine', name: 'ciclo.S' },
    from: null,
    actorNow: null,
    ...over,
  };
}

function taskOf(options: {
  status?: TaskData['status'];
  version?: string | null;
  current?: 'S' | 'A';
  passes?: number;
  wake?: boolean;
  actorNow?: string | null;
  omitActor?: boolean;
  done?: boolean;
  pk?: string;
}): TaskData {
  const prepared = plan();
  const wire: ModulePlanStep[] = prepared.steps.map((step) => ({
    key: step.stepId,
    kind: step.kind,
    ownerKind: step.ownerKind,
    title: step.title,
    next: [...step.next],
    ...(step.actorRef === undefined ? {} : { actorRef: step.actorRef }),
    ...(step.journeyRef === undefined ? {} : { journeyRef: step.journeyRef }),
    ...(step.functionRef === undefined ? {} : { functionRef: step.functionRef }),
    ...(step.conditions === undefined ? {} : { conditions: step.conditions }),
    ...(step.params === undefined ? {} : { params: { ...step.params } }),
  }));
  const current = options.current ?? 'S';
  const done = options.done === true;
  const children = wire.map((step) => {
    const active = step.key === current;
    const status = done ? 'completed' : active ? 'in_progress' : 'pending';
    const passes = active ? (options.passes ?? 1) : 0;
    const actor = options.omitActor ? undefined : options.actorNow === undefined && active ? 'cm-actor' : options.actorNow;
    const node = child(step, status as AIModuleStep['status'], done && active ? (options.passes ?? 1) : active ? passes : done ? 1 : 0, actor);
    if (active && options.wake) {
      node.module.wake = { everyMinutes: 15, routine: 'ciclo.S', nextAt: '2026-10-19T12:15:00.000Z', seq: node.module.passes };
    }
    return node;
  });
  const history: TaskModuleHistoryEntry[] = [
    historyEntry({
      commandId: 'c-old',
      step: 'S',
      done: false,
      at: '2026-10-19T11:00:00.000Z',
      executor: { kind: 'person', userId: 'cm-old' },
      actorNow: 'cm-old',
      from: null,
      note: 'opened',
      message: {
        state: 'pending',
        threadId: 'room-1',
        content: 'secret body',
        author: 'person',
        userId: 'cm-old',
      },
    }),
    historyEntry({
      commandId: 'c-now',
      step: current,
      done,
      at: '2026-10-19T12:00:00.000Z',
      from: 'S',
      executor: { kind: 'person', userId: 'cm-actor' },
      actorNow: options.omitActor ? null : 'cm-actor',
      message: { state: 'sent', threadId: 'room-1', orderAt: '2026-10-19T12:00:01.000Z', content: 'later', author: 'virtual' },
    }),
  ];
  return {
    PK: options.pk ?? 'task/#opaque-keep',
    SK: 'metadata',
    title: 'Occurrence title',
    owner: 'cm-owner',
    team: null,
    status: options.status ?? (done ? 'done' : 'in progress'),
    last_updated: 1,
    last_update_log: null,
    taskRoom: { enabled: true, threadId: 'room-1' },
    module: {
      ref: { ...KEY, workflowVersion: options.version === undefined ? null : options.version },
      origin: { kind: 'schedule', by: 'cm-by', config: 'daily' },
      owner: 'cm-owner',
      revision: 3,
      room: { mode: 'group', groupKey: 'desk', members: ['cm-member'] },
      moduleTitle: 'Module title',
      history,
    },
    iaCompressed: {
      nextSteps: [{
        type: 'module',
        stepId: 1,
        status: done ? 'completed' : 'in_progress',
        stepTitle: 'Process title',
        interaction: null,
        nextSteps: children,
        module: { key: 'ciclo', kind: 'mechanical', ownerKind: 'module', next: ['S', 'A'], passes: 0 },
      }],
      longMemory: {},
      queueBackEnd: [],
      queueFrontEnd: [],
    },
  };
}

test('encode translates people and keeps plan refs, titles, and routine name', async () => {
  const seen: string[] = [];
  const prepared = plan();
  const frozen = JSON.stringify(prepared);
  const command: TaskOccurrenceOpenCommand = {
    ref: { ...KEY, workflowVersion: 'v3' },
    plan: prepared,
    title: 'Occurrence title',
    firstStep: 'S',
    actorNow: 'mdm-actor',
    owner: 'mdm-owner',
    origin: { kind: 'event', by: 'mdm-by', config: 'hook' },
    executor: { kind: 'routine', name: 'ciclo.S' },
    room: { mode: 'group', groupKey: 'desk', members: ['mdm-member'] },
    message: { content: 'hello' },
  };
  const wire = await encodeOpenModuleTask(ctx(), identities(seen), command);
  assert.equal(JSON.stringify(prepared), frozen);
  assert.equal(wire.action, 'openModuleTask');
  assert.equal(wire.startStep, 'S');
  assert.equal(wire.plan.title, 'Process title');
  assert.equal(wire.plan.moduleTitle, 'Module title');
  assert.equal(wire.plan.steps[0].key, 'S');
  assert.equal(wire.plan.steps[0].title, 'Start title');
  assert.equal(wire.plan.steps[0].actorRef, 'role-start');
  assert.deepEqual(wire.plan.steps[0].params, { lane: 'left' });
  assert.deepEqual(wire.plan.steps[0].next, ['A']);
  assert.equal(wire.plan.steps[1].functionRef, 'fn-act');
  assert.equal(wire.owner, 'cm-owner');
  assert.equal(wire.actorNow, 'cm-actor');
  assert.equal(wire.origin.by, 'cm-by');
  assert.deepEqual(wire.executor, { kind: 'routine', name: 'ciclo.S' });
  assert.deepEqual(wire.room.members, ['cm-member']);
  assert.deepEqual(wire.message, { content: 'hello' });
  assert.equal(seen.some((call) => call.includes('role-start') || call.includes('fn-act') || call.includes('ciclo.S')), false);
});

test('decode keeps distinct titles, translated ids, and an independent snapshot', async () => {
  const source = taskOf({ version: 'v3', current: 'A', passes: 3, wake: true, actorNow: 'cm-actor' });
  const copy = structuredClone(source);
  const seen: string[] = [];
  const view = await decodeTaskSnapshot(ctx(), identities(seen), copy, KEY, 'room-1');
  copy.module!.history[0].note = 'changed';
  copy.iaCompressed!.nextSteps[0].stepTitle = 'changed';
  assert.equal(view.taskId, 'task/#opaque-keep');
  assert.equal(view.ref.workflowVersion, 'v3');
  assert.equal(view.title, 'Occurrence title');
  assert.equal(view.plan.title, 'Process title');
  assert.equal(view.plan.moduleTitle, 'Module title');
  assert.equal(view.plan.steps[0].stepId, 'S');
  assert.equal(view.plan.steps[0].title, 'Start title');
  assert.equal(view.plan.steps[0].actorRef, 'role-start');
  assert.equal(view.plan.steps[0].ownerKind, 'person');
  assert.equal(view.plan.steps[1].ownerKind, 'module');
  assert.equal(view.step, 'A');
  assert.equal(view.done, false);
  assert.equal(view.actorNow, 'mdm-actor');
  assert.equal(view.pass, 3);
  assert.equal(view.wake?.seq, 3);
  assert.equal(view.owner, 'mdm-owner');
  assert.equal(view.origin.by, 'mdm-by');
  assert.deepEqual(view.room.members, ['mdm-member']);
  assert.equal(view.history[0].commandId, 'c-old');
  assert.equal(view.history[0].by, 'mdm-old');
  assert.equal(view.history[0].executor.kind === 'person' && view.history[0].executor.mdmId, 'mdm-old');
  assert.equal(view.history[0].note, 'opened');
  assert.deepEqual(view.history[0].message, { state: 'pending', threadId: 'room-1' });
  assert.deepEqual(view.history[1].message, { state: 'sent', threadId: 'room-1', orderAt: '2026-10-19T12:00:01.000Z' });
  assert.equal(view.history[1].executor.kind === 'routine', false);
  const again = await decodeTaskSnapshot(ctx(), identities([]), structuredClone(source), KEY, 'room-1');
  assert.deepEqual(again, view);
  view.plan.steps[0].title = 'local';
  assert.equal(source.iaCompressed?.nextSteps[0].stepTitle, 'Process title');
});

test('first native step without actorNow is null and a closed task ends without wake', async () => {
  const open = taskOf({ omitActor: true, current: 'S' });
  open.module!.history = [historyEntry({ commandId: 'c-open', step: 'S', done: false, executor: { kind: 'routine', name: 'ciclo.S' } })];
  const opened = await decodeTaskSnapshot(ctx(), identities([]), open, KEY, 'room-1');
  assert.equal(opened.actorNow, null);
  assert.equal(opened.history[0].by, null);
  assert.notEqual(opened.actorNow, opened.owner);

  const closed = taskOf({ done: true, current: 'A', passes: 2, actorNow: 'cm-actor' });
  const ended = await decodeTaskSnapshot(ctx(), identities([]), closed, KEY);
  assert.equal(ended.step, 'end');
  assert.equal(ended.done, true);
  assert.equal(ended.status, 'done');
  assert.equal(ended.actorNow, 'mdm-actor');
  assert.equal(ended.pass, 2);
  assert.equal(ended.wake, undefined);
  assert.equal(ended.plan.steps.some((step) => step.stepId === 'end'), false);
});

test('paused and failed stay unfinished', async () => {
  for (const status of ['paused', 'failed'] as const) {
    const view = await decodeTaskSnapshot(ctx(), identities([]), taskOf({ status, current: 'S' }), KEY, 'room-1');
    assert.equal(view.status, status);
    assert.equal(view.done, false);
    assert.equal(view.step, 'S');
  }
});

test('invalid task shapes and a missing identity do not fall back', async () => {
  const cases: Array<(task: TaskData) => void> = [
    (task) => { task.iaCompressed!.nextSteps = []; },
    (task) => { task.iaCompressed!.nextSteps.push(structuredClone(task.iaCompressed!.nextSteps[0])); },
    (task) => {
      const root = task.iaCompressed!.nextSteps[0];
      if (root.type === 'module') root.nextSteps = [{ ...root, type: 'agent', agentName: 'x', rags: null }];
    },
    (task) => { task.module!.ref.project = 'other'; },
    (task) => { task.taskRoom!.threadId = 'other-room'; },
    (task) => { task.module!.revision = 0; },
    (task) => { task.title = ' '; },
    (task) => {
      const root = task.iaCompressed!.nextSteps[0];
      if (root.type === 'module' && root.nextSteps?.[0].type === 'module') delete root.nextSteps[0].stepTitle;
    },
    (task) => {
      const root = task.iaCompressed!.nextSteps[0];
      if (root.type === 'module' && root.nextSteps?.[1].type === 'module') root.nextSteps[1].module.ownerKind = 'person';
    },
    (task) => {
      const root = task.iaCompressed!.nextSteps[0];
      if (root.type === 'module' && root.nextSteps?.[1].type === 'module') delete root.nextSteps[1].module.actorNow;
    },
  ];
  for (const mutate of cases) {
    const task = taskOf({ current: 'A', actorNow: 'cm-actor' });
    mutate(task);
    await assert.rejects(
      () => decodeTaskSnapshot(ctx(), identities([]), task, KEY, 'room-1'),
      (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_CM_PROTOCOL_ERROR' && error.statusCode === 502
        && error.message === 'Module task payload is not valid.',
    );
  }
  const missing = taskOf({});
  missing.module!.owner = 'cm-unknown';
  await assert.rejects(
    () => decodeTaskSnapshot(ctx(), identities([]), missing, KEY, 'room-1'),
    (error: unknown) => error instanceof AppError && error.code === 'IDENTITY_NOT_FOUND' && error.statusCode === 404
      && error.message === 'Identity could not be resolved.',
  );
});
