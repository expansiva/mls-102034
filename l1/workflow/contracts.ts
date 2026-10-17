/// <mls fileReference="_102034_/l1/workflow/contracts.ts" enhancement="_blank"/>
import type { IClock } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

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
