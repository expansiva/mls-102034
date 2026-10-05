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

// Hop-by-hop headers must not be forwarded in either direction.
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

function getTarget(): string {
  return (process.env.MSG_PROXY_TARGET ?? DEFAULT_TARGET).replace(/\/+$/u, '');
}

async function forward(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const url = `${getTarget()}${request.raw.url ?? '/msg'}`;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (HOP_BY_HOP.has(name.toLowerCase()) || value === undefined) continue;
    headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  if (serviceHeaders) {
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
  console.info(msgProxyStartupLog(getTarget(), identity));
}
