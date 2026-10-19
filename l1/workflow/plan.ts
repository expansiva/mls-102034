/// <mls fileReference="_102034_/l1/workflow/plan.ts" enhancement="_blank"/>
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type {
  WorkflowStepDef,
  WorkflowStepKind,
  WorkflowTable,
} from '/_102034_/l1/workflow/contracts.js';

const STEP_KINDS = new Set<WorkflowStepKind>(['human', 'mechanical', 'llm', 'wait', 'alert']);

export type StepOwner = 'person' | 'module' | 'agent' | 'clock';

/** Owner of a step comes from its kind. The module does not store this. */
export function ownerOf(kind: WorkflowStepKind): StepOwner {
  switch (kind) {
    case 'human':
    case 'alert':
      return 'person';
    case 'mechanical':
      return 'module';
    case 'llm':
      return 'agent';
    case 'wait':
      return 'clock';
    default: {
      const unexpected: never = kind;
      throw new AppError('INVALID_WORKFLOW_TABLE', `Step kind is not valid: ${unexpected}`, 400);
    }
  }
}

/** Historical table check shared with the engine. Stricter plan fields stay in prepareWorkflowPlan. */
export function indexWorkflowTable(table: WorkflowTable, processId: string): Map<string, WorkflowStepDef> {
  if (table.processId === '' || table.processId !== processId) {
    throw new AppError('INVALID_WORKFLOW_TABLE', 'Process id does not match the occurrence.', 400);
  }
  const steps = new Map<string, WorkflowStepDef>();
  for (const step of table.steps) {
    if (step.stepId === '' || step.stepId === 'end' || steps.has(step.stepId)) {
      throw new AppError(
        'INVALID_WORKFLOW_TABLE',
        'Step ids must be unique, non-empty, and must not use the reserved id end.',
        400,
      );
    }
    if (!STEP_KINDS.has(step.kind)) {
      throw new AppError('INVALID_WORKFLOW_TABLE', 'Step kind is not valid.', 400);
    }
    steps.set(step.stepId, step);
  }
  for (const step of table.steps) {
    for (const next of step.next) {
      if (!steps.has(next)) {
        throw new AppError('INVALID_WORKFLOW_TABLE', 'A next id is not a step in the table.', 400);
      }
    }
  }
  return steps;
}

export interface WorkflowPlanStepInput extends WorkflowStepDef {
  title: string;
  functionRef?: string;
  conditions?: string;
  params?: Record<string, string>;
}

export interface WorkflowPlanInput {
  processId: string;
  title: string;
  moduleTitle: string;
  steps: WorkflowPlanStepInput[];
}

export interface WorkflowPlanStep extends WorkflowPlanStepInput {
  ownerKind: StepOwner;
}

export interface WorkflowPlan {
  processId: string;
  title: string;
  moduleTitle: string;
  steps: WorkflowPlanStep[];
}

function refuse(processId: string, field: string, detail: string, stepId?: string): never {
  const where = stepId === undefined ? `process ${processId}` : `process ${processId} step ${stepId}`;
  throw new AppError('INVALID_WORKFLOW_TABLE', `${where} field ${field}: ${detail}`, 400);
}

function canonicalId(value: string): boolean {
  return value.length > 0 && value === value.trim();
}

function requireText(processId: string, field: string, value: string, stepId?: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    refuse(processId, field, 'must be a non-empty string.', stepId);
  }
}

function requireOptionalRef(
  processId: string,
  stepId: string,
  field: 'actorRef' | 'journeyRef' | 'functionRef',
  value: string | undefined,
): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !canonicalId(value)) {
    refuse(processId, field, 'must be a canonical id when present.', stepId);
  }
}

function assertParams(
  processId: string,
  stepId: string,
  params: Record<string, string> | undefined,
): void {
  if (params === undefined) return;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    refuse(processId, 'params', 'must be an object of strings.', stepId);
  }
  for (const [name, value] of Object.entries(params)) {
    if (typeof value !== 'string') {
      refuse(processId, `params.${name}`, 'must be a string.', stepId);
    }
  }
}

function copyStep(step: WorkflowPlanStepInput): WorkflowPlanStep {
  const copy: WorkflowPlanStep = {
    stepId: step.stepId,
    kind: step.kind,
    title: step.title,
    next: [...step.next],
    ownerKind: ownerOf(step.kind),
  };
  if (step.actorRef !== undefined) copy.actorRef = step.actorRef;
  if (step.journeyRef !== undefined) copy.journeyRef = step.journeyRef;
  if (step.functionRef !== undefined) copy.functionRef = step.functionRef;
  if (step.conditions !== undefined) copy.conditions = step.conditions;
  if (step.params !== undefined) copy.params = { ...step.params };
  return copy;
}

export function prepareWorkflowPlan(input: WorkflowPlanInput): WorkflowPlan {
  const processId = typeof input.processId === 'string' ? input.processId : '';
  if (!canonicalId(processId)) {
    refuse(processId, 'processId', 'must be a canonical id.');
  }
  requireText(processId, 'title', input.title);
  requireText(processId, 'moduleTitle', input.moduleTitle);
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    refuse(processId, 'steps', 'must list at least one step.');
  }
  for (const step of input.steps) {
    const stepId = typeof step.stepId === 'string' ? step.stepId : '';
    if (!canonicalId(stepId)) {
      refuse(processId, 'stepId', 'must be a canonical id.', stepId);
    }
    requireText(processId, 'title', step.title, stepId);
    if (!Array.isArray(step.next)) {
      refuse(processId, 'next', 'must be an array of ids.', stepId);
    }
    for (const next of step.next) {
      if (typeof next !== 'string' || !canonicalId(next)) {
        refuse(processId, 'next', 'must contain canonical ids.', stepId);
      }
    }
    requireOptionalRef(processId, stepId, 'actorRef', step.actorRef);
    requireOptionalRef(processId, stepId, 'journeyRef', step.journeyRef);
    requireOptionalRef(processId, stepId, 'functionRef', step.functionRef);
    if (step.conditions !== undefined && typeof step.conditions !== 'string') {
      refuse(processId, 'conditions', 'must be a string.', stepId);
    }
    assertParams(processId, stepId, step.params);
  }
  indexWorkflowTable(input, processId);
  return {
    processId,
    title: input.title,
    moduleTitle: input.moduleTitle,
    steps: input.steps.map(copyStep),
  };
}
