/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/workflowWake.ts" enhancement="_blank"/>
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { resolveClientProjectId } from '/_102034_/l1/server/layer_1_external/cbe/cbeDesenv.js';
import { readMessagesIntegration } from '/_102034_/l1/server/layer_1_external/config/messagesIntegration.js';
import { readProjectsConfig, type ProjectsConfig } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  parseWorkflowWakeEvent,
  WORKFLOW_WAKE_BODY_LIMIT_BYTES,
  type WorkflowWakeInbox,
  type WorkflowWakeScope,
} from '/_102034_/l1/workflow/wakeContracts.js';
import { createPostgresWorkflowWakeInbox } from '/_102034_/l1/workflow/wakeInboxPostgres.js';
import { resolveWorkflowWakeHandler } from '/_102034_/l1/workflow/wakeRegistry.js';
import type { WorkflowWakeHandler } from '/_102034_/l1/workflow/wakeContracts.js';
import type { ModuleWakeEvent, ModuleWakeReceipt } from '/_102036_/l2/shared/interfaces.js';

export interface WorkflowWakeRouteDeps {
  resolveAppId?: () => string;
  readIntegration?: (projectId: string) => { token: string };
  readConfig?: () => ProjectsConfig;
  resolveHandler?: (scope: WorkflowWakeScope) => Promise<WorkflowWakeHandler>;
  createInbox?: (projectId: string) => WorkflowWakeInbox;
}

interface WakeBody {
  value: unknown;
  byteLength: number;
}

interface HttpFailure {
  statusCode: number;
  code: string;
  message: string;
}

const JSON_TYPE = 'application/json; charset=utf-8';
const authorizedAppIds = new WeakMap<FastifyRequest, string>();

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function sameToken(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected));
}

function headerValues(request: FastifyRequest, name: string): string[] {
  const target = name.toLowerCase();
  const values: string[] = [];
  const raw = request.raw.rawHeaders;
  for (let index = 0; index < raw.length; index += 2) {
    if (raw[index]?.toLowerCase() === target) values.push(raw[index + 1] ?? '');
  }
  return values;
}

function failure(statusCode: number, code: string, message: string): HttpFailure {
  return { statusCode, code, message };
}

function sendJson(reply: FastifyReply, statusCode: number, body: unknown): unknown {
  reply.status(statusCode).type(JSON_TYPE).header('cache-control', 'no-store');
  return body;
}

function sendFailure(reply: FastifyReply, error: HttpFailure): unknown {
  return sendJson(reply, error.statusCode, {
    statusCode: error.statusCode,
    code: error.code,
    message: error.message,
  });
}

function bearerToken(value: string): string | null {
  const match = /^Bearer ([!-~]+)$/.exec(value);
  if (!match) return null;
  return match[1] ?? null;
}

function moduleConfigured(config: ProjectsConfig, projectId: string, moduleId: string): boolean {
  const project = config.projects[projectId];
  if (!project) return false;
  const listed = project.modules?.some((entry) => entry.moduleId === moduleId) ?? false;
  const persisted = project.persistenceModules?.some((entry) => entry.moduleId === moduleId && typeof entry.tableDefsDir === 'string' && entry.tableDefsDir.length > 0) ?? false;
  return listed && persisted;
}

function asAppError(error: unknown): AppError | null {
  return error instanceof AppError ? error : null;
}

function fromThrown(error: unknown): HttpFailure {
  const appError = asAppError(error);
  if (appError?.statusCode === 409) {
    return failure(409, 'WORKFLOW_WAKE_IDENTITY_CONFLICT', 'Wake event identity does not match the stored delivery.');
  }
  if (appError?.statusCode === 413) {
    return failure(413, 'WORKFLOW_WAKE_BODY_TOO_LARGE', 'wake body exceeds 32 KiB');
  }
  if (appError?.statusCode === 400) {
    return failure(400, appError.code || 'WORKFLOW_WAKE_EVENT_INVALID', appError.message);
  }
  if (appError?.statusCode === 403) {
    return failure(403, 'WORKFLOW_WAKE_SCOPE_FORBIDDEN', 'Workflow wake scope is not allowed for this application.');
  }
  return failure(503, 'WORKFLOW_WAKE_UNAVAILABLE', 'Workflow wake receiver is not ready.');
}

