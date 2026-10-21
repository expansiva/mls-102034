/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeCandidateProxy.ts" enhancement="_blank" />

export const CANDIDATE_BODY_LIMIT = 1_250_000;
export const CANDIDATE_ACTIONS = new Set(['candidateRead', 'candidatePublish', 'candidateMarkResult']);
const DEFAULT_TIMEOUT_MS = 15_000;
const ORIGIN_MISSING = 'CANDIDATE_ORIGIN is not configured';
const ORIGIN_INVALID = 'CANDIDATE_ORIGIN is invalid';
const ORIGIN_HTTPS = 'CANDIDATE_ORIGIN must use HTTPS (HTTP is allowed only for localhost)';

export interface CandidateProxyResult {
  statusCode: number;
  body: unknown;
  contentType: string;
}

/** `local` only when CANDIDATE_HUB=local. Anything else forwards. */
export function candidateHubMode(env: Record<string, string | undefined> = process.env): 'local' | 'forward' {
  return env.CANDIDATE_HUB === 'local' ? 'local' : 'forward';
}

/** Forward origin. Requires a non-empty CANDIDATE_ORIGIN. HTTPS, or HTTP on loopback only. No fallback host. */
export function candidateOrigin(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.CANDIDATE_ORIGIN ?? '').trim().replace(/\/$/u, '');
  if (raw === '') throw new Error(ORIGIN_MISSING);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(ORIGIN_INVALID);
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error(ORIGIN_HTTPS);
  return raw;
}

function centralCandidateUrl(env: Record<string, string | undefined> = process.env): URL {
  return new URL(`${candidateOrigin(env)}/exec/candidate`);
}

export function candidateActionAllowed(body: unknown): body is { action: 'candidateRead' | 'candidatePublish' | 'candidateMarkResult' } {
  return Boolean(body && typeof body === 'object' && !Array.isArray(body) &&
    CANDIDATE_ACTIONS.has((body as { action?: unknown }).action as string));
}

export type CandidateIdentity =
  | { kind: 'jwt' }
  | { kind: 'service'; owner: string; orgId: string | null }
  | { kind: 'none' };

/** Hub classification. A JWT email wins. Otherwise an exact bearer match against a non-empty COLLAB_SERVICE_TOKEN plus a non-empty X-User-Id. */
export function candidateIdentity(input: {
  email?: string | null;
  authorization?: string | null;
  userId?: string | null;
  orgId?: string | null;
  serviceToken?: string | null;
}): CandidateIdentity {
  if (input.email) return { kind: 'jwt' };
  const serviceToken = input.serviceToken ?? '';
  const authorization = input.authorization ?? '';
  const presented = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
  const owner = (input.userId ?? '').trim();
  if (serviceToken !== '' && presented === serviceToken && owner !== '') {
    const orgId = (input.orgId ?? '').trim();
    return { kind: 'service', owner, orgId: orgId || null };
  }
  return { kind: 'none' };
}

/** Project file wins. Otherwise CANDIDATE_HUB_ORG_ID. Blank is null. */
export function candidateHubOrgId(
  projectFileOrgId: string | null | undefined,
  env: Record<string, string | undefined> = {},
): string | null {
  const fromFile = (projectFileOrgId ?? '').trim();
  if (fromFile !== '') return fromFile;
  const fromEnv = (env.CANDIDATE_HUB_ORG_ID ?? '').trim();
  return fromEnv === '' ? null : fromEnv;
}

/**
 * Local-hub caller. JWT and service keep their identity.
 * `none` becomes the lima desenv only when MSG_PROXY_TOKEN and MSG_PROXY_USER_ID are non-empty; otherwise null (401).
 * The token is never returned.
 */
export function candidateLocalCaller(
  identity: CandidateIdentity,
  session: { email?: string | null; orgId?: string | null },
  env: Record<string, string | undefined> = {},
): { owner: string; orgId: string | null } | null {
  if (identity.kind === 'jwt') return { owner: session.email ?? '', orgId: session.orgId ?? null };
  if (identity.kind === 'service') return { owner: identity.owner, orgId: identity.orgId };
  const token = env.MSG_PROXY_TOKEN ?? '';
  const userId = (env.MSG_PROXY_USER_ID ?? '').trim();
  if (token === '' || userId === '') return null;
  const orgId = (env.MSG_PROXY_ORG_ID ?? '').trim();
  return { owner: userId, orgId: orgId === '' ? null : orgId };
}

/** Headers for the forward hop. Built from the verified JWT or from MSG_PROXY_*, never from the inbound Authorization. */
export function candidateForwardHeaders(
  verifiedAccessToken: string,
  env: Record<string, string | undefined> = {},
): Record<string, string> | null {
  if (verifiedAccessToken) {
    return {
      'Content-Type': 'application/json',
      Cookie: `cauth=${encodeURIComponent(verifiedAccessToken)}`,
    };
  }
  const token = env.MSG_PROXY_TOKEN ?? '';
  const userId = (env.MSG_PROXY_USER_ID ?? '').trim();
  if (token === '' || userId === '') return null;
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-User-Id': userId,
    'X-Org-Id': env.MSG_PROXY_ORG_ID ?? '',
  };
}

export async function proxyCandidateRequest(
  body: unknown,
  verifiedAccessToken: string,
  fetchImpl: typeof fetch = fetch,
  forwardEnv: Record<string, string | undefined> = {},
): Promise<CandidateProxyResult> {
  if (!candidateActionAllowed(body)) return {
    statusCode: 400, contentType: 'application/json; charset=utf-8',
    body: { statusCode: 400, status: 'error', msg: 'candidate.invalid_action' },
  };
  const headers = candidateForwardHeaders(verifiedAccessToken, forwardEnv);
  if (!headers) return {
    statusCode: 401, contentType: 'application/json; charset=utf-8',
    body: { statusCode: 401, status: 'error', msg: 'candidate.unauthorized' },
  };
  const target = centralCandidateUrl(forwardEnv);
  const controller = new AbortController();
  const timeoutMs = Number(process.env.CBE_CANDIDATE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(target, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers,
      body: JSON.stringify(body),
    });
    if (response.status >= 300 && response.status < 400) throw new Error('central CBE redirect denied');
    const text = await response.text();
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : {}; } catch { throw new Error('central CBE returned non-JSON'); }
    const statusCode = response.status;
    if (![200, 400, 401, 403, 409, 413, 500, 503].includes(statusCode)) {
      throw new Error(`central CBE returned unsupported status ${statusCode}`);
    }
    return { statusCode, body: parsed, contentType: 'application/json; charset=utf-8' };
  } finally {
    clearTimeout(timer);
  }
}
