/// <mls fileReference="_102034_/l1/workflow/taskContracts.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import {
  prepareWorkflowPlan,
  type OccurrenceKey,
  type TaskOccurrenceAdvanceCommand,
  type TaskOccurrenceAdvanceResult,
  type TaskOccurrenceHistoryEntry,
  type TaskOccurrenceMessageStatus,
  type TaskOccurrenceOpenCommand,
  type TaskOccurrenceOpenResult,
  type TaskOccurrencePort,
  type TaskOccurrenceSnapshot,
  type WorkflowExecutor,
  type WorkflowPlan,
  type WorkflowPlanInput,
  type WorkflowWake,
  type WorkflowWakeRequest,
} from '/_102034_/l1/workflow/index.js';

const OCCURRENCE_TITLE = 'Occurrence title';
const PROCESS_TITLE = 'Process title';
const MODULE_TITLE = 'Module title';

const planInput: WorkflowPlanInput = {
  processId: 'ciclo',
  title: PROCESS_TITLE,
  moduleTitle: MODULE_TITLE,
  steps: [
    {
      stepId: 'S',
      kind: 'human',
      title: 'Start',
      next: ['A'],
    },
    {
      stepId: 'A',
      kind: 'mechanical',
      title: 'Act',
      next: [],
    },
  ],
};

function copyPlan(plan: WorkflowPlan): WorkflowPlan {
  return {
    processId: plan.processId,
    title: plan.title,
    moduleTitle: plan.moduleTitle,
    steps: plan.steps.map((step) => ({
      ...step,
      next: [...step.next],
      ...(step.params === undefined ? {} : { params: { ...step.params } }),
    })),
  };
}

function snapshot(plan: WorkflowPlan, message?: TaskOccurrenceMessageStatus): TaskOccurrenceSnapshot {
  const routine: TaskOccurrenceHistoryEntry = {
    at: '2026-10-19T12:00:00.000Z',
    by: null,
    from: null,
    step: 'S',
    actorNow: null,
    done: false,
    commandId: 'open-1',
    executor: { kind: 'routine', name: 'ciclo.S' },
    ...(message === undefined ? {} : { message }),
  };
  const wake: WorkflowWake = {
    everyMinutes: 15,
    routine: 'ciclo.S',
    nextAt: '2026-10-19T12:15:00.000Z',
    seq: 1,
  };
  return {
    ref: {
      project: '10',
      module: 'tarefas',
      processId: 'ciclo',
      entity: 'ordem',
      recordId: 'rec-1',
      workflowVersion: null,
    },
    step: 'S',
    actorNow: 'mdm-actor',
    done: false,
    history: [routine],
    plan,
    title: OCCURRENCE_TITLE,
    taskId: 'task-1',
    revision: 3,
    status: 'in progress',
    owner: 'mdm-owner',
    origin: { kind: 'schedule', config: 'daily' },
    room: { mode: 'person' },
    roomId: 'room-1',
    pass: 1,
    wake,
  };
}

test('task contract keeps three titles, an independent plan copy, and routine by=null', () => {
  const input: WorkflowPlanInput = {
    ...planInput,
    steps: planInput.steps.map((step) => ({ ...step, next: [...step.next] })),
  };
  const prepared = prepareWorkflowPlan(input);
  input.title = 'mutated process';
  input.moduleTitle = 'mutated module';
  input.steps[0].title = 'mutated step';
  assert.equal(prepared.title, PROCESS_TITLE);
  assert.equal(prepared.moduleTitle, MODULE_TITLE);
  assert.equal(prepared.steps[0].title, 'Start');

  const held = copyPlan(prepared);
  prepared.steps[0].title = 'mutated prepared';
  prepared.title = 'mutated prepared process';
  const view = snapshot(held);
  assert.equal(view.plan.title, PROCESS_TITLE);
  assert.equal(view.plan.moduleTitle, MODULE_TITLE);
  assert.equal(view.plan.steps[0].title, 'Start');
  assert.equal(view.title, OCCURRENCE_TITLE);
  assert.notEqual(view.title, view.plan.title);
  assert.notEqual(view.title, view.plan.moduleTitle);
  assert.equal(view.history[0].by, null);
  assert.equal(view.history[0].executor.kind, 'routine');
});

