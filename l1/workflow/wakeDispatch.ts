/// <mls fileReference="_102034_/l1/workflow/wakeDispatch.ts" enhancement="_blank"/>
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { readMessagesIntegration } from '/_102034_/l1/server/layer_1_external/config/messagesIntegration.js';
import { getSharedIdentityCache } from '/_102034_/l1/server/layer_1_external/cache/identityCache.js';
import { getSharedDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/runtimeFactory.js';
import { getResolvedOrganizationCompanyId } from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { ModuleWakeEvent } from '/_102036_/l2/shared/interfaces.js';
import type { TaskOccurrencePort, TaskOccurrenceSnapshot } from '/_102034_/l1/workflow/contracts.js';
import { createRuntimeMessagesTaskPort } from '/_102034_/l1/workflow/messagesRuntime.js';
import {
  workflowWakeCommandId,
  type WorkflowWakeDispatchResult,
  type WorkflowWakeHandler,
  type WorkflowWakeScope,
} from '/_102034_/l1/workflow/wakeContracts.js';
import { resolveWorkflowWakeHandler } from '/_102034_/l1/workflow/wakeRegistry.js';

const ERROR_CODE = /^WORKFLOW_WAKE_[A-Z0-9_]{1,48}$/;

export interface WorkflowWakeDispatcherDeps {
  /** Server test seam. Production builds a fresh routine context on every attempt. */
  createContext?: (event: ModuleWakeEvent) => RequestContext;
  /** Server test seam. Production uses the canonical task port, never the projection. */
  port?: TaskOccurrencePort;
  /** Server test seam. Production resolves the handler registered for the full scope. */
  resolve?: (scope: WorkflowWakeScope) => Promise<WorkflowWakeHandler>;
  /** Server test seam. Production reads the application integration. */
  readIntegration?: (projectId: string) => { organizationId: string };
  /** Server test seam. Production uses the company id reserved for this installation. */
  companyId?: () => string | undefined;
  /** Server test seam. Production uses the current clock for wake.until. */
  now?: () => Date;
}

export interface WorkflowWakeDispatcher {
  dispatch(event: ModuleWakeEvent): Promise<WorkflowWakeDispatchResult>;
}

export function createWorkflowWakeDispatcher(
  projectId: string,
  moduleId: string,
  deps: WorkflowWakeDispatcherDeps = {},
): WorkflowWakeDispatcher {
  let port = deps.port;

  function taskPort(): TaskOccurrencePort {
    port ??= createRuntimeMessagesTaskPort({ projectId, moduleId });
    return port;
  }

  return {
    async dispatch(event) {
      let ctx: RequestContext;
      try {
        ctx = routineContext(projectId, moduleId, event, deps);
      } catch (error) {
        return { retry: { code: sanitizedCode(error) } };
      }

      if (!sameConfiguredScope(projectId, moduleId, event)) {
        return { retry: { code: 'WORKFLOW_WAKE_PROTOCOL' } };
      }

      let snapshot: TaskOccurrenceSnapshot | null;
      try {
        snapshot = await taskPort().find(ctx, {
          project: event.ref.project,
          module: event.ref.module,
          processId: event.ref.processId,
          entity: event.ref.entity,
          recordId: event.ref.recordId,
        });
      } catch (error) {
        return { retry: { code: sanitizedCode(error) } };
      }

      if (snapshot === null) return 'stale';
      if (!sameTaskRef(event, snapshot)) {
        return { retry: { code: 'WORKFLOW_WAKE_PROTOCOL' } };
      }
      if (snapshot.revision < event.revision) {
        return { retry: { code: 'WORKFLOW_WAKE_PROTOCOL' } };
      }
      if (commandApplied(event, snapshot)) return 'accepted';
      if (terminal(snapshot) || stepPassSeqDiffers(event, snapshot) || wakeUnusable(event, snapshot, deps.now ?? (() => new Date()))) {
        return 'stale';
      }
      if (snapshot.status === 'paused') {
        return { retry: { code: 'WORKFLOW_WAKE_PAUSED' } };
      }
      if (snapshot.status !== 'in progress' || !planHasStep(snapshot)) {
        return { retry: { code: 'WORKFLOW_WAKE_NOT_CURRENT' } };
      }

      const resolve = deps.resolve ?? resolveWorkflowWakeHandler;
      let handler: WorkflowWakeHandler;
      try {
        handler = await resolve({
          projectId,
          moduleId,
          processId: event.ref.processId,
          routine: event.routine,
        });
      } catch (error) {
        return { retry: { code: sanitizedCode(error) } };
      }

      try {
        await handler(ctx, event, snapshot);
      } catch (error) {
        return { retry: { code: sanitizedCode(error) } };
      }
      return 'accepted';
    },
  };
}

function routineContext(
  projectId: string,
  moduleId: string,
  event: ModuleWakeEvent,
  deps: WorkflowWakeDispatcherDeps,
): RequestContext {
  const readIntegration = deps.readIntegration ?? readMessagesIntegration;
  const integration = readIntegration(projectId);
  if (typeof integration.organizationId !== 'string' || integration.organizationId.length === 0) {
    throw new AppError('WORKFLOW_WAKE_CANONICAL_UNAVAILABLE', 'Workflow wake organization is not configured.', 503);
  }

  const companyId = (deps.companyId ?? getResolvedOrganizationCompanyId)();
  const ctx = deps.createContext
    ? deps.createContext(event)
    : createRequestContext(getSharedDataRuntime(), {
      cache: getSharedIdentityCache(),
      moduleId,
      ...(companyId ? { sessionContext: { activeCompanyId: companyId } } : {}),
    });

  ctx.moduleId = moduleId;
  ctx.sessionContext.project = {
    ...ctx.sessionContext.project,
    projectId,
  };
  if (companyId) {
    ctx.sessionContext.activeCompanyId = companyId;
    ctx.sessionContext.businessContext = {
      ...ctx.sessionContext.businessContext,
      activeCompanyId: companyId,
    };
  }
  delete ctx.sessionContext.person;
  delete ctx.sessionContext.actorId;
  ctx.sessionContext.actorScope = [];
  ctx.sessionContext.actorSession = {
    ...ctx.sessionContext.actorSession,
    actorId: undefined,
    scope: [],
  };
  ctx.requestMeta = {
    source: 'message',
    requestId: event.eventId,
  };
  delete ctx.sandbox;
  return ctx;
}

function sameConfiguredScope(projectId: string, moduleId: string, event: ModuleWakeEvent): boolean {
  return event.ref.project === projectId && event.ref.module === moduleId;
}

function sameTaskRef(event: ModuleWakeEvent, snapshot: TaskOccurrenceSnapshot): boolean {
  const ref = snapshot.ref;
  return snapshot.taskId === event.taskId
    && ref.project === event.ref.project
    && ref.module === event.ref.module
    && ref.entity === event.ref.entity
    && ref.recordId === event.ref.recordId
    && ref.processId === event.ref.processId
    && ref.workflowVersion === event.ref.workflowVersion;
}

function commandApplied(event: ModuleWakeEvent, snapshot: TaskOccurrenceSnapshot): boolean {
  const commandId = workflowWakeCommandId(event.eventId);
  return snapshot.history.some((entry) => entry.commandId === commandId);
}

function terminal(snapshot: TaskOccurrenceSnapshot): boolean {
  return snapshot.done === true
    || snapshot.step === 'end'
    || snapshot.status === 'done'
    || snapshot.status === 'failed';
}

function stepPassSeqDiffers(event: ModuleWakeEvent, snapshot: TaskOccurrenceSnapshot): boolean {
  return snapshot.step !== event.stepKey
    || snapshot.pass !== event.pass
    || snapshot.wake?.seq !== event.seq;
}

function wakeUnusable(event: ModuleWakeEvent, snapshot: TaskOccurrenceSnapshot, now: () => Date): boolean {
  const wake = snapshot.wake;
  if (!wake || wake.routine !== event.routine) return true;
  if (wake.until === undefined) return false;
  const until = Date.parse(wake.until);
  if (Number.isNaN(until)) return true;
  return until <= now().getTime();
}

function planHasStep(snapshot: TaskOccurrenceSnapshot): boolean {
  return snapshot.plan.steps.some((step) => step.stepId === snapshot.step);
}

function sanitizedCode(error: unknown): string {
  if (!(error instanceof AppError)) return 'WORKFLOW_WAKE_HANDLER_FAILED';
  if (ERROR_CODE.test(error.code)) return error.code;
  if (
    error.statusCode === 403
    || error.statusCode === 503
    || error.code === 'WORKFLOW_CM_TASK_INCOMPLETE'
    || error.code === 'WORKFLOW_CM_BUSY'
    || error.code === 'MSG_APP_NOT_CONFIGURED'
  ) {
    return 'WORKFLOW_WAKE_CANONICAL_UNAVAILABLE';
  }
  if (error.code === 'WORKFLOW_CM_PROTOCOL_ERROR' || error.code === 'WORKFLOW_TASK_MISMATCH') {
    return 'WORKFLOW_WAKE_PROTOCOL';
  }
  return 'WORKFLOW_WAKE_HANDLER_FAILED';
}
