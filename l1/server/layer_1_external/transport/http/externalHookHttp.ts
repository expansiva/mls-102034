/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/externalHookHttp.ts" enhancement="_blank"/>
/**
 * POST /hook/<projectId>/<moduleId>/<systemId>/<operationId>
 * Outside login. The body is the raw bytes, capped at 1 MiB.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { getSharedPgPool } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import {
  forgetNotice,
  recordNoticeSeen,
  writeExternalCallPair,
  type ExternalCallDb,
} from '/_102034_/l1/server/layer_1_external/connections/external/externalCallStore.js';
import {
  allowExternalHookRate,
  EXTERNAL_HOOK_MAX_BYTES,
  EXTERNAL_HOOK_PATH,
  handleExternalHook,
  type ExternalHookDeps,
  type ExternalHookTarget,
} from '/_102034_/l1/server/layer_1_external/connections/external/externalHook.js';
import { readMessagesIntegration } from '/_102034_/l1/server/layer_1_external/config/messagesIntegration.js';
import { productionSecretOf, releaseDeclarationOf } from '/_102034_/l1/server/layer_1_external/connections/external/productionExternalSender.js';
import { sharedAssistantRunners } from '/_102034_/l1/workflow/assistantRuntime.js';

function headerMap(headers: FastifyRequest['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') out[name] = value;
    else if (Array.isArray(value) && typeof value[0] === 'string') out[name] = value[0];
  }
  return out;
}

const memorySeen = new Set<string>();

function postgresDb(): ExternalCallDb | null {
  const env = readAppEnv();
  if (env.runtimeMode !== 'postgres') return null;
  return { query: (sql, params) => getSharedPgPool(env).query(sql, params as never[]) };
}

function productionDeps(): ExternalHookDeps {
  const db = postgresDb();
  return {
    declarationOf: releaseDeclarationOf,
    secretOf: productionSecretOf,
    seen: async (notice) => {
      if (!db) {
        const key = `${notice.projectId}\0${notice.systemId}\0${notice.operationId}\0${notice.noticeId}`;
        if (memorySeen.has(key)) return false;
        memorySeen.add(key);
        return true;
      }
      return recordNoticeSeen(db, notice);
    },
    forget: async (notice) => {
      if (!db) {
        memorySeen.delete(`${notice.projectId}\0${notice.systemId}\0${notice.operationId}\0${notice.noticeId}`);
        return;
      }
      await forgetNotice(db, notice);
    },
    organizationOf: (projectId) => {
      try {
        return readMessagesIntegration(projectId).organizationId || undefined;
      } catch {
        return undefined;
      }
    },
    record: async (row) => {
      if (!db) return;
      await writeExternalCallPair(db, row);
    },
    deliver: (input, projectId) => sharedAssistantRunners(projectId).connection(input),
    now: () => new Date(),
    allow: allowExternalHookRate,
    log: (line) => console.warn(line),
  };
}

const PROXY_HOPS = /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|::1$|::ffff:127\.|fc|fd)/u;

/**
 * The caller's address for the rate limit. Behind our nginx, \`request.ip\` is the proxy, so every sender would share one
 * bucket. nginx appends the address it saw as the LAST entry of X-Forwarded-For (the earlier ones are what the caller
 * said, so they are not trusted); that last entry is used only when the connection itself comes from a local proxy.
 */
export function clientAddress(ip: string, forwarded: string | undefined): string {
  if (!forwarded || !PROXY_HOPS.test(ip)) return ip;
  const last = forwarded.split(',').map((part) => part.trim()).filter(Boolean).pop();
  return last && /^[0-9a-fA-F:.]+$/u.test(last) ? last : ip;
}

function send(reply: FastifyReply, status: number, body: { ok: boolean; message?: string }): void {
  reply.status(status).type('application/json; charset=utf-8').send(body);
}

export function registerExternalHookRoutes(app: FastifyInstance, deps: ExternalHookDeps = productionDeps()): void {
  app.register((scope, _options, done) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: EXTERNAL_HOOK_MAX_BYTES }, (_request, raw, next) => {
      next(null, raw);
    });
    scope.setErrorHandler((error, _request, reply) => {
      const status = typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number((error as { statusCode?: number }).statusCode)
        : 500;
      if (status === 413) {
        send(reply, 413, { ok: false, message: 'too large' });
        return;
      }
      console.warn(`[external] hook transport: ${error instanceof Error ? error.name : 'error'}`);
      send(reply, 503, { ok: false, message: 'unavailable' });
    });
    scope.post(EXTERNAL_HOOK_PATH, async (request, reply) => {
      const params = request.params as ExternalHookTarget;
      const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const result = await handleExternalHook({
        target: params,
        rawBody,
        headers: headerMap(request.headers),
        query: request.query as Record<string, unknown>,
        remoteAddress: clientAddress(request.ip ?? '', headerMap(request.headers)['x-forwarded-for']),
      }, deps);
      send(reply, result.status, result.body);
    });
    done();
  });
}
