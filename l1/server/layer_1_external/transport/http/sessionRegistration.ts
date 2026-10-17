/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/sessionRegistration.ts" enhancement="_blank" />
import type { FastifyInstance } from 'fastify';
import type { ProjectOnboardingConfig } from '/_102029_/l2/runtimeConfigTypes.js';
import { resolveBffSession, type BffAuthOutcome } from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';
import { isAlphaAllAuthorities } from '/_102034_/l1/server/layer_1_external/config/alphaAuthorities.js';
import {
  readOnboardingConfig,
  resolveOrganizationBinding,
  type OrganizationBinding,
} from '/_102034_/l1/server/layer_1_external/config/onboardingConfig.js';
import { readProjectsConfig } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { AppError, fail, ok, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createDefaultRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { RegistrationActor } from '/_102034_/l1/mdm/layer_3_usecases/registrationContracts.js';
import {
  listOrganizationAccessRequests,
  readOwnAccessRequest,
  resolveAccessRequest,
} from '/_102034_/l1/mdm/layer_3_usecases/registrationRequests.js';
import { ensureSelfRegistration } from '/_102034_/l1/mdm/layer_3_usecases/selfRegistration.js';

const RESOLVE_FIELDS = new Set(['requestId', 'expectedVersion', 'decision', 'candidateId']);
const REJECTED_FIELDS = ['email', 'mdmId', 'name', 'organizationKey'];

export interface SessionRegistrationScope {
  binding: OrganizationBinding;
  config: ProjectOnboardingConfig;
}

export type SessionRegistrationKind = 'register' | 'read-own' | 'list' | 'resolve';

export interface SessionRegistrationCommand {
  kind: SessionRegistrationKind;
  body?: unknown;
  requestId?: string;
  alphaFollowUp: boolean;
  loadScope: () => SessionRegistrationScope;
}

export interface SessionRegistrationHttpResult {
  statusCode: number;
  body: ReturnType<typeof ok> | ReturnType<typeof fail>;
}

function unauthenticated(): SessionRegistrationHttpResult {
  return {
    statusCode: 401,
    body: fail(new AppError('UNAUTHENTICATED', 'Sign in before using registration.', 401)),
  };
}

function actorFromSession(session: BffAuthOutcome): RegistrationActor | null {
  const claims = session.claims;
  if (!claims || typeof claims.email !== 'string' || claims.email.trim().length === 0) return null;
  return {
    email: claims.email,
    name: typeof claims.name === 'string' ? claims.name : '',
  };
}

function httpError(error: unknown): SessionRegistrationHttpResult {
  if (error instanceof AppError) {
    return { statusCode: error.statusCode, body: fail(error) };
  }
  const message = error instanceof Error ? error.message : 'registration failed';
  return {
    statusCode: 500,
    body: fail(new AppError('INTERNAL_ERROR', message, 500)),
  };
}

function recordFields(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) record[key] = value;
  return record;
}

function rejectResolveBody(body: Record<string, unknown>): AppError | null {
  for (const field of REJECTED_FIELDS) {
    if (field in body) {
      return new AppError('VALIDATION_ERROR', `resolve rejects ${field}`, 400, { field });
    }
  }
  for (const field of Object.keys(body)) {
    if (!RESOLVE_FIELDS.has(field)) {
      return new AppError('VALIDATION_ERROR', `resolve rejects ${field}`, 400, { field });
    }
  }
  if (typeof body.requestId !== 'string' || body.requestId.length === 0) {
    return new AppError('VALIDATION_ERROR', 'requestId is required', 400, { field: 'requestId' });
  }
  if (typeof body.expectedVersion !== 'number') {
    return new AppError('VALIDATION_ERROR', 'expectedVersion is required', 400, { field: 'expectedVersion' });
  }
  if (body.decision !== 'use-existing' && body.decision !== 'create-new') {
    return new AppError('VALIDATION_ERROR', 'decision is invalid', 400, { field: 'decision' });
  }
  if (body.candidateId !== undefined && typeof body.candidateId !== 'string') {
    return new AppError('VALIDATION_ERROR', 'candidateId must be a string', 400, { field: 'candidateId' });
  }
  return null;
}

function resolveInput(body: Record<string, unknown>): {
  requestId: string;
  expectedVersion: number;
  decision: 'use-existing' | 'create-new';
  candidateId?: string;
} {
  const requestId = body.requestId;
  const expectedVersion = body.expectedVersion;
  const decision = body.decision;
  if (typeof requestId !== 'string' || typeof expectedVersion !== 'number') {
    return { requestId: '', expectedVersion: 0, decision: 'use-existing' };
  }
  if (decision !== 'use-existing' && decision !== 'create-new') {
    return { requestId, expectedVersion, decision: 'use-existing' };
  }
  const input: {
    requestId: string;
    expectedVersion: number;
    decision: 'use-existing' | 'create-new';
    candidateId?: string;
  } = { requestId, expectedVersion, decision };
  if (typeof body.candidateId === 'string') input.candidateId = body.candidateId;
  return input;
}

