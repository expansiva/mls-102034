/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/msgProxy.ts" enhancement="_blank" />
// Same-origin reverse proxy for the collab-messages backend (the "msg" pm2
// app, default port 8180). The frontend (messagesAside via environmentContract)
// calls `${origin}/msg...`; keeping it same-origin lets the session cookies
// (cauth/crefresh/loginMsg) flow without any CORS/cross-site handling. On a
// production VM an nginx location can take this over; the in-process proxy
// keeps every VM (Lima included) working with zero external config.
//
// MSG_PROXY_TARGET overrides the upstream (default http://127.0.0.1:8180);
// MSG_PROXY_ENABLED=false disables the route entirely.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { resolveBffSession } from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';
import { localTestCookieName } from '/_102034_/l1/server/layer_1_external/auth/localTestSession.js';
import {
  assertLocalTestProxyTarget,
  getLocalTestConfig,
  LocalTestConfigError,
  lookupLocalTestPersona,
  type LocalTestConfigState,
} from '/_102034_/l1/server/layer_1_external/config/localTestConfig.js';
import { ensureEnvFileLoaded } from '/_102034_/l1/server/layer_1_external/config/env.js';

const DEFAULT_TARGET = 'http://127.0.0.1:8180';

const SERVICE_IDENTITY_ERROR = 'MSG_PROXY_TOKEN is set but MSG_PROXY_USER_ID is empty — service identity not injected';

export type ServiceIdentityHeaders =
  | { inject: null }
  | { inject: { authorization: string; 'x-user-id': string; 'x-org-id'?: string } }
  | { error: string };

export function serviceIdentityHeaders(env: NodeJS.ProcessEnv): ServiceIdentityHeaders {
  const token = (env.MSG_PROXY_TOKEN ?? '').trim();
  if (!token) return { inject: null };

  const userId = (env.MSG_PROXY_USER_ID ?? '').trim();
  if (!userId) return { error: SERVICE_IDENTITY_ERROR };

  const inject: { authorization: string; 'x-user-id': string; 'x-org-id'?: string } = {
    authorization: `Bearer ${token}`,
    'x-user-id': userId,
  };
  const orgId = (env.MSG_PROXY_ORG_ID ?? '').trim();
  if (orgId) inject['x-org-id'] = orgId;
  return { inject };
}

export function msgProxyStartupLog(target: string, identity: ServiceIdentityHeaders): string {
  const line = `[msgProxy] /msg + /whoami -> ${target} (MSG_PROXY_TARGET to override, MSG_PROXY_ENABLED=false to disable)`;
  if ('inject' in identity && identity.inject) {
    return `${line} service identity ${identity.inject['x-user-id']}`;
  }
  return line;
}

let serviceHeaders: Record<string, string> | null = null;

let loadBench: () => LocalTestConfigState = () => getLocalTestConfig();

/** Tests substitute the manifest reader. Production uses the process cache. */
export function setLocalTestProxyConfigLoaderForTests(loader?: () => LocalTestConfigState): void {
  loadBench = loader ?? (() => getLocalTestConfig());
}

// Hop-by-hop headers must not be forwarded in either direction.
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

export function msgProxyTarget(env: NodeJS.ProcessEnv = process.env): string {
  return (env.MSG_PROXY_TARGET ?? DEFAULT_TARGET).replace(/\/+$/u, '');
}

function benchFailureMessage(error: unknown, fallback: string): string {
  return error instanceof LocalTestConfigError ? error.message : fallback;
}

/** Absent or empty body.userId is the getUserUpdate boot. Any other value must be the selected CMid. */
function bodyUserIdMatches(body: unknown, cmUserId: string): boolean {
  if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) return true;
  if (!Object.prototype.hasOwnProperty.call(body, 'userId')) return true;
  const userId = (body as { userId?: unknown }).userId;
  if (userId === undefined || userId === null || userId === '') return true;
  return typeof userId === 'string' && userId === cmUserId;
}

function stripLocalTestCookie(cookie: string, projectId: string): string {
  const name = `${localTestCookieName(projectId)}=`;
  return cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith(name))
    .join('; ');
}

type BenchForward =
  | { kind: 'legacy' }
  | { kind: 'stop'; status: number; msg: string }
  | { kind: 'inject'; headers: { authorization: string; 'x-user-id': string; 'x-org-id'?: string }; projectId: string };

/**
 * Active bench: one selected persona per request. A disabled bench keeps the
 * process-wide service headers. Failure never falls through to the dev user.
 */
