/// <mls fileReference="_102034_/l1/workflow/activities.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type {
  TaskOccurrenceHistoryEntry,
  TaskOccurrenceSnapshot,
  WorkflowExecutor,
} from '/_102034_/l1/workflow/contracts.js';
import { prepareWorkflowPlan, type WorkflowPlan, type WorkflowPlanInput } from '/_102034_/l1/workflow/plan.js';
import { projectWorkflowActivities, type WorkflowActivity } from '/_102034_/l1/workflow/activities.js';

const TASK_TITLE = 'Occurrence title';
const PROCESS_TITLE = 'Process title';
const MODULE_TITLE = 'Module title';

const planInput: WorkflowPlanInput = {
  processId: 'ciclo',
  title: PROCESS_TITLE,
  moduleTitle: MODULE_TITLE,
  steps: [
    { stepId: 'A', kind: 'wait', title: 'Wait', next: ['B'], journeyRef: 'journey-a' },
    {
      stepId: 'B',
      kind: 'human',
      title: 'Review',
      next: ['C', 'A'],
      actorRef: 'role-reviewer',
    },
    {
      stepId: 'C',
      kind: 'mechanical',
      title: 'Apply',
      next: ['D'],
      functionRef: 'fn-apply',
    },
    { stepId: 'D', kind: 'llm', title: 'Draft', next: [], actorRef: 'role-agent' },
  ],
};

function person(mdmId: string): WorkflowExecutor {
  return { kind: 'person', mdmId };
}

function entry(
  patch: Pick<TaskOccurrenceHistoryEntry, 'commandId' | 'from' | 'step' | 'actorNow' | 'done'> & {
    executor?: WorkflowExecutor;
  },
): TaskOccurrenceHistoryEntry {
  const executor = patch.executor ?? (patch.actorNow === null
    ? { kind: 'routine', name: 'ciclo.tick' }
    : person(patch.actorNow));
  return {
    at: '2026-10-19T12:00:00.000Z',
    by: executor.kind === 'person' ? executor.mdmId : null,
    from: patch.from,
    step: patch.step,
    actorNow: patch.actorNow,
    done: patch.done,
    commandId: patch.commandId,
    executor,
  };
}

function snapshot(
  history: TaskOccurrenceHistoryEntry[],
  patch: Partial<TaskOccurrenceSnapshot> = {},
  plan: WorkflowPlan = prepareWorkflowPlan(planInput),
): TaskOccurrenceSnapshot {
  const last = history[history.length - 1];
  return {
    ref: {
      project: '10',
      module: 'tarefas',
      processId: 'ciclo',
      entity: 'ordem',
      recordId: 'rec-1',
      workflowVersion: null,
    },
    step: last?.done === true ? 'end' : (last?.step ?? 'B'),
    actorNow: last?.actorNow ?? null,
    done: last?.done === true,
    history,
    plan,
    title: TASK_TITLE,
    taskId: 'task-1',
    revision: 4,
    status: 'in progress',
    owner: 'mdm-owner',
    origin: { kind: 'screen', by: 'mdm-owner' },
    room: { mode: 'group', groupKey: 'room-group', members: ['mdm-owner', 'mdm-ada'] },
    roomId: 'room-1',
    pass: 1,
    ...patch,
  };
}

function byKey(activities: WorkflowActivity[]): Map<string, WorkflowActivity> {
  return new Map(activities.map((activity) => [activity.stepKey, activity]));
}

