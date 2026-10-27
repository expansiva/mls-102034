/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/draftProxy.ts" enhancement="_blank" />
// POST /execBff with a valid collab-draft cookie is proxied to that draft's dev process.
// COLLAB_DRAFT set means this process IS the dev process: never proxy, or the cookie loops.

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CollabAuthClaims } from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';
import { parseDraftSlug, requestDraftValue, resolveRequestDraft, type DraftRequestHeaders } from '/_102034_/l1/server/layer_1_external/cbe/cbeDraft.js';
import {
  ensureDevProcess,
  touchDevProcess,
  waitForDevReady,
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
  claims?: CollabAuthClaims;
  source?: 'local-test';
  reason?: 'ok' | 'missing-token' | 'invalid-token';
}

export type DraftExecPlan =
  | {
      action: 'proxy';
      slug: string;
      newAccessToken?: string;
      claims?: CollabAuthClaims;
      source?: 'local-test';
      reason?: 'ok' | 'missing-token' | 'invalid-token';
    }
  | { action: 'unauthorized'; statusCode: 401; slug: string; reason: 'ok' | 'missing-token' | 'invalid-token' }
  | { action: 'local' };

export interface DraftExecDeps {
  fetchImpl?: typeof fetch;
  ensureDevProcessImpl?: (opts: EnsureDevProcessOpts) => DevProcessInfo;
  touchDevProcessImpl?: (base: string, slug: string, now: number) => void;
  waitForDevReadyImpl?: (port: number) => Promise<boolean>;
  resolveRequestDraftImpl?: typeof resolveRequestDraft;
}

export function draftDownBody(): { ok: false; data: null; error: { code: 'DRAFT_DOWN'; message: string } } {
  return {
    ok: false,
    data: null,
    error: { code: 'DRAFT_DOWN', message: DRAFT_DOWN_MESSAGE },
  };
}

/** Slug from this call (`x-collab-draft`, else `collab-draft`), or null when this process is already the draft dev server. */
export function draftSlugForProxy(headers: DraftRequestHeaders | undefined): string | null {
  if (process.env.COLLAB_DRAFT !== undefined) return null;
  return parseDraftSlug(requestDraftValue(headers))?.slug ?? null;
}

/**
 * Auth before proxy. The dev process does not load BFF_JWT_ENABLED, so the parent is the gate.
 * Rejected session falls through to the normal `/execBff` 401. No slug stays on the local server.
 */
export async function planDraftExecBff(
  headers: DraftRequestHeaders | undefined,
  resolveSession: () => Promise<DraftSessionView>,
): Promise<DraftExecPlan> {
  const slug = draftSlugForProxy(headers);
  if (!slug) return { action: 'local' };
  const session = await resolveSession();
  if (session.reject) return { action: 'unauthorized', statusCode: 401, slug, reason: session.reason ?? 'invalid-token' };
  return {
    action: 'proxy',
    slug,
    ...(session.newAccessToken ? { newAccessToken: session.newAccessToken } : {}),
    ...(session.claims ? { claims: session.claims } : {}),
    ...(session.source ? { source: session.source } : {}),
    ...(session.reason ? { reason: session.reason } : {}),
  };
}

function clientProjectNumber(raw: string): number | null {
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const projectId = Number(raw);
  return Number.isSafeInteger(projectId) ? projectId : null;
}

function requestHeaders(
  request: FastifyRequest,
  identity?: { secret: string; claims: CollabAuthClaims },
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower.startsWith('x-collab-draft-identity') || value === undefined) continue;
    headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  if (identity) {
    headers['x-collab-draft-identity-secret'] = identity.secret;
    headers['x-collab-draft-identity'] = Buffer.from(JSON.stringify(identity.claims)).toString('base64url');
  }
  return headers;
}

/** A value from the request body or from the draft process must never forge a log line: safe characters only. */
function logSafe(value: string, max = 80): string {
  return value.slice(0, max).replace(/[^A-Za-z0-9_.:-]/gu, '?');
}

function routineName(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !('routine' in body)) return undefined;
  const routine = (body as { routine: unknown }).routine;
  return typeof routine === 'string' && routine.length > 0 ? logSafe(routine) : undefined;
}

function loggedSource(
  claims: CollabAuthClaims | undefined,
  source: 'local-test' | undefined,
): 'jwt' | 'local-test' | 'none' {
  if (source === 'local-test') return 'local-test';
  if (claims) return 'jwt';
  return 'none';
}

function childErrorCode(payload: Buffer): string | undefined {
  try {
    const parsed: unknown = JSON.parse(payload.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || !('error' in parsed)) return undefined;
    const error = (parsed as { error: unknown }).error;
    if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' && code.length > 0 ? logSafe(code, 64) : undefined;
  } catch {
    return undefined;
  }
}

