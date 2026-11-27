/// <mls fileReference="_102034_/l1/workflow/moduleEngine.ts" enhancement="_blank"/>
/**
 * The shell of the process engine of a module, outside the module (it was the generated `engine.ts`). The module keeps only its
 * plans, declared `as const satisfies Record<string, WorkflowPlanInput>`, and one line that creates the engine. The step ids are
 * typed by the plan: a name that is not in it does not compile.
 */
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { getRunningRelease } from '/_102034_/l1/server/layer_1_external/cbe/cbeRelease.js';
import type { OccurrenceKey, TaskOccurrencePort, TaskOccurrenceSnapshot, TaskOccurrenceOpenResult, TaskOccurrenceAdvanceResult, WorkflowWakeRequest } from '/_102034_/l1/workflow/contracts.js';
import { createWorkflowEngine, ownerOf, type TaskWorkflowAdvance, type TaskWorkflowOpen } from '/_102034_/l1/workflow/engine.js';
import { createRuntimeMessagesTaskPort } from '/_102034_/l1/workflow/messagesRuntime.js';
import { createOccurrenceContext, occurrenceRecordId } from '/_102034_/l1/workflow/occurrenceRecordId.js';
import type { WorkflowPlanInput } from '/_102034_/l1/workflow/plan.js';

export type ModulePlans = Record<string, WorkflowPlanInput>;

/** The step ids of a process, from its plan (declared `as const satisfies`), plus 'end'. */
export type StepOf<P extends ModulePlans, K extends keyof P> = P[K]['steps'][number]['stepId'] | 'end';

export interface ModuleWorkflowEngine<P extends ModulePlans> {
  open<K extends keyof P & string>(
    ctx: RequestContext,
    input: Omit<TaskWorkflowOpen, 'plan' | 'firstStep'> & { processId: K; firstStep: StepOf<P, K> },
  ): Promise<TaskOccurrenceOpenResult>;
  advance<K extends keyof P & string>(
    ctx: RequestContext,
    key: OccurrenceKey & { processId: K },
    command: Omit<TaskWorkflowAdvance, 'from' | 'to'> & { from: StepOf<P, K>; to: StepOf<P, K> },
  ): Promise<TaskOccurrenceAdvanceResult>;
  find(ctx: RequestContext, key: OccurrenceKey): Promise<TaskOccurrenceSnapshot | null>;
}

/** The owner of the step entered decides what goes with the command: a person gets the notice; the clock keeps the wake the process asks for (absent stays absent). */
function withOwnerAction<T extends { message?: { content: string }; wake?: WorkflowWakeRequest }>(plan: WorkflowPlanInput, stepId: string, key: OccurrenceKey, command: T): T {
  const next = { ...command };
  if (stepId === 'end') {
    delete next.message;
    delete next.wake;
    return next;
  }
  const step = plan.steps.find((item) => item.stepId === stepId);
  if (!step) throw new AppError('WORKFLOW_INCOMPATIBLE', 'This release does not know the step.', 409, { task: key.recordId, step: stepId, release: getRunningRelease()?.id ?? null });
  const owner = ownerOf(step.kind);
  if (owner === 'person') {
    next.message = command.message ?? { content: step.title };
    delete next.wake;
  } else if (owner === 'clock') {
    delete next.message;
  } else if (owner === 'module') {
    delete next.message;
    delete next.wake;
  } else {
    throw new AppError('STEP_OWNER_NOT_SUPPORTED', 'This release has no owner action for the step.', 501, { task: key.recordId, step: stepId, owner });
  }
  return next;
}

