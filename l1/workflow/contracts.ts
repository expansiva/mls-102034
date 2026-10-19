/// <mls fileReference="_102034_/l1/workflow/contracts.ts" enhancement="_blank"/>
import type { IClock, RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { ModuleWake, ResponseOpenModuleTask, TaskData } from '/_102036_/l2/shared/interfaces.js';
import type { WorkflowPlan } from '/_102034_/l1/workflow/plan.js';

export type WorkflowStepKind = 'human' | 'mechanical' | 'llm' | 'wait' | 'alert';

export interface WorkflowStepDef {
  stepId: string;
  kind: WorkflowStepKind;
  actorRef?: string;
  journeyRef?: string;
  next: string[];
}

export interface WorkflowTable {
  processId: string;
  steps: WorkflowStepDef[];
}

/** Identity of one occurrence. Version is not part of the key. */
export interface OccurrenceKey {
  project: string;
  module: string;
  processId: string;
  entity: string;
  recordId: string;
}

export interface OccurrenceRef extends OccurrenceKey {
  workflowVersion: string | null;
}

export interface OccurrenceHistoryEntry {
  at: string;
  /** Session person when one exists. A tick does not invent an identity. */
  by: string | null;
  from: string | null;
  step: string;
  actorNow: string | null;
  done: boolean;
  note?: string;
}

export interface OccurrenceSnapshot {
  ref: OccurrenceRef;
  step: string;
  actorNow: string | null;
  done: boolean;
  history: OccurrenceHistoryEntry[];
}

export interface OpenOccurrenceResult {
  outcome: 'created' | 'existing';
  occurrence: OccurrenceSnapshot;
}

export interface AdvanceOccurrenceCommand {
  from: string;
  to: string;
  actorNow: string | null;
  done: boolean;
  note?: string;
  by: string | null;
}

export interface AdvanceOccurrenceResult {
  outcome: 'advanced' | 'unchanged' | 'conflict';
  occurrence: OccurrenceSnapshot;
}

/** Fields the occurrence port reads. A full request context satisfies this. */
export interface OccurrenceContext {
  clock: IClock;
}

export interface OccurrencePort {
  open(
    ctx: OccurrenceContext,
    ref: OccurrenceRef,
    step: string,
    actorNow: string | null,
    by: string | null,
  ): Promise<OpenOccurrenceResult>;
  find(ctx: OccurrenceContext, key: OccurrenceKey): Promise<OccurrenceSnapshot | null>;
  advance(
    ctx: OccurrenceContext,
    key: OccurrenceKey,
    command: AdvanceOccurrenceCommand,
  ): Promise<AdvanceOccurrenceResult>;
}

/** Person is an MDM id. A cm userId is not an identity in this contract. */
export type WorkflowExecutor = { kind: 'person'; mdmId: string } | { kind: 'routine'; name: string };

export interface WorkflowOrigin {
  kind: 'screen' | 'channel' | 'schedule' | 'event';
  /** MDM id of the person who produced the origin, when one exists. */
  by?: string;
  config?: string;
}

export interface WorkflowRoomChoice {
  mode: 'exclusive' | 'person' | 'group';
  groupKey?: string;
  /** MDM ids. */
  members?: string[];
}

/** Wake requested for the destination step. Absence stays absent; the port owns nextAt and seq. */
export type WorkflowWakeRequest = Omit<ModuleWake, 'nextAt' | 'seq'>;

/** Wake stored on the occurrence. Same shape as the cm wake, without a second identity. */
export type WorkflowWake = ModuleWake;

/** Delivery state projected from the durable record. Content and cm author stay out. */
export type TaskOccurrenceMessageStatus = NonNullable<ResponseOpenModuleTask['moduleMessage']>;

export interface TaskOccurrenceHistoryEntry extends OccurrenceHistoryEntry {
  commandId: string;
  executor: WorkflowExecutor;
  /** Projected delivery state of this entry. Absent is not sent. */
  message?: TaskOccurrenceMessageStatus;
}

/** View returned by the task port. The logical step may be `end`; the plan does not contain that id. */
export interface TaskOccurrenceSnapshot extends OccurrenceSnapshot {
  plan: WorkflowPlan;
  /** Occurrence title. Distinct from plan.title and plan.moduleTitle. */
  title: string;
  taskId: string;
  revision: number;
  status: TaskData['status'];
  /** MDM id of the owner. */
  owner: string;
  origin: WorkflowOrigin;
  room: WorkflowRoomChoice;
  roomId: string;
  pass: number;
  wake?: WorkflowWake;
  history: TaskOccurrenceHistoryEntry[];
}

export interface TaskOccurrenceOpenCommand {
  ref: OccurrenceRef;
  plan: WorkflowPlan;
  /** Occurrence title supplied by L1. Not derived from the plan titles. */
  title: string;
  firstStep: string;
  /** MDM id of the acting person, or null when the executor is a routine. */
  actorNow: string | null;
  /** MDM id of the owner. */
  owner: string;
  origin: WorkflowOrigin;
  executor: WorkflowExecutor;
  room: WorkflowRoomChoice;
  message?: { content: string };
}

export interface TaskOccurrenceAdvanceCommand {
  taskId: string;
  commandId: string;
  expectedRevision: number;
  from: string;
  /** Real step key. Physical close is to=from with done=true. */
  to: string;
  actorNow: string | null;
  done: boolean;
  executor: WorkflowExecutor;
  note?: string;
  /** Present only when the destination should receive a wake. Omission removes or keeps per the port rule. */
  wake?: WorkflowWakeRequest;
  message?: { content: string };
}

export interface TaskOccurrenceOpenResult {
  outcome: 'created' | 'existing';
  occurrence: TaskOccurrenceSnapshot;
  moduleMessage?: TaskOccurrenceMessageStatus;
}

export interface TaskOccurrenceAdvanceResult {
  outcome: 'advanced' | 'unchanged' | 'conflict' | 'paused';
  occurrence: TaskOccurrenceSnapshot;
  moduleMessage?: TaskOccurrenceMessageStatus;
}

export interface TaskOccurrencePort {
  readonly kind: 'task';
  open(ctx: RequestContext, command: TaskOccurrenceOpenCommand): Promise<TaskOccurrenceOpenResult>;
  find(ctx: RequestContext, key: OccurrenceKey): Promise<TaskOccurrenceSnapshot | null>;
  advance(
    ctx: RequestContext,
    key: OccurrenceKey,
    command: TaskOccurrenceAdvanceCommand,
  ): Promise<TaskOccurrenceAdvanceResult>;
}
