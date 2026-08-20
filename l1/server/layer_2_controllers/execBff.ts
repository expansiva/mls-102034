/// <mls fileReference="_102034_/l1/server/layer_2_controllers/execBff.ts" enhancement="_blank" />
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { readProjectMode, refuseTestWrite } from '/_102034_/l1/server/layer_1_external/config/projectMode.js';
import { isActorEnforcementOn } from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';
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
  sandbox?: boolean;
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
    sandbox: options.sandbox === true,
    requestMeta: undefined,
  };
  ctx.mdm = createMdmFacade(ctx);
  return ctx;
}

export function createDefaultRequestContext(): RequestContext {
  return createRequestContext(getSharedDataRuntime());
}

/**
 * Who the session belongs to, from the only sources that may decide it.
 *
 * `http` carries whatever the browser typed, so nothing it CLAIMS about identity is read: the transport
 * has already verified the collab-auth token (cookie `cauth`) and put the claims in `verifiedUserId` /
 * `verifiedEmail`, and those are the only identity fields of an http meta that mean anything. Before
 * this, `meta.actorId ?? meta.userId` became `sessionContext.actorId` and the generated controllers
 * authorize from there (`enforceActors`) — a request body granting itself permissions.
 *
 * `message` (collab-messages) and `test` (the monitor runner) are server-side callers and keep declaring
 * directly. Exported because it is the one line standing between a request body and the authorization
 * gate of every generated controller.
 */
export function trustedIdentityClaims(meta: BffRequest['meta']): BffRequest['meta'] | undefined {
  if (meta?.source !== 'http') return meta;
  // Verified claims only — never a fallback to what the client said (that is the hole with new clothes).
  return meta.verifiedUserId || meta.verifiedEmail
    ? {
      source: 'http',
      actorId: meta.verifiedUserId,
      userId: meta.verifiedEmail,
      // The authorities the transport filtered for THIS module. Absent while the issuer does not emit
      // them, which reads as "no authority" — today's behaviour.
      ...(meta.verifiedAuthorities?.length ? { actorScope: meta.verifiedAuthorities } : {}),
    }
    : undefined;
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
      verifiedUserId: request.meta?.verifiedUserId,
      verifiedEmail: request.meta?.verifiedEmail,
      verifiedAuthorities: request.meta?.verifiedAuthorities,
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
    // The SERVER half of the two defences on destructive test runs. The runner is supposed to keep its
    // create/update/delete suite for test modes; "supposed to" is what let one production run write junk,
    // so the target refuses it as well. A sandbox run never touches real data and is exempt.
    if (!ctx.sandbox) {
      const refusal = refuseTestWrite(readProjectMode(resolution.registration.projectId), {
        source: normalizedRequest.meta?.source,
        command: parseRoutineParts(normalizedRequest.routine).command,
      });
      if (refusal) throw new AppError('TEST_WRITE_REFUSED', refusal, 403, { routine: normalizedRequest.routine });
    }
    // DENY-BY-DEFAULT, behind its own flag. `enforceActors` in the generated controllers treats an empty
    // scope as permissive, which is why the actor gate is inert for real traffic. Flipping it centrally —
    // here, once — spares regenerating every module, and it stays off until the issuer actually emits
    // authorities: turning it on before that would lock every user out of every module.
    if (!ctx.sandbox && isActorEnforcementOn() && normalizedRequest.meta?.source === 'http') {
      const authorities = normalizedRequest.meta?.verifiedAuthorities ?? [];
      if (authorities.length === 0) {
        throw new AppError(
          'FORBIDDEN_ACTOR',
          `You have no authority in the module '${resolution.moduleId}': ask an administrator for access.`,
          403,
          { moduleId: resolution.moduleId, routine: normalizedRequest.routine },
        );
      }
    }
    const router = await loadModuleRouter(resolution.registration);
    const handler = router.get(normalizedRequest.routine);
    if (!handler) {
      throw new AppError('ROUTINE_NOT_FOUND', 'Routine not found', 404, {
        routine: normalizedRequest.routine,
        moduleId: resolution.moduleId,
        projectId: resolution.registration.projectId,
      });
    }

    // IDENTITY IS NEVER TAKEN FROM AN UNTRUSTED CALLER.
    //
    // These fields used to be promoted from `request.meta` for every source, and the generated
    // controllers decide authorization from one of them: `enforceActors` reads
    // `ctx.sessionContext.actorScope`. Over HTTP that meant any caller could POST
    // `meta: {actorId, actorScope: [...]}` and grant itself an actor — the request body deciding its own
    // permissions — the audit that found it is what this guard answers to.
    //
    // `http` is the untrusted transport: whatever it claims about WHO it is, is discarded, and the
    // session stays whatever the server itself resolved (ctx). `message`/`test` are server-side callers
    // (the collab-messages transport, the monitor test runner) and keep the promotion — the test runner
    // does not even use it, it injects the identity through `createRequestContext({sessionContext})`,
    // which is the only channel this change trusts. `source` itself is not forgeable here: the HTTP
    // transport stamps it AFTER spreading the client meta (startServer.ts).
    //
    // This does NOT make the route authenticated — nothing on it validates a token today. It stops the
    // caller from ESCALATING; choosing how the runtime authenticates is a platform decision.
    const claimedIdentity = trustedIdentityClaims(normalizedRequest.meta);
    const handlerCtx: RequestContext = {
      ...ctx,
      sessionContext: createSessionContext({
        ...ctx.sessionContext,
        actorId: claimedIdentity?.actorId ?? claimedIdentity?.userId ?? ctx.sessionContext.actorId,
        actorScope: claimedIdentity?.actorScope ?? ctx.sessionContext.actorScope,
        activeCompanyId: claimedIdentity?.activeCompanyId ?? ctx.sessionContext.activeCompanyId,
        activeUnitId: claimedIdentity?.activeUnitId ?? ctx.sessionContext.activeUnitId,
        // `workspaceId` stays client-supplied on purpose: it is not WHO the caller is, it is WHICH screen
        // it is on — navigation context only the page knows, and nothing authorizes by it.
        workspaceId: normalizedRequest.meta?.workspaceId ?? ctx.sessionContext.workspaceId,
      }),
      requestMeta: {
        requestId: normalizedRequest.meta?.requestId,
        // TELEMETRY ONLY — never an authorization input. The SERVER wins when the transport verified a
        // token: the trail then shows the email of the real user even from a stale client. With no token
        // (enforcement off, stage 1) it keeps what the client sent, which is the email of the session
        // cookie in practice.
        userId: normalizedRequest.meta?.verifiedEmail || normalizedRequest.meta?.userId,
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

    // Sandbox runs (test runner on a disposable runtime) are not production traffic:
    // they are kept out of the execution log, the series store and the telemetry.
    if (!ctx.sandbox) {
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
    }

    const rawTelemetry = normalizedRequest?.meta?.telemetry ??
      (request as { meta?: { telemetry?: unknown } } | null | undefined)?.meta?.telemetry;
    if (!ctx.sandbox && Array.isArray(rawTelemetry) && rawTelemetry.length > 0) {
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