test('projects the persisted plan from a middle step, with future steps and distinct actors', () => {
  const releaseTemplate = prepareWorkflowPlan({
    ...planInput,
    title: 'Release process',
    moduleTitle: 'Release module',
    steps: planInput.steps.map((step) => ({ ...step, title: `release ${step.title}`, next: [...step.next] })),
  });
  const history = [
    entry({ commandId: 'open-1', from: null, step: 'B', actorNow: 'mdm-ada', done: false }),
    entry({ commandId: 'move-1', from: 'B', step: 'C', actorNow: null, done: false, executor: { kind: 'routine', name: 'ciclo.C' } }),
    entry({ commandId: 'move-2', from: 'C', step: 'B', actorNow: 'mdm-bea', done: false }),
    entry({ commandId: 'xfer-1', from: 'B', step: 'B', actorNow: 'mdm-cio', done: false }),
  ];
  const source = snapshot(history, { pass: 2, actorNow: 'mdm-cio', step: 'B' });
  const projected = projectWorkflowActivities(source);
  const activities = byKey(projected.activities);

  assert.deepEqual(projected.activities.map((activity) => activity.stepKey), ['A', 'B', 'C', 'D']);
  assert.equal(projected.taskTitle, TASK_TITLE);
  assert.equal(projected.processTitle, PROCESS_TITLE);
  assert.equal(projected.moduleTitle, MODULE_TITLE);
  assert.equal(projected.ref.workflowVersion, null);
  assert.equal(projected.taskId, 'task-1');
  assert.equal(projected.revision, 4);
  assert.equal(projected.taskStatus, 'in progress');
  assert.notEqual(projected.processTitle, releaseTemplate.title);
  assert.notEqual(projected.moduleTitle, releaseTemplate.moduleTitle);

  const wait = activities.get('A');
  const review = activities.get('B');
  const apply = activities.get('C');
  const draft = activities.get('D');
  assert.ok(wait && review && apply && draft);
  assert.equal(wait.state, 'future');
  assert.equal(wait.pass, 0);
  assert.equal(wait.actorNow, null);
  assert.equal(wait.actionable, false);
  assert.equal(wait.journeyRef, 'journey-a');
  assert.equal(review.state, 'active');
  assert.equal(review.pass, 2);
  assert.equal(review.actorNow, 'mdm-cio');
  assert.equal(review.actorRef, 'role-reviewer');
  assert.notEqual(review.actorNow, source.owner);
  assert.equal(review.ownerKind, 'person');
  assert.equal(review.actionable, true);
  assert.equal(apply.state, 'completed');
  assert.equal(apply.pass, 1);
  assert.equal(apply.actorNow, null);
  assert.equal(apply.functionRef, 'fn-apply');
  assert.equal(apply.actionable, false);
  assert.equal(draft.state, 'future');
  assert.equal(draft.actionable, false);
  assert.equal(projected.activities.some((activity) => activity.stepKey === 'end'), false);
});

test('a transfer keeps the pass, and pause, failure, and non-person steps are not actionable', () => {
  const history = [
    entry({ commandId: 'open-1', from: null, step: 'B', actorNow: null, done: false, executor: { kind: 'routine', name: 'ciclo.B' } }),
    entry({ commandId: 'xfer-1', from: 'B', step: 'B', actorNow: 'mdm-ada', done: false }),
  ];
  const open = projectWorkflowActivities(snapshot(history, { pass: 1, actorNow: 'mdm-ada' }));
  const review = byKey(open.activities).get('B');
  assert.ok(review);
  assert.equal(review.pass, 1);
  assert.equal(review.actorNow, 'mdm-ada');
  assert.equal(review.actorRef, 'role-reviewer');
  assert.equal(review.actionable, true);
  assert.equal(history[0].by, null);

  for (const taskStatus of ['paused', 'failed', 'done', 'todo'] as const) {
    const projected = projectWorkflowActivities(snapshot(history, { pass: 1, actorNow: 'mdm-ada', status: taskStatus }));
    assert.equal(byKey(projected.activities).get('B')?.actionable, false);
    assert.equal(byKey(projected.activities).get('B')?.state, 'active');
  }

  const mechanical = [
    entry({ commandId: 'open-1', from: null, step: 'C', actorNow: 'mdm-ada', done: false }),
  ];
  const routineStep = projectWorkflowActivities(snapshot(mechanical, { step: 'C', pass: 1, actorNow: 'mdm-ada' }));
  const apply = byKey(routineStep.activities).get('C');
  assert.ok(apply);
  assert.equal(apply.state, 'active');
  assert.equal(apply.ownerKind, 'module');
  assert.equal(apply.actionable, false);
  assert.equal(apply.actorNow, 'mdm-ada');

  const alertPlan = prepareWorkflowPlan({
    processId: 'ciclo',
    title: PROCESS_TITLE,
    moduleTitle: MODULE_TITLE,
    steps: [{ stepId: 'N', kind: 'alert', title: 'Notice', next: [], actorRef: 'role-notice' }],
  });
  const alerted = projectWorkflowActivities(snapshot([
    entry({ commandId: 'open-1', from: null, step: 'N', actorNow: null, done: false, executor: { kind: 'routine', name: 'ciclo.N' } }),
  ], { step: 'N', pass: 1, actorNow: null }, alertPlan));
  const notice = alerted.activities[0];
  assert.equal(notice.ownerKind, 'person');
  assert.equal(notice.state, 'active');
  assert.equal(notice.actorNow, null);
  assert.equal(notice.actorRef, 'role-notice');
  assert.equal(notice.actionable, true);
});

test('logical close keeps unfinished steps future and does not invent an end activity', () => {
  const history = [
    entry({ commandId: 'open-1', from: null, step: 'B', actorNow: 'mdm-ada', done: false }),
    entry({ commandId: 'close-1', from: 'B', step: 'B', actorNow: 'mdm-ada', done: true }),
  ];
  const projected = projectWorkflowActivities(snapshot(history, {
    step: 'end',
    done: true,
    pass: 1,
    actorNow: 'mdm-ada',
    status: 'done',
    ref: {
      project: '10',
      module: 'tarefas',
      processId: 'ciclo',
      entity: 'ordem',
      recordId: 'rec-1',
      workflowVersion: 'rel-a',
    },
  }));
  const activities = byKey(projected.activities);
  assert.equal(projected.ref.workflowVersion, 'rel-a');
  assert.equal(activities.get('A')?.state, 'future');
  assert.equal(activities.get('B')?.state, 'completed');
  assert.equal(activities.get('B')?.pass, 1);
  assert.equal(activities.get('B')?.actionable, false);
  assert.equal(activities.get('C')?.state, 'future');
  assert.equal(activities.get('D')?.state, 'future');
  assert.equal(projected.activities.some((activity) => activity.stepKey === 'end'), false);
});

