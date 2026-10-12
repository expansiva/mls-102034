/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/draftProxy.ts" enhancement="_blank" />
// POST /execBff with a valid collab-draft cookie is proxied to that draft's dev process.
// COLLAB_DRAFT set means this process IS the dev process: never proxy, or the cookie loops.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseCookies } from '/_102034_/l1/server/layer_1_external/cbe/cbeAuthJwt.js';
import { parseDraftSlug } from '/_102034_/l1/server/layer_1_external/cbe/cbeDraft.js';
import {
  ensureDevProcess,
  touchDevProcess,
  type DevProcessInfo,
  type EnsureDevProcessOpts,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.js';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

const DRAFT_DOWN_MESSAGE = 'The draft server is down. Try again in a moment.';

export interface DraftSessionView {
  reject: boolean;
  newAccessToken?: string;
}

export type DraftExecPlan =
  | { action: 'proxy'; slug: string; newAccessToken?: string }
  | { action: 'unauthorized'; statusCode: 401 }
  | { action: 'local' };

export interface DraftExecDeps {
  fetchImpl?: typeof fetch;
  ensureDevProcessImpl?: (opts: EnsureDevProcessOpts) => DevProcessInfo;
  touchDevProcessImpl?: (base: string, slug: string, now: number) => void;
}

export function draftDownBody(): { ok: false; data: null; error: { code: 'DRAFT_DOWN'; message: string } } {
  return {
    ok: false,
    data: null,
    error: { code: 'DRAFT_DOWN', message: DRAFT_DOWN_MESSAGE },
  };
}

/** Slug from `collab-draft`, or null when this process is already the draft dev server. */
export function draftSlugForProxy(cookieHeader: string | string[] | undefined): string | null {
  if (process.env.COLLAB_DRAFT !== undefined) return null;
  const header = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
  return parseDraftSlug(parseCookies(header)['collab-draft'])?.slug ?? null;
}

/**
 * Auth before proxy. The dev process does not load BFF_JWT_ENABLED, so the parent is the gate.
 * Rejected session falls through to the normal `/execBff` 401. No slug stays on the local server.
 */
export async function planDraftExecBff(
  cookieHeader: string | string[] | undefined,
  resolveSession: () => Promise<DraftSessionView>,
): Promise<DraftExecPlan> {
  const slug = draftSlugForProxy(cookieHeader);
  if (!slug) return { action: 'local' };
  const session = await resolveSession();
  if (session.reject) return { action: 'unauthorized', statusCode: 401 };
  return {
    action: 'proxy',
    slug,
    ...(session.newAccessToken ? { newAccessToken: session.newAccessToken } : {}),
  };
}

function clientProjectNumber(raw: string): number | null {
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const projectId = Number(raw);
  return Number.isSafeInteger(projectId) ? projectId : null;
}

function requestHeaders(request: FastifyRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (HOP_BY_HOP.has(name.toLowerCase()) || value === undefined) continue;
    headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return headers;
}

function priorSetCookies(reply: FastifyReply): string[] {
  const existing = reply.getHeader('set-cookie');
  if (existing === undefined || existing === null) return [];
  const values = Array.isArray(existing) ? existing : [existing];
  return values.map((value) => String(value));
}

export async function proxyExecBff(args: {
  request: FastifyRequest;
  reply: FastifyReply;
  slug: string;
  base: string;
  clientProjectId: number;
} & DraftExecDeps): Promise<void> {
  const ensure = args.ensureDevProcessImpl ?? ensureDevProcess;
  const touch = args.touchDevProcessImpl ?? touchDevProcess;
  const doFetch = args.fetchImpl ?? fetch;
  const url = (port: number) => `http://127.0.0.1:${port}/execBff`;

  let info: DevProcessInfo;
  try {
    info = ensure({ base: args.base, slug: args.slug, clientProjectId: args.clientProjectId });
  } catch (err) {
    console.error(`[draftProxy] ensure dev ${args.slug} failed: ${(err as Error).message}`);
    args.reply.code(503).send(draftDownBody());
    return;
  }

  try {
    touch(args.base, args.slug, Date.now());
  } catch (err) {
    console.error(`[draftProxy] touch dev ${args.slug} failed: ${(err as Error).message}`);
  }

  let response: Response;
  try {
    response = await doFetch(url(info.port), {
      method: 'POST',
      headers: requestHeaders(args.request),
      body: JSON.stringify(args.request.body ?? {}),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    console.error(`[draftProxy] dev ${args.slug} at ${url(info.port)} unreachable: ${(err as Error).message}`);
    args.reply.code(503).send(draftDownBody());
    return;
  }

  args.reply.code(response.status);
  const contentType = response.headers.get('content-type');
  if (contentType) args.reply.header('content-type', contentType);
  const cookies = [
    ...priorSetCookies(args.reply),
    ...(typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []),
  ];
  if (cookies.length === 1) args.reply.header('set-cookie', cookies[0]);
  else if (cookies.length > 1) args.reply.header('set-cookie', cookies);
  args.reply.send(Buffer.from(await response.arrayBuffer()));
}

/** Runs the draft branch of POST /execBff. `handled: false` means the caller keeps today's flow. */
export async function applyDraftExecBff(args: {
  request: FastifyRequest;
  reply: FastifyReply;
  base: string;
  clientProjectId: string;
  resolveSession: () => Promise<DraftSessionView>;
  refreshedAuthCookie: (token: string) => string;
} & DraftExecDeps): Promise<{ handled: boolean; statusCode?: 401 }> {
  const plan = await planDraftExecBff(args.request.headers.cookie, args.resolveSession);
  if (plan.action === 'unauthorized') return { handled: false, statusCode: 401 };
  if (plan.action !== 'proxy') return { handled: false };

  if (plan.newAccessToken) args.reply.header('set-cookie', args.refreshedAuthCookie(plan.newAccessToken));
  const clientProjectId = clientProjectNumber(args.clientProjectId);
  if (clientProjectId === null) {
    console.error(`[draftProxy] client project id is not an integer: ${args.clientProjectId}`);
    args.reply.code(503).send(draftDownBody());
    return { handled: true };
  }
  await proxyExecBff({
    request: args.request,
    reply: args.reply,
    slug: plan.slug,
    base: args.base,
    clientProjectId,
    fetchImpl: args.fetchImpl,
    ensureDevProcessImpl: args.ensureDevProcessImpl,
    touchDevProcessImpl: args.touchDevProcessImpl,
  });
  return { handled: true };
}
