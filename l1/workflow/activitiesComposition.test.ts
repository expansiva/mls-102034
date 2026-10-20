/// <mls fileReference="_102034_/l1/workflow/activitiesComposition.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type {
  TaskOccurrenceAdvanceCommand,
  TaskOccurrenceHistoryEntry,
  TaskOccurrenceOpenCommand,
  TaskOccurrencePort,
  TaskOccurrenceSnapshot,
} from '/_102034_/l1/workflow/contracts.js';
import {
  createWorkflowEngine,
  ownerOf,
  projectWorkflowActivities,
  type TaskWorkflowAdvance,
  type TaskWorkflowEngine,
  type TaskWorkflowOpen,
  type WorkflowActivitiesSnapshot,
  type WorkflowPlanInput,
} from '/_102034_/l1/workflow/index.js';

const TASK_TITLE = 'Occurrence title';
const OWNER = 'owner-task';
const PERSON_A = 'person-a';
const PERSON_B = 'person-b';

interface PlanRow {
  name: string;
  planA: WorkflowPlanInput;
  templateB: WorkflowPlanInput;
  firstStep: string;
  futureStep: string;
}

const rows: PlanRow[] = [
  {
    name: 'human then future role',
    planA: {
      processId: 'ciclo',
      title: 'Process A',
      moduleTitle: 'Module A',
      steps: [
        { stepId: 'later', kind: 'human', title: 'Later A', actorRef: PERSON_A, journeyRef: 'journey-a', next: [] },
        { stepId: 'now', kind: 'human', title: 'Now A', actorRef: 'role-now-a', next: ['later'] },
        { stepId: 'mech', kind: 'mechanical', title: 'Machine A', functionRef: 'fn-a', next: ['now'] },
      ],
    },
    templateB: {
      processId: 'ciclo',
      title: 'Process B',
      moduleTitle: 'Module B',
      steps: [
        { stepId: 'later', kind: 'alert', title: 'Later B', actorRef: 'role-later-b', next: ['mech'] },
        { stepId: 'now', kind: 'wait', title: 'Now B', next: ['later'] },
        { stepId: 'mech', kind: 'llm', title: 'Agent B', functionRef: 'fn-b', journeyRef: 'journey-b', next: [] },
      ],
    },
    firstStep: 'now',
    futureStep: 'later',
  },
  {
    name: 'alert current and llm ahead',
    planA: {
      processId: 'aviso',
      title: 'Notice A',
      moduleTitle: 'Desk A',
      steps: [
        { stepId: 'wait', kind: 'human', title: 'Clock A', actorRef: PERSON_A, journeyRef: 'journey-wait-a', next: ['tell'] },
        { stepId: 'tell', kind: 'alert', title: 'Tell A', actorRef: 'role-tell-a', next: ['ask'] },
        { stepId: 'ask', kind: 'llm', title: 'Ask A', functionRef: 'fn-ask-a', next: ['tell'] },
      ],
    },
    templateB: {
      processId: 'aviso',
      title: 'Notice B',
      moduleTitle: 'Desk B',
      steps: [
        { stepId: 'wait', kind: 'mechanical', title: 'Clock B', functionRef: 'fn-clock-b', next: ['ask'] },
        { stepId: 'tell', kind: 'human', title: 'Tell B', actorRef: 'role-tell-b', journeyRef: 'journey-tell-b', next: ['wait'] },
        { stepId: 'ask', kind: 'human', title: 'Ask B', actorRef: PERSON_A, next: [] },
      ],
    },
    firstStep: 'tell',
    futureStep: 'wait',
  },
];

function requestCtx(): RequestContext {
  const ctx = createRequestContext();
  ctx.moduleId = 'tarefas';
  ctx.sessionContext.project.projectId = '10';
  ctx.sessionContext.person = { mdmId: PERSON_A, email: 'a@b.c', name: 'Ada' };
  ctx.requestMeta = { requestId: 'req-activities', userId: 'telemetry-user', source: 'test' };
  return ctx;
}

function openInput(
  plan: WorkflowPlanInput,
  recordId: string,
  firstStep: string,
  title = TASK_TITLE,
): TaskWorkflowOpen {
  return {
    key: { project: '10', module: 'tarefas', processId: plan.processId, entity: 'Tarefa', recordId },
    plan,
    title,
    firstStep,
    actorNow: PERSON_A,
    owner: OWNER,
    origin: { kind: 'screen', by: PERSON_A },
    executor: { kind: 'person', mdmId: PERSON_A },
    room: { mode: 'exclusive' },
  };
}

function passOf(history: TaskOccurrenceHistoryEntry[], step: string): number {
  return history.filter((entry) => entry.step === step && entry.from !== entry.step).length;
}