/**
 * Platform registration ports. Identity comes from the resolved session, never from the body.
 * List and resolve stay closed unless the alpha switch is already on.
 */
export async function handleSessionRegistration(
  ctx: RequestContext,
  session: BffAuthOutcome,
  command: SessionRegistrationCommand,
): Promise<SessionRegistrationHttpResult> {
  try {
    const actor = actorFromSession(session);
    if (!actor) return unauthenticated();
    const followUp = command.kind === 'list' || command.kind === 'resolve';
    if (followUp && !command.alphaFollowUp) {
      return {
        statusCode: 404,
        body: fail(new AppError('NOT_AVAILABLE', 'access-request follow-up is not available', 404)),
      };
    }
    const scope = command.loadScope();
    if (command.kind === 'register') {
      const data = await ensureSelfRegistration(ctx, scope.binding, scope.config, actor);
      return { statusCode: 200, body: ok(data) };
    }
    if (command.kind === 'read-own') {
      if (!command.requestId) {
        return {
          statusCode: 400,
          body: fail(new AppError('VALIDATION_ERROR', 'id is required', 400, { field: 'id' })),
        };
      }
      const data = await readOwnAccessRequest(ctx, {
        requestId: command.requestId,
        organizationKey: scope.binding.key,
        email: actor.email,
      });
      return { statusCode: 200, body: ok(data) };
    }
    if (command.kind === 'list') {
      const data = await listOrganizationAccessRequests(ctx, scope.binding.key);
      return { statusCode: 200, body: ok(data) };
    }
    const record = recordFields(command.body);
    if (!record) {
      return {
        statusCode: 400,
        body: fail(new AppError('VALIDATION_ERROR', 'resolve payload must be an object', 400, { field: 'body' })),
      };
    }
    const rejected = rejectResolveBody(record);
    if (rejected) return { statusCode: rejected.statusCode, body: fail(rejected) };
    const data = await resolveAccessRequest(ctx, scope.binding, scope.config, actor, resolveInput(record));
    return { statusCode: 200, body: ok(data) };
  } catch (error) {
    return httpError(error);
  }
}

export function loadRegistrationScope(): SessionRegistrationScope {
  const projects = readProjectsConfig();
  const config = readOnboardingConfig(projects);
  const binding = config ? resolveOrganizationBinding(projects) : null;
  if (!config || !binding) {
    throw new AppError('NOT_AVAILABLE', 'onboarding is not enabled', 404);
  }
  return { binding, config };
}

function queryId(query: unknown): string {
  if (typeof query !== 'object' || query === null || !('id' in query)) return '';
  const id = query.id;
  return typeof id === 'string' ? id : '';
}

export function registerSessionRegistrationRoutes(
  app: FastifyInstance,
  options: {
    refreshedAuthCookie: (token: string) => string;
    createContext?: () => RequestContext;
    alphaFollowUp?: () => boolean;
    loadScope?: () => SessionRegistrationScope;
  },
): void {
  const createContext = options.createContext ?? createDefaultRequestContext;
  const alphaFollowUp = options.alphaFollowUp ?? (() => isAlphaAllAuthorities());
  const loadScope = options.loadScope ?? loadRegistrationScope;

  const answer = async (
    kind: SessionRegistrationKind,
    request: { headers: Record<string, string | string[] | undefined>; body?: unknown; query?: unknown },
    reply: { header: (name: string, value: string) => void; status: (code: number) => void },
  ) => {
    const session = await resolveBffSession(request.headers);
    reply.header('cache-control', 'no-store');
    if (session.newAccessToken) reply.header('set-cookie', options.refreshedAuthCookie(session.newAccessToken));
    const result = await handleSessionRegistration(createContext(), session, {
      kind,
      body: request.body,
      requestId: kind === 'read-own' ? queryId(request.query) : undefined,
      alphaFollowUp: alphaFollowUp(),
      loadScope,
    });
    reply.status(result.statusCode);
    return result.body;
  };

  app.post('/session/register', async (request, reply) => answer('register', request, reply));
  app.get('/session/registration/request', async (request, reply) => answer('read-own', request, reply));
  app.get('/session/registration/requests', async (request, reply) => answer('list', request, reply));
  app.post('/session/registration/resolve', async (request, reply) => answer('resolve', request, reply));
}