async function benchForward(request: FastifyRequest): Promise<BenchForward> {
  let state: LocalTestConfigState;
  try {
    state = loadBench();
  } catch (error) {
    const msg = benchFailureMessage(error, 'local test session manifest is invalid');
    console.warn(`[msgProxy] ${msg}`);
    return { kind: 'stop', status: 503, msg };
  }
  if (!state.enabled) return { kind: 'legacy' };

  try {
    assertLocalTestProxyTarget(msgProxyTarget(), state);
  } catch (error) {
    const msg = benchFailureMessage(error, 'local test session proxy target is refused');
    console.warn(`[msgProxy] ${msg}`);
    return { kind: 'stop', status: 503, msg };
  }

  const outcome = await resolveBffSession(request.headers);
  const sub = outcome.claims?.sub;
  const email = outcome.claims?.email;
  const org = outcome.claims?.active_org;
  const orgId = org && typeof org === 'object' && typeof org.id === 'string' ? org.id : '';
  const persona = outcome.source === 'local-test' && typeof sub === 'string' && typeof email === 'string'
    ? lookupLocalTestPersona({ sub, email }, state)
    : null;
  if (!persona || orgId !== state.cmOrgId) {
    return { kind: 'stop', status: 401, msg: 'local test session required' };
  }
  if (!bodyUserIdMatches(request.body, persona.cmUserId)) {
    return { kind: 'stop', status: 403, msg: 'userId does not match the selected local test session' };
  }

  const identity = serviceIdentityHeaders({
    MSG_PROXY_TOKEN: process.env.MSG_PROXY_TOKEN,
    MSG_PROXY_USER_ID: persona.cmUserId,
    MSG_PROXY_ORG_ID: state.cmOrgId,
  });
  if (!('inject' in identity) || identity.inject === null) {
    console.warn('[msgProxy] service identity is not configured for the local test session');
    return { kind: 'stop', status: 503, msg: 'collab-messages service identity is not configured' };
  }
  return { kind: 'inject', headers: identity.inject, projectId: state.projectId };
}

async function forward(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const bench = await benchForward(request);
  if (bench.kind === 'stop') {
    reply.code(bench.status).send({ statusCode: bench.status, msg: bench.msg });
    return;
  }

  const url = `${msgProxyTarget()}${request.raw.url ?? '/msg'}`;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (HOP_BY_HOP.has(name.toLowerCase()) || value === undefined) continue;
    headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  if (bench.kind === 'inject') {
    delete headers.authorization;
    delete headers['x-user-id'];
    delete headers['x-org-id'];
    if (headers.cookie) {
      const cookie = stripLocalTestCookie(headers.cookie, bench.projectId);
      if (cookie) headers.cookie = cookie;
      else delete headers.cookie;
    }
    headers.authorization = bench.headers.authorization;
    headers['x-user-id'] = bench.headers['x-user-id'];
    if (bench.headers['x-org-id']) headers['x-org-id'] = bench.headers['x-org-id'];
  } else if (serviceHeaders) {
    for (const [name, value] of Object.entries(serviceHeaders)) {
      headers[name] = value;
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : JSON.stringify(request.body ?? {}),
      redirect: 'manual',
    });
  } catch (err) {
    console.error(`[msgProxy] upstream ${url} unreachable:`, (err as Error).message);
    reply.code(502).send({ statusCode: 502, msg: 'collab-messages backend unreachable (msg app down?)' });
    return;
  }

  reply.code(response.status);
  response.headers.forEach((value, name) => {
    if (HOP_BY_HOP.has(name.toLowerCase())) return;
    // set-cookie must reach the browser (cauth refresh, identity binding).
    reply.header(name, value);
  });
  const payload = Buffer.from(await response.arrayBuffer());
  reply.send(payload);
}

export function registerMsgProxy(app: FastifyInstance): void {
  ensureEnvFileLoaded();
  const identity = serviceIdentityHeaders(process.env);
  serviceHeaders = null;
  if ('error' in identity) {
    console.error(`[msgProxy] ${identity.error}`);
  } else if (identity.inject) {
    serviceHeaders = identity.inject;
  }

  if (process.env.MSG_PROXY_ENABLED === 'false') {
    console.info('[msgProxy] disabled (MSG_PROXY_ENABLED=false)');
    return;
  }
  app.all('/msg', forward);
  app.all('/msg/*', forward);
  // Identity/diagnostic endpoint of collab-messages: open /whoami in the
  // browser to see exactly what the current cauth/loginMsg cookies resolve to
  // (missing token / invalid or expired / bound identity).
  app.all('/whoami', forward);
  console.info(msgProxyStartupLog(msgProxyTarget(), identity));
}
