/// <mls fileReference="_102034_/l1/server/layer_2_controllers/execBff.ts" enhancement="_blank" />
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { readProjectsConfig } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { createUuidV7 } from '/_102029_/l2/uuidv7.js';
import { ConsoleLogger } from '/_102034_/l1/server/layer_1_external/observability/ConsoleLogger.js';
import {
  AppError,
  fail,
  type BffRequest,
  type BffResponse,
  type RequestContext,
  type RequestSessionContext,
} from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { loadModuleRouter, resolveRoutineResolution } from '/_102034_/l1/server/layer_2_controllers/moduleRegistry.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { getSharedDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/runtimeFactory.js';
import { createMdmFacade } from '/_102034_/l1/mdm/layer_3_usecases/mdmFacade.js';
import { MonitorExecutionEntity } from '/_102034_/l1/monitor/layer_4_entities/MonitorExecutionEntity.js';
import {
  getStatusGroup,
  parseRoutineParts,
  MonitorRuntimePostgres,
} from '/_102034_/l1/monitor/layer_1_external/data/postgres/MonitorRuntimePostgres.js';

function createClock() {
  return {
    nowIso: () => new Date().toISOString(),
  };
}

type SessionContextInput = Partial<RequestSessionContext> & {
  activeCompanyId?: string;
  activeUnitId?: string;
  actorId?: string;
  actorScope?: string[];
  workspaceId?: string;
};

export interface CreateRequestContextOptions {
  sessionContext?: SessionContextInput;
}

export function createRequestContext(
  dataRuntime = createMemoryDataRuntime(),
  options: CreateRequestContextOptions = {},
): RequestContext {
  const ctx = {
    data: dataRuntime,
    mdm: undefined as unknown as RequestContext['mdm'],
    log: new ConsoleLogger(),
    clock: createClock(),
    idGenerator: {
      newId: () => createUuidV7(),
    },
    sessionContext: createSessionContext(options.sessionContext),
    requestMeta: undefined,
  };
  ctx.mdm = createMdmFacade(ctx);
  return ctx;
}

export function createDefaultRequestContext(): RequestContext {
  return createRequestContext(getSharedDataRuntime());
}

function normalizeRequest(request: BffRequest): BffRequest {
  if (!request || typeof request !== 'object') {
    throw new AppError('INVALID_REQUEST', 'Request must be an object', 400);
  }

  if (!request.routine || typeof request.routine !== 'string') {
    throw new AppError('INVALID_REQUEST', 'routine is required', 400);
  }

  return {
    routine: request.routine,
    params: request.params ?? {},
    meta: {
      requestId: request.meta?.requestId ?? createUuidV7(),
      userId: request.meta?.userId,
      authToken: request.meta?.authToken,
      traceId: request.meta?.traceId ?? request.meta?.requestId ?? createUuidV7(),
      source: request.meta?.source ?? (readAppEnv().runtimeMode === 'memory' ? 'test' : 'http'),
      actorId: request.meta?.actorId,
      actorScope: request.meta?.actorScope,
      activeCompanyId: request.meta?.activeCompanyId,
      activeUnitId: request.meta?.activeUnitId,
      workspaceId: request.meta?.workspaceId,
    },
  };
}