function born(command: TaskOccurrenceOpenCommand, recordId: string): TaskOccurrenceSnapshot {
  const entry: TaskOccurrenceHistoryEntry = {
    at: '2026-10-19T12:00:00.000Z',
    by: PERSON_A,
    from: null,
    step: command.firstStep,
    actorNow: command.actorNow,
    done: false,
    commandId: `open-${recordId}`,
    executor: command.executor,
  };
  return {
    ref: command.ref,
    step: command.firstStep,
    actorNow: command.actorNow,
    done: false,
    history: [entry],
    plan: command.plan,
    title: command.title,
    taskId: `task-${recordId}`,
    revision: 1,
    status: 'in progress',
    owner: command.owner,
    origin: command.origin,
    room: command.room,
    roomId: `room-${recordId}`,
    pass: 1,
  };
}

function applied(current: TaskOccurrenceSnapshot, command: TaskOccurrenceAdvanceCommand): TaskOccurrenceSnapshot {
  const entry: TaskOccurrenceHistoryEntry = {
    at: '2026-10-19T12:05:00.000Z',
    by: command.executor.kind === 'person' ? command.executor.mdmId : null,
    from: command.from,
    step: command.to,
    actorNow: command.actorNow,
    done: command.done,
    commandId: command.commandId,
    executor: command.executor,
  };
  const history = [...current.history, entry];
  const pass = passOf(history, command.to);
  return {
    ...current,
    step: command.done ? 'end' : command.to,
    actorNow: command.actorNow,
    done: command.done,
    history,
    revision: current.revision + 1,
    status: command.done ? 'done' : current.status,
    pass,
    plan: current.plan,
  };
}

function routed(): TaskOccurrencePort & { snapshots: Map<string, TaskOccurrenceSnapshot> } {
  const snapshots = new Map<string, TaskOccurrenceSnapshot>();
  const port: TaskOccurrencePort = {
    kind: 'task',
    async find(_ctx, key) {
      return snapshots.get(key.recordId) ?? null;
    },
    async open(_ctx, command) {
      const created = born(command, command.ref.recordId);
      snapshots.set(command.ref.recordId, created);
      return { outcome: 'created', occurrence: created };
    },
    async advance(_ctx, key, command) {
      const current = snapshots.get(key.recordId);
      if (!current) throw new Error('routed advance has no snapshot');
      if (current.history.some((entry) => entry.commandId === command.commandId)) {
        return { outcome: 'unchanged', occurrence: current };
      }
      const next = applied(current, command);
      snapshots.set(key.recordId, next);
      return { outcome: 'advanced', occurrence: next };
    },
  };
  return Object.assign(port, { snapshots });
}

function engine(port: TaskOccurrencePort): TaskWorkflowEngine {
  return createWorkflowEngine(port);
}

function project(snapshot: TaskOccurrenceSnapshot): WorkflowActivitiesSnapshot {
  return projectWorkflowActivities(snapshot);
}

