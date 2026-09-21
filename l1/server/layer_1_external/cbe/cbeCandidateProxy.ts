/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeCandidateProxy.ts" enhancement="_blank" />

export const CANDIDATE_BODY_LIMIT = 1_250_000;
export const CANDIDATE_ACTIONS = new Set(['candidateRead', 'candidatePublish', 'candidateMarkResult']);
const DEFAULT_CBE_ORIGIN = 'https://on.collab.codes';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface CandidateProxyResult {
  statusCode: number;
  body: unknown;
  contentType: string;
}

function centralCandidateUrl(): URL {
  const origin = (process.env.CBE_CENTRAL_ORIGIN ?? DEFAULT_CBE_ORIGIN).replace(/\/$/u, '');
  const url = new URL(`${origin}/exec/candidate`);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost'))) {
    throw new Error('CBE_CENTRAL_ORIGIN must use HTTPS (HTTP is allowed only for localhost)');
  }
  return url;
}

export function candidateActionAllowed(body: unknown): body is { action: 'candidateRead' | 'candidatePublish' | 'candidateMarkResult' } {
  return Boolean(body && typeof body === 'object' && !Array.isArray(body) &&
    CANDIDATE_ACTIONS.has((body as { action?: unknown }).action as string));
}

export async function proxyCandidateRequest(
  body: unknown,
  verifiedAccessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CandidateProxyResult> {
  if (!candidateActionAllowed(body)) return {
    statusCode: 400, contentType: 'application/json; charset=utf-8',
    body: { statusCode: 400, status: 'error', msg: 'candidate.invalid_action' },
  };
  if (!verifiedAccessToken) return {
    statusCode: 401, contentType: 'application/json; charset=utf-8',
    body: { statusCode: 401, status: 'error', msg: 'candidate.unauthorized' },
  };
  const controller = new AbortController();
  const timeoutMs = Number(process.env.CBE_CANDIDATE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(centralCandidateUrl(), {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        // Constructed only from a token already verified by resolveSession.
        // No incoming Cookie/Authorization/forwarded headers cross this boundary.
        Cookie: `cauth=${encodeURIComponent(verifiedAccessToken)}`,
      },
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