/**
 * Service route for one CM wake delivery. Production keeps a single lazy inbox
 * for the configured app and does not open a pool per request. The handler is
 * resolved and not called: 202 means the row was committed, not that the routine ran.
 */
export function registerWorkflowWakeRoutes(app: FastifyInstance, deps: WorkflowWakeRouteDeps = {}): void {
  const resolveAppId = deps.resolveAppId ?? resolveClientProjectId;
  const readIntegration = deps.readIntegration ?? readMessagesIntegration;
  const readConfig = deps.readConfig ?? readProjectsConfig;
  const resolveHandler = deps.resolveHandler ?? resolveWorkflowWakeHandler;
  const createInbox = deps.createInbox ?? ((projectId: string) => createPostgresWorkflowWakeInbox({ projectId }));
  let inbox: { projectId: string; store: WorkflowWakeInbox } | undefined;

  function storeFor(projectId: string): WorkflowWakeInbox {
    if (!inbox || inbox.projectId !== projectId) {
      inbox = { projectId, store: createInbox(projectId) };
    }
    return inbox.store;
  }

  app.register((scope, _opts, done) => {
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: WORKFLOW_WAKE_BODY_LIMIT_BYTES },
      (_request, raw, next) => {
        const buffer = raw as Buffer;
        if (buffer.byteLength > WORKFLOW_WAKE_BODY_LIMIT_BYTES) {
          next(new AppError('WORKFLOW_WAKE_BODY_TOO_LARGE', 'wake body exceeds 32 KiB', 413), undefined);
          return;
        }
        try {
          const value: unknown = JSON.parse(buffer.toString('utf8'));
          const body: WakeBody = { value, byteLength: buffer.byteLength };
          next(null, body);
        } catch {
          next(new AppError('WORKFLOW_WAKE_EVENT_INVALID', 'wake body must be an object', 400), undefined);
        }
      },
    );

    scope.setErrorHandler((error: unknown, _request, reply) => {
      const candidate = (typeof error === 'object' && error !== null ? error : {}) as { statusCode?: number; code?: string };
      const statusCode = typeof candidate.statusCode === 'number' ? candidate.statusCode : 500;
      if (statusCode === 413) {
        reply.send(sendFailure(reply, failure(413, 'WORKFLOW_WAKE_BODY_TOO_LARGE', 'wake body exceeds 32 KiB')));
        return;
      }
      if (error instanceof AppError) {
        reply.send(sendFailure(reply, fromThrown(error)));
        return;
      }
      const code = typeof candidate.code === 'string' ? candidate.code : '';
      if (statusCode === 400 || code.includes('JSON') || code.includes('CTP')) {
        reply.send(sendFailure(reply, failure(400, 'WORKFLOW_WAKE_EVENT_INVALID', 'wake body must be an object')));
        return;
      }
      reply.send(sendFailure(reply, failure(503, 'WORKFLOW_WAKE_UNAVAILABLE', 'Workflow wake receiver is not ready.')));
    });

    scope.addHook('onRequest', async (request, reply) => {
      const appHeaders = headerValues(request, 'x-app-id');
      const authorizations = headerValues(request, 'authorization');
      if (appHeaders.length !== 1 || authorizations.length !== 1) {
        reply.send(sendFailure(reply, failure(401, 'WORKFLOW_WAKE_AUTH_REQUIRED', 'Workflow wake authentication is required.')));
        return;
      }
      const appHeader = appHeaders[0] ?? '';
      const authorization = authorizations[0] ?? '';
      const token = bearerToken(authorization);
      if (appHeader.length === 0 || appHeader.includes(',') || token === null || authorization.includes(',')) {
        reply.send(sendFailure(reply, failure(401, 'WORKFLOW_WAKE_AUTH_REQUIRED', 'Workflow wake authentication is required.')));
        return;
      }
      let localAppId: string;
      try {
        localAppId = resolveAppId();
      } catch {
        reply.send(sendFailure(reply, failure(503, 'WORKFLOW_WAKE_UNAVAILABLE', 'Workflow wake receiver is not ready.')));
        return;
      }
      if (appHeader !== localAppId) {
        reply.send(sendFailure(reply, failure(403, 'WORKFLOW_WAKE_SCOPE_FORBIDDEN', 'Workflow wake scope is not allowed for this application.')));
        return;
      }
      let expected: string;
      try {
        expected = readIntegration(localAppId).token;
      } catch (error) {
        reply.send(sendFailure(reply, fromThrown(error)));
        return;
      }
      if (expected.length === 0 || !sameToken(token, expected)) {
        reply.send(sendFailure(reply, failure(403, 'WORKFLOW_WAKE_AUTH_FORBIDDEN', 'Workflow wake token was rejected.')));
        return;
      }
      authorizedAppIds.set(request, localAppId);
    });

    scope.post('/exec/workflow-event', async (request, reply) => {
      const projectId = authorizedAppIds.get(request);
      if (!projectId) {
        return sendFailure(reply, failure(401, 'WORKFLOW_WAKE_AUTH_REQUIRED', 'Workflow wake authentication is required.'));
      }
      const raw = request.body as WakeBody | undefined;
      if (!raw || typeof raw !== 'object' || !('value' in raw)) {
        return sendFailure(reply, failure(400, 'WORKFLOW_WAKE_EVENT_INVALID', 'wake body must be an object'));
      }
      let event: ModuleWakeEvent;
      try {
        event = parseWorkflowWakeEvent(raw.value, raw.byteLength);
      } catch (error) {
        return sendFailure(reply, fromThrown(error));
      }
      if (event.ref.project !== projectId) {
        return sendFailure(reply, failure(403, 'WORKFLOW_WAKE_SCOPE_FORBIDDEN', 'Workflow wake scope is not allowed for this application.'));
      }
      let config: ProjectsConfig;
      try {
        config = readConfig();
      } catch {
        return sendFailure(reply, failure(503, 'WORKFLOW_WAKE_UNAVAILABLE', 'Workflow wake receiver is not ready.'));
      }
      if (!moduleConfigured(config, projectId, event.ref.module)) {
        return sendFailure(reply, failure(403, 'WORKFLOW_WAKE_SCOPE_FORBIDDEN', 'Workflow wake scope is not allowed for this application.'));
      }
      const scopeKey: WorkflowWakeScope = {
        projectId,
        moduleId: event.ref.module,
        processId: event.ref.processId,
        routine: event.routine,
      };
      try {
        await resolveHandler(scopeKey);
      } catch (error) {
        return sendFailure(reply, fromThrown(error));
      }
      let stored: { receipt: ModuleWakeReceipt; statusCode: 200 | 202 };
      try {
        stored = await storeFor(projectId).enqueue(event);
      } catch (error) {
        return sendFailure(reply, fromThrown(error));
      }
      if (
        (stored.statusCode !== 200 && stored.statusCode !== 202)
        || stored.receipt.eventId !== event.eventId
        || (stored.receipt.outcome !== 'accepted' && stored.receipt.outcome !== 'stale')
      ) {
        return sendFailure(reply, failure(503, 'WORKFLOW_WAKE_UNAVAILABLE', 'Workflow wake receiver is not ready.'));
      }
      return sendJson(reply, stored.statusCode, {
        eventId: stored.receipt.eventId,
        outcome: stored.receipt.outcome,
      });
    });

    done();
  });
}
