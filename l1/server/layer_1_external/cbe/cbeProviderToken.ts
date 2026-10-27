/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeProviderToken.ts" enhancement="_blank" />
// Exchanges a GitHub/GitLab authorization code for an access token.
// The collab-auth session is required; the token is returned to the browser
// and is never stored or written to the log.

import { CBE_HTTP_BAD_REQUEST, CBE_HTTP_OK, CBE_HTTP_UNAUTHORIZED } from '/_102034_/l1/server/layer_1_external/cbe/cbeTypes.js';

const HTTP_BAD_GATEWAY = 502;
const HTTP_UNAVAILABLE = 503;
const EXCHANGE_TIMEOUT_MS = 10_000;

export type ProviderSource = 'github' | 'gitlab';

export interface ProviderTokenBody {
  source: ProviderSource;
  code: string;
  redirectUri: string;
}

export interface ProviderTokenRequest {
  headers: { host?: string | string[] | undefined };
}

export interface ProviderTokenReply {
  code(status: number): { send(payload: unknown): void };
}

type ProviderFetch = typeof fetch;

const PROVIDERS: Record<ProviderSource, { idKey: string; secretKey: string; url: string }> = {
  github: {
    idKey: 'COLLAB_GITHUB_CLIENT_ID',
    secretKey: 'COLLAB_GITHUB_CLIENT_SECRET',
    url: 'https://github.com/login/oauth/access_token',
  },
  gitlab: {
    idKey: 'COLLAB_GITLAB_CLIENT_ID',
    secretKey: 'COLLAB_GITLAB_CLIENT_SECRET',
    url: 'https://gitlab.com/oauth/token',
  },
};

function hostHeader(request: ProviderTokenRequest): string | undefined {
  const host = request.headers.host;
  if (typeof host === 'string' && host.length > 0) return host;
  if (Array.isArray(host) && typeof host[0] === 'string' && host[0].length > 0) return host[0];
  return undefined;
}

function sameHost(redirectUri: string, host: string): boolean {
  try {
    return new URL(redirectUri).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function readBody(body: unknown): ProviderTokenBody | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as { source?: unknown; code?: unknown; redirectUri?: unknown };
  if (record.source !== 'github' && record.source !== 'gitlab') return undefined;
  if (typeof record.code !== 'string' || record.code.length === 0) return undefined;
  if (typeof record.redirectUri !== 'string' || record.redirectUri.length === 0) return undefined;
  return { source: record.source, code: record.code, redirectUri: record.redirectUri };
}

function providerErrorLabel(data: unknown): string {
  if (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string') {
    return (data as { error: string }).error;
  }
  return 'provider_error';
}

export async function handleProviderToken(
  request: ProviderTokenRequest,
  body: unknown,
  reply: ProviderTokenReply,
  session: { email?: string },
  fetchImpl: ProviderFetch = fetch,
): Promise<void> {
  if (!session.email) {
    reply.code(CBE_HTTP_UNAUTHORIZED).send({ statusCode: CBE_HTTP_UNAUTHORIZED, msg: 'unauthorized' });
    return;
  }

  const input = readBody(body);
  const host = hostHeader(request);
  if (!input || !host || !sameHost(input.redirectUri, host)) {
    reply.code(CBE_HTTP_BAD_REQUEST).send({ statusCode: CBE_HTTP_BAD_REQUEST, msg: 'invalid provider token request' });
    return;
  }

  const provider = PROVIDERS[input.source];
  const missing = [provider.idKey, provider.secretKey].filter((key) => !process.env[key]);
  if (missing.length > 0) {
    for (const key of missing) console.error(`[cbe] providerToken missing ${key}`);
    reply.code(HTTP_UNAVAILABLE).send({ statusCode: HTTP_UNAVAILABLE, error: 'PROVIDER_NOT_CONFIGURED' });
    return;
  }

  const payload: Record<string, string> = {
    client_id: process.env[provider.idKey] as string,
    client_secret: process.env[provider.secretKey] as string,
    code: input.code,
    redirect_uri: input.redirectUri,
  };
  if (input.source === 'gitlab') payload.grant_type = 'authorization_code';

  let data: unknown;
  try {
    const response = await fetchImpl(provider.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
    data = await response.json();
  } catch (error) {
    // Name only: the message of a failed exchange must never reach the log (it can carry the request).
    console.error(`[cbe] providerToken PROVIDER_EXCHANGE_FAILED ${error instanceof Error ? error.name : 'unknown'}`);
    reply.code(HTTP_BAD_GATEWAY).send({ statusCode: HTTP_BAD_GATEWAY, error: 'PROVIDER_EXCHANGE_FAILED' });
    return;
  }

  const token = data && typeof data === 'object' && typeof (data as { access_token?: unknown }).access_token === 'string'
    ? (data as { access_token: string }).access_token
    : '';
  if (!token) {
    console.error(`[cbe] providerToken PROVIDER_EXCHANGE_FAILED ${providerErrorLabel(data)}`);
    reply.code(HTTP_BAD_GATEWAY).send({ statusCode: HTTP_BAD_GATEWAY, error: 'PROVIDER_EXCHANGE_FAILED' });
    return;
  }

  reply.code(CBE_HTTP_OK).send({ statusCode: CBE_HTTP_OK, token });
}
