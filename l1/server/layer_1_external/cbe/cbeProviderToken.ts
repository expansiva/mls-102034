/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeProviderToken.ts" enhancement="_blank" />
// Exchanges a GitHub/GitLab authorization code for an access token.
// The collab-auth session is required; the token is returned to the browser
// and is never stored or written to the log.

import { readFile } from 'node:fs/promises';
import { CBE_HTTP_BAD_REQUEST, CBE_HTTP_OK, CBE_HTTP_UNAUTHORIZED } from '/_102034_/l1/server/layer_1_external/cbe/cbeTypes.js';

const HTTP_BAD_GATEWAY = 502;
const HTTP_UNAVAILABLE = 503;
const EXCHANGE_TIMEOUT_MS = 10_000;
// Next to the base, never inside it: the draft process may read the whole base (`--allow-read=<base>`).
export const DEFAULT_APPCONFIG_FILE = '/data/appconfig.json';

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

const PROVIDERS: Record<ProviderSource, { url: string }> = {
  github: { url: 'https://github.com/login/oauth/access_token' },
  gitlab: { url: 'https://gitlab.com/oauth/token' },
};

interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

function appconfigPath(): string {
  const fromEnv = process.env.COLLAB_APPCONFIG_FILE;
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : DEFAULT_APPCONFIG_FILE;
}

function stringField(entry: unknown, field: 'clientId' | 'clientSecret'): string {
  if (!entry || typeof entry !== 'object') return '';
  const value = (entry as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
}

// Read on every call: editing the file applies without a restart and to every worker.
async function readOAuthClient(source: ProviderSource): Promise<OAuthClient | undefined> {
  const path = appconfigPath();
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    console.error(code === 'ENOENT'
      ? `[cbe] providerToken missing ${path}`
      : `[cbe] providerToken cannot read ${path} (${typeof code === 'string' ? code : 'unknown'})`);
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Never the parser message: it can echo a piece of the file, which holds the secrets.
    console.error(`[cbe] providerToken invalid JSON in ${path}`);
    return undefined;
  }

  const providers = parsed && typeof parsed === 'object'
    ? (parsed as { oauthProviders?: unknown }).oauthProviders
    : undefined;
  const entry = providers && typeof providers === 'object'
    ? (providers as Record<string, unknown>)[source]
    : undefined;
  const clientId = stringField(entry, 'clientId');
  const clientSecret = stringField(entry, 'clientSecret');
  if (clientId.length === 0) {
    console.error(`[cbe] providerToken missing ${path} oauthProviders.${source}.clientId`);
    return undefined;
  }
  if (clientSecret.length === 0) {
    console.error(`[cbe] providerToken missing ${path} oauthProviders.${source}.clientSecret`);
    return undefined;
  }
  return { clientId, clientSecret };
}

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
  const client = await readOAuthClient(input.source);
  if (!client) {
    reply.code(HTTP_UNAVAILABLE).send({ statusCode: HTTP_UNAVAILABLE, error: 'PROVIDER_NOT_CONFIGURED' });
    return;
  }

  const payload: Record<string, string> = {
    client_id: client.clientId,
    client_secret: client.clientSecret,
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