function logDraftForward(args: {
  slug: string;
  routine?: string;
  identity: boolean;
  reason: string;
  source: 'jwt' | 'local-test' | 'none';
  renewed: boolean;
  status: number;
  by: 'principal' | 'child';
  errorCode?: string;
}): void {
  const line = [
    `[draftProxy] ${new Date().toISOString()}`,
    `slug=${args.slug}`,
    ...(args.routine ? [`routine=${args.routine}`] : []),
    `identity: ${args.identity ? 'yes' : 'no'}`,
    `reason: ${args.reason}`,
    `source: ${args.source}`,
    `renewed: ${args.renewed ? 'yes' : 'no'}`,
    `status=${args.status}`,
    `by=${args.by}`,
    ...(args.errorCode ? [`error=${args.errorCode}`] : []),
  ].join(' ');
  if (args.status >= 200 && args.status < 300) console.info(line);
  else console.error(line);
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
  claims?: CollabAuthClaims;
  reason?: 'ok' | 'missing-token' | 'invalid-token';
  source?: 'local-test';
  renewed?: boolean;
} & DraftExecDeps): Promise<void> {
  const ensure = args.ensureDevProcessImpl ?? ensureDevProcess;
  const touch = args.touchDevProcessImpl ?? touchDevProcess;
  const doFetch = args.fetchImpl ?? fetch;
  const waitReady = args.waitForDevReadyImpl ?? ((port: number) => waitForDevReady(port));
  const resolve = args.resolveRequestDraftImpl ?? resolveRequestDraft;
  const url = (port: number) => `http://127.0.0.1:${port}/execBff`;

  try {
    const draft = await resolve(args.request.headers, args.base, args.clientProjectId);
    if (draft === null) {
      console.error(`[draftProxy] draft ${args.slug} worktree failed: cookie has no valid draft`);
      args.reply.code(503).send(draftDownBody());
      return;
    }
  } catch (err) {
    console.error(`[draftProxy] draft ${args.slug} worktree failed: ${(err as Error).message}`);
    args.reply.code(503).send(draftDownBody());
    return;
  }

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

  const body = JSON.stringify(args.request.body ?? {});
  let identity: { secret: string; claims: CollabAuthClaims } | undefined;
  if (args.claims) {
    if (info.identitySecret) identity = { secret: info.identitySecret, claims: args.claims };
    else console.error(`[draftProxy] dev ${args.slug}: identity secret missing`);
  }
  const post = (): Promise<Response> => doFetch(url(info.port), {
    method: 'POST',
    headers: requestHeaders(args.request, identity),
    body,
    signal: AbortSignal.timeout(10000),
  });

  let response: Response;
  try {
    response = await post();
  } catch (err) {
    console.error(`[draftProxy] dev ${args.slug} at ${url(info.port)} unreachable: ${(err as Error).message}`);
    if ((err as Error).name === 'TimeoutError') {
      args.reply.code(503).send(draftDownBody());
      return;
    }
    let ready = false;
    try {
      ready = await waitReady(info.port);
    } catch (waitErr) {
      console.error(`[draftProxy] dev ${args.slug} ready check failed: ${(waitErr as Error).message}`);
    }
    if (!ready) {
      args.reply.code(503).send(draftDownBody());
      return;
    }
    try {
      response = await post();
    } catch (err2) {
      console.error(`[draftProxy] dev ${args.slug} at ${url(info.port)} unreachable: ${(err2 as Error).message}`);
      args.reply.code(503).send(draftDownBody());
      return;
    }
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
  const payload = Buffer.from(await response.arrayBuffer());
  const ok = response.status >= 200 && response.status < 300;
  logDraftForward({
    slug: args.slug,
    routine: routineName(args.request.body),
    identity: args.claims !== undefined,
    reason: args.reason ?? (args.claims ? 'ok' : 'missing-token'),
    source: loggedSource(args.claims, args.source),
    renewed: args.renewed === true,
    status: response.status,
    by: 'child',
    ...(ok ? {} : { errorCode: childErrorCode(payload) }),
  });
  args.reply.send(payload);
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
  const plan = await planDraftExecBff(args.request.headers, args.resolveSession);
  if (plan.action === 'unauthorized') {
    logDraftForward({
      slug: plan.slug,
      routine: routineName(args.request.body),
      identity: false,
      reason: plan.reason,
      source: 'none',
      renewed: false,
      status: plan.statusCode,
      by: 'principal',
    });
    return { handled: false, statusCode: 401 };
  }
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
    claims: plan.claims,
    reason: plan.reason,
    source: plan.source,
    renewed: plan.newAccessToken !== undefined,
    fetchImpl: args.fetchImpl,
    ensureDevProcessImpl: args.ensureDevProcessImpl,
    touchDevProcessImpl: args.touchDevProcessImpl,
    waitForDevReadyImpl: args.waitForDevReadyImpl,
    resolveRequestDraftImpl: args.resolveRequestDraftImpl,
  });
  return { handled: true };
}