test('message state stays pending or absent for every outcome', async () => {
  const prepared = prepareWorkflowPlan(planInput);
  const pending: TaskOccurrenceMessageStatus = { state: 'pending', threadId: 'thread-1' };
  const pendingOrdered: TaskOccurrenceMessageStatus = {
    state: 'pending',
    threadId: 'thread-1',
    orderAt: '2026-10-19T12:00:01.000Z',
  };
  const sent: TaskOccurrenceMessageStatus = { state: 'sent', threadId: 'thread-1' };
  const sentOrdered: TaskOccurrenceMessageStatus = {
    state: 'sent',
    threadId: 'thread-1',
    orderAt: '2026-10-19T12:00:02.000Z',
  };
  const states: Array<TaskOccurrenceMessageStatus | undefined> = [
    undefined,
    pending,
    pendingOrdered,
    sent,
    sentOrdered,
  ];
  const openOutcomes = ['created', 'existing'] as const;
  const advanceOutcomes = ['advanced', 'unchanged', 'conflict', 'paused'] as const;
  const ctx = createRequestContext();
  ctx.requestMeta = { userId: 'telemetry-only', source: 'test' };
  const wakeRequest: WorkflowWakeRequest = { everyMinutes: 15, routine: 'ciclo.A' };
  const person: WorkflowExecutor = { kind: 'person', mdmId: 'mdm-actor' };
  assert.notEqual(person.mdmId, ctx.requestMeta.userId);

  const port: TaskOccurrencePort = {
    kind: 'task',
    async open(_ctx, command): Promise<TaskOccurrenceOpenResult> {
      const moduleMessage = command.message === undefined ? undefined : pending;
      return { outcome: 'created', occurrence: snapshot(copyPlan(command.plan), moduleMessage), moduleMessage };
    },
    async find(): Promise<TaskOccurrenceSnapshot | null> {
      return snapshot(copyPlan(prepared));
    },
    async advance(_ctx, _key, command): Promise<TaskOccurrenceAdvanceResult> {
      const moduleMessage = command.message === undefined ? undefined : pendingOrdered;
      return {
        outcome: 'advanced',
        occurrence: snapshot(copyPlan(prepared), moduleMessage),
        moduleMessage,
      };
    },
  };

  const key: OccurrenceKey = {
    project: '10',
    module: 'tarefas',
    processId: 'ciclo',
    entity: 'ordem',
    recordId: 'rec-1',
  };
  const found = await port.find(ctx, key);
  assert.ok(found);
  assert.equal(found.plan.moduleTitle, MODULE_TITLE);

  for (const outcome of openOutcomes) {
    for (const moduleMessage of states) {
      const result: TaskOccurrenceOpenResult = {
        outcome,
        occurrence: snapshot(copyPlan(prepared), moduleMessage),
        ...(moduleMessage === undefined ? {} : { moduleMessage }),
      };
      assert.equal(result.moduleMessage?.state, moduleMessage?.state);
      if (moduleMessage === undefined) assert.equal(result.moduleMessage, undefined);
      if (moduleMessage?.state === 'pending') assert.equal(result.moduleMessage?.state, 'pending');
    }
  }
  for (const outcome of advanceOutcomes) {
    for (const moduleMessage of states) {
      const result: TaskOccurrenceAdvanceResult = {
        outcome,
        occurrence: snapshot(copyPlan(prepared), moduleMessage),
        ...(moduleMessage === undefined ? {} : { moduleMessage }),
      };
      assert.equal(result.moduleMessage?.state, moduleMessage?.state);
      if (moduleMessage === undefined) assert.equal(result.moduleMessage, undefined);
      if (moduleMessage?.state === 'pending') assert.equal(result.moduleMessage?.state, 'pending');
    }
  }

  const opened = await port.open(ctx, {
    ref: found.ref,
    plan: copyPlan(prepared),
    title: OCCURRENCE_TITLE,
    firstStep: 'S',
    actorNow: null,
    owner: 'mdm-owner',
    origin: { kind: 'event', by: 'mdm-actor' },
    executor: { kind: 'routine', name: 'ciclo.S' },
    room: { mode: 'group', groupKey: 'g1', members: ['mdm-owner'] },
    message: { content: 'opened' },
  });
  assert.equal(opened.moduleMessage?.state, 'pending');
  assert.equal(opened.occurrence.history[0].by, null);

  const advanced = await port.advance(ctx, key, {
    taskId: found.taskId,
    commandId: 'cmd-1',
    expectedRevision: found.revision,
    from: 'S',
    to: 'A',
    actorNow: 'mdm-actor',
    done: false,
    executor: person,
    wake: wakeRequest,
    message: { content: 'next' },
  });
  assert.equal(advanced.outcome, 'advanced');
  assert.equal(advanced.moduleMessage?.state, 'pending');
  assert.equal(advanced.moduleMessage?.orderAt, pendingOrdered.orderAt);
});

function rejectedShapes(): void {
  const prepared = prepareWorkflowPlan(planInput);
  const view = snapshot(prepared);
  // @ts-expect-error a task snapshot requires plan and revision
  const missingPlan: TaskOccurrenceSnapshot = {
    ref: view.ref,
    step: view.step,
    actorNow: view.actorNow,
    done: view.done,
    history: view.history,
    title: view.title,
    taskId: view.taskId,
    status: view.status,
    owner: view.owner,
    origin: view.origin,
    room: view.room,
    roomId: view.roomId,
    pass: view.pass,
  };
  // @ts-expect-error an advance command requires commandId and executor
  const missingCommand: TaskOccurrenceAdvanceCommand = {
    taskId: view.taskId,
    expectedRevision: view.revision,
    from: 'S',
    to: 'A',
    actorNow: 'mdm-actor',
    done: false,
  };
  // @ts-expect-error an open command requires the occurrence title
  const missingTitle: TaskOccurrenceOpenCommand = {
    ref: view.ref,
    plan: view.plan,
    firstStep: 'S',
    actorNow: 'mdm-actor',
    owner: view.owner,
    origin: view.origin,
    executor: { kind: 'person', mdmId: 'mdm-actor' },
    room: view.room,
  };
  // @ts-expect-error a person executor is an mdmId, not a cm userId
  const cmUser: WorkflowExecutor = { kind: 'person', userId: 'cm-user-1' };
  void missingPlan;
  void missingCommand;
  void missingTitle;
  void cmUser;
}

test('negative task-contract shapes are rejected by the type checker', () => {
  assert.equal(typeof rejectedShapes, 'function');
});