test('public projector follows the persisted plan across recreated engines', async () => {
  for (const row of rows) {
    const book = routed();
    const ctx = requestCtx();
    const opened = await engine(book).open(ctx, openInput(row.planA, 'rec-a', row.firstStep));
    assert.equal(opened.outcome, 'created', row.name);
    const ofA = project(opened.occurrence);
    assert.equal(ofA.taskTitle, TASK_TITLE, row.name);
    assert.equal(ofA.processTitle, row.planA.title, row.name);
    assert.equal(ofA.moduleTitle, row.planA.moduleTitle, row.name);
    assert.deepEqual(ofA.activities.map((item) => item.stepKey), row.planA.steps.map((step) => step.stepId), row.name);
    assert.equal(ofA.activities.some((item) => item.stepKey === 'end'), false, row.name);
    for (const item of ofA.activities) assert.equal(item.ownerKind, ownerOf(item.kind), row.name);

    const resumed = await engine(book).open(ctx, openInput(row.templateB, 'rec-a', row.templateB.steps[0]!.stepId, 'Template title'));
    assert.equal(resumed.outcome, 'existing', row.name);
    const stillA = project(resumed.occurrence);
    assert.deepEqual(stillA, ofA, row.name);
    assert.equal(stillA.activities.find((item) => item.stepKey === row.firstStep)?.title, row.planA.steps.find((step) => step.stepId === row.firstStep)?.title, row.name);

    const createdB = await engine(book).open(ctx, openInput(row.templateB, 'rec-b', row.templateB.steps[0]!.stepId, 'Task B'));
    assert.equal(createdB.outcome, 'created', row.name);
    const ofB = project(createdB.occurrence);
    assert.equal(ofB.taskId, 'task-rec-b', row.name);
    assert.equal(ofB.processTitle, row.templateB.title, row.name);
    assert.equal(ofB.moduleTitle, row.templateB.moduleTitle, row.name);
    assert.deepEqual(
      ofB.activities.map((item) => item.title),
      row.templateB.steps.map((step) => step.title),
      row.name,
    );
    assert.notDeepEqual(ofB.activities.map((item) => item.kind), ofA.activities.map((item) => item.kind), row.name);

    const active = ofA.activities.find((item) => item.stepKey === row.firstStep);
    assert.ok(active, row.name);
    assert.equal(active.state, 'active', row.name);
    assert.equal(active.actorNow, PERSON_A, row.name);
    assert.equal(active.actionable, active.ownerKind === 'person', row.name);
    const future = ofA.activities.find((item) => item.stepKey === row.futureStep);
    assert.ok(future, row.name);
    assert.equal(future.state, 'future', row.name);
    assert.equal(future.actorRef, PERSON_A, row.name);
    assert.equal(future.actionable, false, row.name);
    assert.notEqual(active.actorNow, OWNER, row.name);

    const passBefore = active.pass;
    const transfer: TaskWorkflowAdvance = {
      commandId: `xfer-${row.name}`,
      expectedRevision: 1,
      from: row.firstStep,
      to: row.firstStep,
      actorNow: PERSON_B,
      executor: { kind: 'person', mdmId: PERSON_B },
    };
    const moved = await engine(book).advance(ctx, openInput(row.planA, 'rec-a', row.firstStep).key, transfer);
    assert.equal(moved.outcome, 'advanced', row.name);
    const after = project(moved.occurrence);
    const movedStep = after.activities.find((item) => item.stepKey === row.firstStep);
    assert.ok(movedStep, row.name);
    assert.equal(movedStep.actorNow, PERSON_B, row.name);
    assert.equal(movedStep.pass, passBefore, row.name);
    assert.equal(movedStep.state, 'active', row.name);
    assert.deepEqual(after.activities.map((item) => item.stepKey), ofA.activities.map((item) => item.stepKey), row.name);
    assert.equal(after.processTitle, row.planA.title, row.name);

    const replay = await engine(book).advance(ctx, openInput(row.planA, 'rec-a', row.firstStep).key, {
      ...transfer,
      to: row.templateB.steps.find((step) => step.stepId === row.firstStep)?.next[0] ?? 'end',
      actorNow: OWNER,
    });
    assert.equal(replay.outcome, 'unchanged', row.name);
    assert.deepEqual(project(replay.occurrence), after, row.name);
    assert.equal(replay.occurrence.history.length, moved.occurrence.history.length, row.name);

    const again = project((await engine(book).find(ctx, openInput(row.planA, 'rec-a', row.firstStep).key))!);
    assert.deepEqual(again, after, row.name);

    // Registered stand-ins for edits that were run and reverted:
    // actorNow copied from the task owner, and every person step marked actionable.
    const ownerAsActor = after.activities.map((item) => (
      item.state === 'active' ? { ...item, actorNow: moved.occurrence.owner } : item
    ));
    const everyPerson = after.activities.map((item) => (
      item.ownerKind === 'person' ? { ...item, actionable: true } : item
    ));
    assert.notDeepEqual(ownerAsActor, after.activities, row.name);
    assert.notDeepEqual(everyPerson, after.activities, row.name);
    assert.equal(everyPerson.filter((item) => item.actionable).length > after.activities.filter((item) => item.actionable).length, true, row.name);

    const frozen = structuredClone(moved.occurrence);
    after.activities[0]!.title = 'mutated';
    after.ref.recordId = 'mutated';
    after.activities.push({ ...after.activities[0]! });
    assert.deepEqual(moved.occurrence, frozen, row.name);
    assert.equal(book.snapshots.get('rec-a'), moved.occurrence, row.name);
  }
});

test('a repeated command that the engine already saw does not open a new passage', async () => {
  const book = routed();
  const ctx = requestCtx();
  const row = rows[0]!;
  await engine(book).open(ctx, openInput(row.planA, 'rec-a', row.firstStep));
  const command: TaskWorkflowAdvance = {
    commandId: 'known-1',
    expectedRevision: 1,
    from: row.firstStep,
    to: 'later',
    actorNow: null,
    executor: { kind: 'routine', name: 'ciclo.now' },
  };
  const moved = await engine(book).advance(ctx, openInput(row.planA, 'rec-a', row.firstStep).key, command);
  const projected = project(moved.occurrence);
  const replay = await engine(book).advance(ctx, openInput(row.planA, 'rec-a', row.firstStep).key, {
    ...command,
    to: 'end',
    actorNow: PERSON_B,
  });
  assert.equal(replay.outcome, 'unchanged');
  assert.deepEqual(project(replay.occurrence), projected);
  assert.equal(projected.activities.find((item) => item.stepKey === 'later')?.pass, 1);
  assert.equal(projected.activities.find((item) => item.stepKey === row.firstStep)?.pass, 1);
  assert.equal(projected.activities.some((item) => item.stepKey === 'end'), false);
});

test('the strict engine still refuses a destination outside the persisted plan', async () => {
  const book = routed();
  const row = rows[0]!;
  await engine(book).open(requestCtx(), openInput(row.planA, 'rec-a', row.firstStep));
  await assert.rejects(
    () => engine(book).advance(requestCtx(), openInput(row.planA, 'rec-a', row.firstStep).key, {
      commandId: 'foreign',
      expectedRevision: 1,
      from: row.firstStep,
      to: 'not-in-a',
      actorNow: null,
      executor: { kind: 'routine', name: 'ciclo.now' },
    }),
    (error: unknown) => error instanceof AppError && error.code === 'UNKNOWN_STEP',
  );
  assert.equal(book.snapshots.get('rec-a')?.history.length, 1);
});