test('mutating the projection does not change the snapshot', () => {
  const source = snapshot([
    entry({ commandId: 'open-1', from: null, step: 'B', actorNow: 'mdm-ada', done: false }),
  ], { pass: 1, actorNow: 'mdm-ada' });
  const planTitle = source.plan.title;
  const stepTitle = source.plan.steps[1].title;
  const projected = projectWorkflowActivities(source);
  projected.taskTitle = 'changed task';
  projected.processTitle = 'changed process';
  projected.moduleTitle = 'changed module';
  projected.ref.project = 'changed';
  projected.ref.workflowVersion = 'changed';
  projected.activities[1].title = 'changed step';
  projected.activities[1].actorNow = 'changed-actor';
  projected.activities[1].actionable = false;
  projected.activities.push({ ...projected.activities[0], stepKey: 'end' });
  assert.equal(source.title, TASK_TITLE);
  assert.equal(source.plan.title, planTitle);
  assert.equal(source.plan.moduleTitle, MODULE_TITLE);
  assert.equal(source.plan.steps[1].title, stepTitle);
  assert.equal(source.ref.project, '10');
  assert.equal(source.ref.workflowVersion, null);
  assert.equal(source.actorNow, 'mdm-ada');
  assert.equal(source.history.length, 1);
  assert.equal(source.plan.steps.length, 4);
});

test('contradictory history, view, and ownerKind are rejected without repair', () => {
  const open = [
    entry({ commandId: 'open-1', from: null, step: 'B', actorNow: 'mdm-ada', done: false }),
  ];
  const cases: TaskOccurrenceSnapshot[] = [
    snapshot([
      entry({ commandId: 'open-1', from: null, step: 'B', actorNow: 'mdm-ada', done: false }),
      entry({ commandId: 'move-1', from: 'A', step: 'C', actorNow: null, done: false }),
    ]),
    snapshot([
      entry({ commandId: 'open-1', from: null, step: 'B', actorNow: 'mdm-ada', done: false }),
      entry({ commandId: 'open-1', from: 'B', step: 'C', actorNow: null, done: false }),
    ]),
    snapshot([
      entry({ commandId: 'open-1', from: null, step: 'missing', actorNow: 'mdm-ada', done: false }),
    ], { step: 'missing' }),
    snapshot(open, { pass: 2 }),
    snapshot(open, { actorNow: 'mdm-owner' }),
    snapshot(open, { step: 'end', done: true }),
    snapshot([
      entry({ commandId: 'open-1', from: null, step: 'B', actorNow: 'mdm-ada', done: true }),
      entry({ commandId: 'after-1', from: 'B', step: 'C', actorNow: null, done: false }),
    ], { step: 'C', done: false, pass: 1, actorNow: null }),
    snapshot([
      entry({ commandId: 'open-1', from: 'B', step: 'B', actorNow: 'mdm-ada', done: false }),
    ]),
    snapshot([
      entry({ commandId: 'open-1', from: null, step: 'B', actorNow: 'mdm-ada', done: false }),
      entry({ commandId: 'close-1', from: 'B', step: 'C', actorNow: null, done: true }),
    ], { step: 'end', done: true, pass: 1, actorNow: null }),
  ];
  for (const source of cases) {
    assert.throws(
      () => projectWorkflowActivities(source),
      (error: unknown) => error instanceof AppError
        && error.code === 'WORKFLOW_PROJECTION_INVALID'
        && error.statusCode === 502
        && error.message === 'Workflow projection is not valid.',
    );
  }

  const plan = prepareWorkflowPlan(planInput);
  plan.steps[2].ownerKind = 'person';
  assert.throws(
    () => projectWorkflowActivities(snapshot([
      entry({ commandId: 'open-1', from: null, step: 'C', actorNow: null, done: false }),
    ], { step: 'C', actorNow: null }, plan)),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_PROJECTION_INVALID',
  );
  assert.equal(plan.steps[2].ownerKind, 'person');

  const untitled = prepareWorkflowPlan(planInput);
  untitled.steps[0].title = '   ';
  assert.throws(
    () => projectWorkflowActivities(snapshot(open, {}, untitled)),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_PROJECTION_INVALID' && error.statusCode === 502,
  );
});
