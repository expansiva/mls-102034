/// <mls fileReference="_102034_/l1/workflow/engine.ts" enhancement="_blank"/>
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { IClock, ILogger } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { getRunningRelease } from '/_102034_/l1/server/layer_1_external/cbe/cbeRelease.js';
import type {
  AdvanceOccurrenceResult,
  OccurrenceKey,
  OccurrencePort,
  OccurrenceSnapshot,
  OpenOccurrenceResult,
  WorkflowStepDef,
  WorkflowStepKind,
  WorkflowTable,
} from '/_102034_/l1/workflow/contracts.js';

const STEP_KINDS = new Set<WorkflowStepKind>(['human', 'mechanical', 'llm', 'wait', 'alert']);

export type StepOwner = 'person' | 'module' | 'agent' | 'clock';

/** Caller fields this engine reads. A request context satisfies this. */
export interface WorkflowEngineContext {
  clock: IClock;
  log: ILogger;
  sessionContext?: {
    person?: { mdmId: string } | null;
  };
}

export interface WorkflowAdvance {
  from: string;
  to: string;
  actorNow: string | null;
  note?: string;
}

export interface WorkflowEngine {
  open(
    ctx: WorkflowEngineContext,
    table: WorkflowTable,
    key: OccurrenceKey,
    firstStep: string,
    actorNow: string | null,
  ): Promise<OpenOccurrenceResult>;
  advance(
    ctx: WorkflowEngineContext,
    table: WorkflowTable,
    key: OccurrenceKey,
    command: WorkflowAdvance,
  ): Promise<AdvanceOccurrenceResult>;
  find(ctx: WorkflowEngineContext, key: OccurrenceKey): Promise<OccurrenceSnapshot | null>;
}

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

function sessionBy(ctx: WorkflowEngineContext): string | null {
  return ctx.sessionContext?.person?.mdmId ?? null;
}

function indexTable(table: WorkflowTable, processId: string): Map<string, WorkflowStepDef> {
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

/** `end` is always a close. Reassignment is from===to. Other targets must be reachable. */
function canReach(steps: Map<string, WorkflowStepDef>, from: string, to: string): boolean {
  if (!steps.has(from)) return false;
  if (to === 'end' || from === to) return true;
  const visited = new Set<string>([from]);
  const pending = [...steps.get(from)!.next];
  while (pending.length > 0) {
    const stepId = pending.pop()!;
    if (stepId === to) return true;
    if (visited.has(stepId)) continue;
    visited.add(stepId);
    const step = steps.get(stepId);
    if (step) pending.push(...step.next);
  }
  return false;
}

function runningVersion(): string | null {
  return getRunningRelease()?.id ?? null;
}

export function createWorkflowEngine(port: OccurrencePort): WorkflowEngine {
  return {
    async open(ctx, table, key, firstStep, actorNow) {
      const steps = indexTable(table, key.processId);
      if (!steps.has(firstStep)) {
        throw new AppError('UNKNOWN_STEP', 'The first step is not in the table.', 400);
      }
      const workflowVersion = runningVersion();
      if (workflowVersion === null) {
        ctx.log.info('WORKFLOW_VERSION_UNKNOWN', {
          project: key.project,
          module: key.module,
          processId: key.processId,
          entity: key.entity,
          recordId: key.recordId,
        });
      }
      return port.open(
        ctx,
        { ...key, workflowVersion },
        firstStep,
        actorNow,
        sessionBy(ctx),
      );
    },

    async advance(ctx, table, key, command) {
      const steps = indexTable(table, key.processId);
      const current = await port.find(ctx, key);
      if (!current) {
        throw new AppError('OCCURRENCE_NOT_FOUND', 'Occurrence was never opened.', 404);
      }
      if (current.step !== 'end' && !steps.has(current.step)) {
        throw new AppError(
          'STEP_NOT_IN_TABLE',
          'The recorded step is not in the current table.',
          409,
          {
            step: current.step,
            birthVersion: current.ref.workflowVersion,
            currentVersion: runningVersion(),
          },
        );
      }
      if (!steps.has(command.from)) {
        throw new AppError('UNKNOWN_STEP', 'The origin step is not in the table.', 400);
      }
      if (command.to !== 'end' && !steps.has(command.to)) {
        throw new AppError('UNKNOWN_STEP', 'The destination step is not in the table.', 400);
      }
      if (!canReach(steps, command.from, command.to)) {
        throw new AppError('UNREACHABLE_STEP', 'The destination is not reachable from the origin.', 400);
      }
      return port.advance(ctx, key, {
        from: command.from,
        to: command.to,
        actorNow: command.actorNow,
        done: command.to === 'end',
        by: sessionBy(ctx),
        ...(command.note !== undefined ? { note: command.note } : {}),
      });
    },

    find(ctx, key) {
      return port.find(ctx, key);
    },
  };
}
