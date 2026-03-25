/// <mls fileReference="_102034_/l1/server/layer_2_controllers/execBff.ts" enhancement="_blank" />
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { createUuidV7 } from '/_102029_/l2/uuidv7.js';
import { ConsoleLogger } from '/_102034_/l1/server/layer_1_external/observability/ConsoleLogger.js';
import {
  AppError,
  fail,
  type BffRequest,
  type BffResponse,
  type RequestContext,
} from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { loadModuleRouter, resolveRoutineResolution } from '/_102034_/l1/server/layer_2_controllers/moduleRegistry.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { getSharedDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/runtimeFactory.js';
import { MonitorExecutionEntity } from '/_102034_/l1/monitor/layer_4_entities/MonitorExecutionEntity.js';
import {
  getStatusGroup,
  parseRoutineParts,
} from '/_102034_/l1/monitor/layer_1_external/data/postgres/MonitorRuntimePostgres.js';

function createClock() {
  return {
    nowIso: () => new Date().toISOString(),
  };
}

export function createRequestContext(
  dataRuntime = createMemoryDataRuntime(),
): RequestContext {
  return {
    data: dataRuntime,
    log: new ConsoleLogger(),
    clock: createClock(),
    idGenerator: {
      newId: () => createUuidV7(),
    },
    requestMeta: undefined,
  };
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

    response = await handler({
      request: normalizedRequest,
      ctx: {
        ...ctx,
        requestMeta: {
          requestId: normalizedRequest.meta?.requestId,
          userId: normalizedRequest.meta?.userId,
          traceId: normalizedRequest.meta?.traceId,
          source: normalizedRequest.meta?.source,
        },
      },
    });
    statusCode = 200;
    return {
      response,
      statusCode,
    };
  } catch (error) {
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
        startedAt: startedAtIso,
        finishedAt: finishedAtIso,
      });
    } catch (error) {
      ctx.log.error('Monitor execution recording failed', {
        cause: error instanceof Error ? error.message : String(error),
        routine: inferredRoutine,
      });
    }
  }
}
