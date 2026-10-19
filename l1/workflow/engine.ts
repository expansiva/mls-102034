/// <mls fileReference="_102034_/l1/workflow/engine.ts" enhancement="_blank"/>
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { IClock, ILogger } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { getRunningRelease } from '/_102034_/l1/server/layer_1_external/cbe/cbeRelease.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type {
  AdvanceOccurrenceResult,
  OccurrenceKey,
  OccurrencePort,
  OccurrenceSnapshot,
  OpenOccurrenceResult,
  TaskOccurrenceAdvanceCommand,
  TaskOccurrenceAdvanceResult,
  TaskOccurrenceMessageStatus,
  TaskOccurrenceOpenResult,
  TaskOccurrencePort,
  TaskOccurrenceSnapshot,
  WorkflowExecutor,
  WorkflowOrigin,
  WorkflowRoomChoice,
  WorkflowStepDef,
  WorkflowTable,
  WorkflowWakeRequest,
} from '/_102034_/l1/workflow/contracts.js';
import { indexWorkflowTable, prepareWorkflowPlan, type WorkflowPlanInput } from '/_102034_/l1/workflow/plan.js';

export { ownerOf } from '/_102034_/l1/workflow/plan.js';
export type { StepOwner } from '/_102034_/l1/workflow/plan.js';

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

/** Open input for a task occurrence. The title is the occurrence title, not a plan title. */
export interface TaskWorkflowOpen {
  key: OccurrenceKey;
  plan: WorkflowPlanInput;
  title: string;
  firstStep: string;
  actorNow: string | null;
  owner: string;
  origin: WorkflowOrigin;
  executor: WorkflowExecutor;
  room: WorkflowRoomChoice;
  message?: { content: string };
}

/** Advance input. `to: 'end'` is the logical close. The caller supplies commandId and expectedRevision. */
export interface TaskWorkflowAdvance {
  commandId: string;
  expectedRevision: number;
  from: string;
  to: string;
  actorNow: string | null;
  executor: WorkflowExecutor;
  note?: string;
  wake?: WorkflowWakeRequest;
  message?: { content: string };
}

export interface TaskWorkflowEngine {
  open(ctx: RequestContext, input: TaskWorkflowOpen): Promise<TaskOccurrenceOpenResult>;
  advance(
    ctx: RequestContext,
    key: OccurrenceKey,
    command: TaskWorkflowAdvance,
  ): Promise<TaskOccurrenceAdvanceResult>;
  find(ctx: RequestContext, key: OccurrenceKey): Promise<TaskOccurrenceSnapshot | null>;
}

function sessionBy(ctx: WorkflowEngineContext): string | null {
  return ctx.sessionContext?.person?.mdmId ?? null;
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

function isTaskOccurrencePort(port: TaskOccurrencePort | OccurrencePort): port is TaskOccurrencePort {
  return (port as { kind?: string }).kind === 'task';
}

function openingMessage(snapshot: TaskOccurrenceSnapshot): TaskOccurrenceMessageStatus | undefined {
  return snapshot.history.find((entry) => entry.from === null)?.message;
}

function requireOccurrenceTitle(title: string): void {
  if (typeof title !== 'string' || title.trim() === '') {
    throw new AppError('INVALID_COMMAND', 'Occurrence title must be a non-empty string.', 400);
  }
}

function requireAdvanceIdentity(command: TaskWorkflowAdvance): void {
  if (typeof command.commandId !== 'string' || command.commandId === '') {
    throw new AppError('INVALID_COMMAND', 'commandId must be a non-empty string.', 400);
  }
  if (!Number.isInteger(command.expectedRevision) || command.expectedRevision <= 0) {
    throw new AppError('INVALID_COMMAND', 'expectedRevision must be a positive integer.', 400);
  }
}

function createTaskWorkflowEngine(port: TaskOccurrencePort): TaskWorkflowEngine {
  return {
    async open(ctx, input) {
      const current = await port.find(ctx, input.key);
      if (current) {
        const moduleMessage = openingMessage(current);
        return {
          outcome: 'existing',
          occurrence: current,
          ...(moduleMessage === undefined ? {} : { moduleMessage }),
        };
      }
      requireOccurrenceTitle(input.title);
      const plan = prepareWorkflowPlan(input.plan);
      const steps = indexWorkflowTable(plan, input.key.processId);
      if (!steps.has(input.firstStep)) {
        throw new AppError('UNKNOWN_STEP', 'The first step is not in the table.', 400);
      }
      const workflowVersion = runningVersion();
      if (workflowVersion === null) {
        ctx.log.info('WORKFLOW_VERSION_UNKNOWN', {
          project: input.key.project,
          module: input.key.module,
          processId: input.key.processId,
          entity: input.key.entity,
          recordId: input.key.recordId,
        });
      }
      return port.open(ctx, {
        ref: { ...input.key, workflowVersion },
        plan,
        title: input.title,
        firstStep: input.firstStep,
        actorNow: input.actorNow,
        owner: input.owner,
        origin: input.origin,
        executor: input.executor,
        room: input.room,
        ...(input.message === undefined ? {} : { message: input.message }),
      });
    },

    async advance(ctx, key, command) {
      const current = await port.find(ctx, key);
      if (!current) {
        throw new AppError('OCCURRENCE_NOT_FOUND', 'Occurrence was never opened.', 404);
      }
      requireAdvanceIdentity(command);
      const seen = current.history.some((entry) => entry.commandId === command.commandId);
      if (!seen && current.status !== 'paused') {
        const steps = indexWorkflowTable(current.plan, key.processId);
        if (!steps.has(command.from)) {
          throw new AppError('UNKNOWN_STEP', 'The origin step is not in the table.', 400);
        }
        if (command.to !== 'end' && !steps.has(command.to)) {
          throw new AppError('UNKNOWN_STEP', 'The destination step is not in the table.', 400);
        }
        if (!canReach(steps, command.from, command.to)) {
          throw new AppError('UNREACHABLE_STEP', 'The destination is not reachable from the origin.', 400);
        }
      }
      const canonical: TaskOccurrenceAdvanceCommand = {
        taskId: current.taskId,
        commandId: command.commandId,
        expectedRevision: command.expectedRevision,
        from: command.from,
        to: command.to === 'end' ? command.from : command.to,
        actorNow: command.actorNow,
        done: command.to === 'end',
        executor: command.executor,
      };
      if (command.note !== undefined) canonical.note = command.note;
      if (command.wake !== undefined) canonical.wake = command.wake;
      if (command.message !== undefined) canonical.message = command.message;
      return port.advance(ctx, key, canonical);
    },

    find(ctx, key) {
      return port.find(ctx, key);
    },
  };
}

function createLegacyWorkflowEngine(port: OccurrencePort): WorkflowEngine {
  return {
    async open(ctx, table, key, firstStep, actorNow) {
      const steps = indexWorkflowTable(table, key.processId);
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
      const steps = indexWorkflowTable(table, key.processId);
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

export function createWorkflowEngine(port: TaskOccurrencePort): TaskWorkflowEngine;
export function createWorkflowEngine(port: OccurrencePort): WorkflowEngine;
export function createWorkflowEngine(
  port: TaskOccurrencePort | OccurrencePort,
): TaskWorkflowEngine | WorkflowEngine {
  if (isTaskOccurrencePort(port)) return createTaskWorkflowEngine(port);
  return createLegacyWorkflowEngine(port);
}