/** The module engine over the Task port: the one of the cm by default, any other (the memory one) in tests. Every open carries the plan of this release; advance takes no table. */
export function createModuleWorkflowEngine<P extends ModulePlans>(
  plans: P,
  where: { projectId: string; moduleId: string; port?: TaskOccurrencePort },
): ModuleWorkflowEngine<P> {
  const engine = createWorkflowEngine(where.port ?? createRuntimeMessagesTaskPort({ projectId: where.projectId, moduleId: where.moduleId }));
  const planOf = (processId: string, recordId: string): WorkflowPlanInput => {
    const plan = (plans as Record<string, WorkflowPlanInput | undefined>)[processId];
    if (!plan) throw new AppError('WORKFLOW_INCOMPATIBLE', 'This release does not know the process.', 409, { task: recordId, release: getRunningRelease()?.id ?? null });
    return plan;
  };
  return {
    async open(ctx, input) {
      if (input.processId !== input.key.processId) {
        throw new AppError('WORKFLOW_INCOMPATIBLE', 'The process of the open does not match the key.', 409, { task: input.key.recordId });
      }
      const plan = planOf(input.key.processId, input.key.recordId);
      const { processId: _processId, ...rest } = input;
      return engine.open(ctx, withOwnerAction(plan, input.firstStep, input.key, { ...rest, plan }));
    },
    async advance(ctx, key, command) {
      return engine.advance(ctx, key, withOwnerAction(planOf(key.processId, key.recordId), command.to, key, command));
    },
    find(ctx, key) {
      return engine.find(ctx, key);
    },
  };
}

/** The key of the request in course: the one of the arrival or of the cm's request, then the request id. Never a seed the model wrote. */
function requestKeyOf(ctx: RequestContext): string | undefined {
  const fromConnection = ctx.requestMeta?.connection?.idempotencyKey;
  if (typeof fromConnection === 'string' && fromConnection !== '') return fromConnection;
  const requestId = ctx.requestMeta?.requestId;
  return typeof requestId === 'string' && requestId !== '' ? requestId : undefined;
}

/**
 * A process of ONE mechanical step. Opens the occurrence if it does not exist, runs `work` with the context that gives the first id
 * to the record of the occurrence, and moves the occurrence from `step` to the end if it is still there. It does not make a repeat
 * safe: the `once` around it does. The usual order is `serveCm` → `once` → `runOccurrence` → the rule of the module.
 */
export async function runOccurrence<P extends ModulePlans, K extends keyof P & string, T>(
  ctx: RequestContext,
  engine: ModuleWorkflowEngine<P>,
  occurrence: {
    processId: K;
    /** Only when the L4 names a business key; by default the key of the request in course (the same as `cm(ctx)`). */
    seed?: string;
    entity: string;
    title: string;
    step: StepOf<P, K>;
    executor: { kind: 'routine'; name: string };
    origin: TaskWorkflowOpen['origin'];
  },
  work: (occurrenceCtx: RequestContext, recordId: string) => Promise<T>,
): Promise<T> {
  const seed = occurrence.seed ?? requestKeyOf(ctx);
  if (seed === undefined) {
    throw new AppError('WORKFLOW_SEED_REQUIRED', 'runOccurrence has no key: the request has neither a connection key nor a request id, and no seed was given.', 500, { processId: occurrence.processId });
  }
  const recordId = occurrenceRecordId(ctx, occurrence.processId, seed);
  const key: OccurrenceKey & { processId: K } = {
    project: ctx.sessionContext.project.projectId,
    module: ctx.moduleId,
    processId: occurrence.processId,
    entity: occurrence.entity,
    recordId,
  };
  let found = await engine.find(ctx, key);
  if (!found) {
    await engine.open(ctx, {
      key,
      processId: occurrence.processId,
      title: occurrence.title,
      firstStep: occurrence.step,
      actorNow: null,
      owner: ctx.sessionContext.person?.mdmId ?? null,
      origin: occurrence.origin,
      executor: occurrence.executor,
      room: { mode: 'exclusive' },
    });
    found = await engine.find(ctx, key);
    if (!found) throw new AppError('WORKFLOW_OCCURRENCE_NOT_FOUND', 'The opened workflow occurrence could not be found.', 500);
  }
  const result = await work(createOccurrenceContext(ctx, recordId), recordId);
  const current = await engine.find(ctx, key);
  if (!current) throw new AppError('WORKFLOW_OCCURRENCE_NOT_FOUND', 'The workflow occurrence could not be found.', 500);
  if (!current.done && current.step === occurrence.step) {
    await engine.advance(ctx, key, {
      commandId: `${recordId}:end`,
      expectedRevision: current.revision,
      from: occurrence.step,
      to: 'end',
      actorNow: null,
      executor: occurrence.executor,
    });
  }
  return result;
}
