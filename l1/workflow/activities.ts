/// <mls fileReference="_102034_/l1/workflow/activities.ts" enhancement="_blank"/>
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type {
  OccurrenceRef,
  TaskOccurrenceHistoryEntry,
  TaskOccurrenceSnapshot,
  WorkflowStepKind,
} from '/_102034_/l1/workflow/contracts.js';
import {
  indexWorkflowTable,
  ownerOf,
  prepareWorkflowPlan,
  type StepOwner,
  type WorkflowPlanStep,
} from '/_102034_/l1/workflow/plan.js';

const PROJECTION_INVALID = 'Workflow projection is not valid.';

export type WorkflowActivityState = 'future' | 'active' | 'completed';

/** Identity of an activity is (taskId, stepKey). pass is the current or last visit. */
export interface WorkflowActivity {
  stepKey: string;
  title: string;
  kind: WorkflowStepKind;
  ownerKind: StepOwner;
  actorRef?: string;
  journeyRef?: string;
  functionRef?: string;
  actorNow: string | null;
  pass: number;
  state: WorkflowActivityState;
  /** Property of the activity. It is not a permission to act or transfer. */
  actionable: boolean;
}

export interface WorkflowActivitiesSnapshot {
  ref: OccurrenceRef;
  taskId: string;
  revision: number;
  taskStatus: TaskOccurrenceSnapshot['status'];
  taskTitle: string;
  processTitle: string;
  moduleTitle: string;
  activities: WorkflowActivity[];
}

interface Visit {
  state: WorkflowActivityState;
  pass: number;
  actorNow: string | null;
}

function invalid(): never {
  throw new AppError('WORKFLOW_PROJECTION_INVALID', PROJECTION_INVALID, 502);
}

function copyRef(ref: OccurrenceRef): OccurrenceRef {
  return {
    project: ref.project,
    module: ref.module,
    processId: ref.processId,
    entity: ref.entity,
    recordId: ref.recordId,
    workflowVersion: ref.workflowVersion,
  };
}

function activityOf(
  step: WorkflowPlanStep,
  visit: Visit,
  taskStatus: TaskOccurrenceSnapshot['status'],
): WorkflowActivity {
  const activity: WorkflowActivity = {
    stepKey: step.stepId,
    title: step.title,
    kind: step.kind,
    ownerKind: step.ownerKind,
    actorNow: visit.actorNow,
    pass: visit.pass,
    state: visit.state,
    actionable: visit.state === 'active' && taskStatus === 'in progress' && step.ownerKind === 'person',
  };
  if (step.actorRef !== undefined) activity.actorRef = step.actorRef;
  if (step.journeyRef !== undefined) activity.journeyRef = step.journeyRef;
  if (step.functionRef !== undefined) activity.functionRef = step.functionRef;
  return activity;
}

/**
 * Projects one activity per persisted plan step. Does not read a release template,
 * a business record, or any clock, credential, or store.
 */
export function projectWorkflowActivities(snapshot: TaskOccurrenceSnapshot): WorkflowActivitiesSnapshot {
  const plan = snapshot.plan;
  let checked: ReturnType<typeof prepareWorkflowPlan>;
  try {
    indexWorkflowTable(plan, plan.processId);
    checked = prepareWorkflowPlan(plan);
  } catch (error) {
    // A plan the shared validation refuses is contradictory data inside a canonical snapshot.
    if (error instanceof AppError) invalid();
    throw error;
  }
  if (checked.steps.length !== plan.steps.length) invalid();
  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = plan.steps[i];
    if (step.ownerKind !== ownerOf(step.kind) || step.stepId !== checked.steps[i].stepId) invalid();
  }

  const visits = new Map<string, Visit>();
  for (const step of plan.steps) {
    visits.set(step.stepId, { state: 'future', pass: 0, actorNow: null });
  }

  const commandIds = new Set<string>();
  let current: string | null = null;
  let closed = false;

  for (const entry of snapshot.history) {
    if (closed) invalid();
    if (commandIds.has(entry.commandId)) invalid();
    commandIds.add(entry.commandId);
    const visit = visits.get(entry.step);
    if (visit === undefined) invalid();
    if (current === null) {
      if (entry.from !== null) invalid();
    } else if (entry.from !== current) {
      invalid();
    } else if (entry.from !== entry.step) {
      const previous = visits.get(current);
      if (previous === undefined) invalid();
      previous.state = 'completed';
    }
    // The engine closes with to = from; done never comes with a step change.
    if (entry.done && entry.from !== entry.step) invalid();
    if (entry.from !== entry.step) visit.pass += 1;
    visit.actorNow = entry.actorNow;
    if (entry.done) {
      visit.state = 'completed';
      current = null;
      closed = true;
      continue;
    }
    visit.state = 'active';
    current = entry.step;
  }

  const view = viewOf(current, visits, snapshot.history);
  if (
    snapshot.step !== view.step
    || snapshot.done !== view.done
    || snapshot.pass !== view.pass
    || snapshot.actorNow !== view.actorNow
  ) invalid();

  return {
    ref: copyRef(snapshot.ref),
    taskId: snapshot.taskId,
    revision: snapshot.revision,
    taskStatus: snapshot.status,
    taskTitle: snapshot.title,
    processTitle: plan.title,
    moduleTitle: plan.moduleTitle,
    activities: plan.steps.map((step) => activityOf(step, visits.get(step.stepId) as Visit, snapshot.status)),
  };
}

function viewOf(
  current: string | null,
  visits: Map<string, Visit>,
  history: TaskOccurrenceHistoryEntry[],
): { step: string; done: boolean; pass: number; actorNow: string | null } {
  if (history.length === 0 || (current !== null && !visits.has(current))) invalid();
  if (current !== null) {
    const visit = visits.get(current) as Visit;
    return { step: current, done: false, pass: visit.pass, actorNow: visit.actorNow };
  }
  const last = history[history.length - 1];
  if (last === undefined || last.done !== true) invalid();
  const closed = visits.get(last.step);
  if (closed === undefined) invalid();
  return { step: 'end', done: true, pass: closed.pass, actorNow: closed.actorNow };
}