export async function execBff(
  request: BffRequest,
  ctx = createDefaultRequestContext(),
): Promise<{ response: BffResponse; statusCode: number }> {
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  let normalizedRequest: BffRequest | null = null;
  let statusCode = 500;
  let response: BffResponse | null = null;
  let caughtErrorStack: string | null = null;
  let telemetryReceived = 0;

  try {
    normalizedRequest = normalizeRequest(request);
    const resolution = resolveRoutineResolution(normalizedRequest.routine);
    const router = await loadModuleRouter(resolution.registration);
    const handler = router.get(normalizedRequest.routine);
    if (!handler) {
      throw new AppError('ROUTINE_NOT_FOUND', 'Routine not found', 404, {
        routine: normalizedRequest.routine,
        moduleId: resolution.moduleId,
        projectId: resolution.registration.projectId,
      });
    }

    const handlerCtx: RequestContext = {
      ...ctx,
      sessionContext: createSessionContext({
        ...ctx.sessionContext,
        actorId: normalizedRequest.meta?.actorId ?? normalizedRequest.meta?.userId ?? ctx.sessionContext.actorId,
        actorScope: normalizedRequest.meta?.actorScope ?? ctx.sessionContext.actorScope,
        activeCompanyId: normalizedRequest.meta?.activeCompanyId ?? ctx.sessionContext.activeCompanyId,
        activeUnitId: normalizedRequest.meta?.activeUnitId ?? ctx.sessionContext.activeUnitId,
        workspaceId: normalizedRequest.meta?.workspaceId ?? ctx.sessionContext.workspaceId,
      }),
      requestMeta: {
        requestId: normalizedRequest.meta?.requestId,
        userId: normalizedRequest.meta?.userId,
        traceId: normalizedRequest.meta?.traceId,
        source: normalizedRequest.meta?.source,
      },
    };
    handlerCtx.mdm = createMdmFacade(handlerCtx);

    response = await handler({
      request: normalizedRequest,
      ctx: handlerCtx,
    });
    statusCode = 200;
    return {
      response,
      statusCode,
    };
  } catch (error) {
    caughtErrorStack = error instanceof Error ? (error.stack ?? null) : null;
    if (error instanceof AppError) {
      statusCode = error.statusCode;
      response = fail(error);
      return {
        response,
        statusCode,
      };
    }

    const unknownError = new AppError('INTERNAL_ERROR', 'Unexpected error', 500, {
      cause: error instanceof Error ? error.message : String(error),
    });
    statusCode = 500;
    response = fail(unknownError);
    return {
      response,
      statusCode,
    };
  } finally {
    const finishedAtIso = new Date().toISOString();
    const inferredRoutine = normalizedRequest?.routine ?? (
      typeof (request as { routine?: unknown } | null | undefined)?.routine === 'string'
        ? (request as { routine: string }).routine
        : 'unknown.unknown.unknown'
    );
    const parts = parseRoutineParts(inferredRoutine);
    const source =
      normalizedRequest?.meta?.source ??
      ((request as { meta?: { source?: unknown } } | null | undefined)?.meta?.source === 'http' ||
      (request as { meta?: { source?: unknown } } | null | undefined)?.meta?.source === 'message' ||
      (request as { meta?: { source?: unknown } } | null | undefined)?.meta?.source === 'test'
        ? ((request as { meta?: { source?: 'http' | 'message' | 'test' } }).meta?.source as 'http' | 'message' | 'test')
        : (readAppEnv().runtimeMode === 'memory' ? 'test' : 'http'));

    try {
      await MonitorExecutionEntity.record({
        requestId:
          normalizedRequest?.meta?.requestId ??
          (request as { meta?: { requestId?: string } } | null | undefined)?.meta?.requestId ??
          createUuidV7(),
        traceId:
          normalizedRequest?.meta?.traceId ??
          (request as { meta?: { traceId?: string; requestId?: string } } | null | undefined)?.meta?.traceId ??
          (request as { meta?: { requestId?: string } } | null | undefined)?.meta?.requestId ??
          createUuidV7(),
        userId:
          normalizedRequest?.meta?.userId ??
          (request as { meta?: { userId?: string } } | null | undefined)?.meta?.userId ??
          'anonymous',
        routine: inferredRoutine,
        module: parts.module,
        pageName: parts.pageName,
        command: parts.command,
        source,
        statusCode,
        statusGroup: getStatusGroup(statusCode),
        ok: response?.ok ?? false,
        durationMs: Math.max(0, Date.now() - startedAt),
        errorCode: response?.error?.code ?? null,
        errorStack: caughtErrorStack,
        startedAt: startedAtIso,
        finishedAt: finishedAtIso,
      });
    } catch (error) {
      ctx.log.error('Monitor execution recording failed', {
        cause: error instanceof Error ? error.message : String(error),
        routine: inferredRoutine,
      });
    }

    const rawTelemetry = normalizedRequest?.meta?.telemetry ??
      (request as { meta?: { telemetry?: unknown } } | null | undefined)?.meta?.telemetry;
    if (Array.isArray(rawTelemetry) && rawTelemetry.length > 0) {
      const TELEMETRY_LIMIT = 20;
      const receivedAt = finishedAtIso;
      const requestId =
        normalizedRequest?.meta?.requestId ??
        (request as { meta?: { requestId?: string } } | null | undefined)?.meta?.requestId ??
        createUuidV7();
      const traceId =
        normalizedRequest?.meta?.traceId ??
        (request as { meta?: { traceId?: string } } | null | undefined)?.meta?.traceId ??
        requestId;
      const userId =
        normalizedRequest?.meta?.userId ??
        (request as { meta?: { userId?: string } } | null | undefined)?.meta?.userId ??
        'anonymous';
      const validEvents = rawTelemetry
        .slice(0, TELEMETRY_LIMIT)
        .filter((e): e is { eventType: string; label: string; recordedAt: string; durationMs?: number | null; metadata?: Record<string, unknown> | null } =>
          e !== null && typeof e === 'object' &&
          typeof (e as Record<string, unknown>).eventType === 'string' &&
          typeof (e as Record<string, unknown>).recordedAt === 'string',
        )
        .map((e) => ({
          id: createUuidV7(),
          requestId,
          traceId,
          userId,
          module: parts.module,
          routine: inferredRoutine,
          eventType: e.eventType,
          label: typeof e.label === 'string' ? e.label : e.eventType,
          durationMs: typeof e.durationMs === 'number' ? e.durationMs : null,
          metadata: e.metadata ?? null,
          recordedAt: e.recordedAt,
          receivedAt,
        }));
      if (validEvents.length > 0) {
        try {
          const env = readAppEnv();
          await new MonitorRuntimePostgres(env).recordTelemetry(validEvents);
          telemetryReceived = validEvents.length;
        } catch (error) {
          ctx.log.error('Telemetry recording failed', {
            cause: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    if (response) {
      response.telemetryReceived = telemetryReceived;
    }
  }
}

export function createSessionContext(overrides: SessionContextInput = {}): RequestSessionContext {
  const env = readAppEnv();
  const runtime = readProjectRuntimeMetadata();
  const activeCompanyId = readString(overrides.activeCompanyId) ?? readString(overrides.businessContext?.activeCompanyId) ?? env.activeCompanyId;
  const activeUnitId = readString(overrides.activeUnitId) ?? readString(overrides.businessContext?.activeUnitId) ?? env.activeUnitId;
  const actorId = readString(overrides.actorId) ?? readString(overrides.actorSession?.actorId) ?? env.actorId;
  const actorScope = overrides.actorScope?.length ? overrides.actorScope : (overrides.actorSession?.scope?.length ? overrides.actorSession.scope : env.actorScope);
  const workspaceId = readString(overrides.workspaceId) ?? readString(overrides.currentWorkspace?.workspaceId) ?? env.currentWorkspaceId;
  const project = {
    projectId: readString(overrides.project?.projectId) ?? env.projectId ?? runtime.projectId,
    domain: readString(overrides.project?.domain) ?? env.projectDomain ?? runtime.domain,
    port: overrides.project?.port ?? env.port ?? runtime.port,
    databaseName: readString(overrides.project?.databaseName) ?? env.pgDatabase ?? runtime.databaseName,
    environment: readString(overrides.project?.environment) ?? env.appEnv ?? runtime.environment,
    studioEnabled: overrides.project?.studioEnabled ?? env.studioEnabled ?? runtime.studioEnabled,
  };

  return {
    activeCompanyId,
    activeUnitId,
    actorId,
    actorScope,
    workspaceId,
    businessContext: { activeCompanyId, activeUnitId },
    actorSession: { actorId, scope: actorScope },
    currentWorkspace: { workspaceId },
    project,
  };
}

function readProjectRuntimeMetadata(): RequestSessionContext['project'] {
  try {
    const config = readProjectsConfig();
    const project = config.projects[config.defaultProjectId];
    return {
      projectId: project?.runtime?.projectId ?? config.defaultProjectId,
      domain: project?.runtime?.domain,
      port: project?.runtime?.port,
      databaseName: project?.runtime?.databaseName,
      environment: project?.runtime?.environment,
      studioEnabled: project?.runtime?.studioEnabled,
    };
  } catch {
    return {};
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
