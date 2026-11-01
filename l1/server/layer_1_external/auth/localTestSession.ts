/// <mls fileReference="_102034_/l1/server/layer_1_external/auth/localTestSession.ts" enhancement="_blank" />
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  getLocalTestConfig,
  lookupLocalTestPersona,
  type LocalTestAlias,
  type LocalTestConfig,
  type LocalTestConfigState,
  type LocalTestPersona,
} from '/_102034_/l1/server/layer_1_external/config/localTestConfig.js';

/** Selection cookie. The value is an HMAC payload, not an IdP JWT. */
export const LOCAL_TEST_COOKIE_PREFIX = 'collab_local_test_';
export const LOCAL_TEST_MAX_AGE_SEC = 8 * 60 * 60;

/** Same shape the BFF accepts (`CollabAuthClaims` / jose `JWTPayload`), including the string index. */
export interface LocalTestSessionClaims {
  sub: string;
  email: string;
  name: string;
  active_org: { id: string };
  [propName: string]: unknown;
}

export type LocalTestHeaderOutcome =
  | { kind: 'skip' }
  | { kind: 'reject' }
  | { kind: 'ok'; claims: LocalTestSessionClaims; source: 'local-test' };

interface SignedPayload {
  alg: 'HS256';
  alias: string;
  project: string;
  iat: number;
  exp: number;
}

export function localTestCookieName(projectId: string): string {
  return `${LOCAL_TEST_COOKIE_PREFIX}${projectId}`;
}

function b64url(value: Buffer | string): string {
  const buffer = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  return buffer.toString('base64url');
}

function mac(body: string, key: string): Buffer {
  return createHmac('sha256', key).update(body).digest();
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Sign the bench selection. Ids stay in the manifest; the cookie carries only the alias. */
export function mintLocalTestCookie(alias: LocalTestAlias, state: LocalTestConfig, nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const payload: SignedPayload = {
    alg: 'HS256',
    alias,
    project: state.projectId,
    iat,
    exp: iat + LOCAL_TEST_MAX_AGE_SEC,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${b64url(mac(body, state.cookieKey))}`;
}

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string {
  if (!headers) return '';
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  const value = found?.[1];
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw.trim() : '';
}

function cookieValue(cookieHeader: string, name: string): string | null {
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`, 'u').exec(cookieHeader);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function hostAllowed(host: string, state: LocalTestConfig): boolean {
  if (!host || host.includes(' ') || host.startsWith('[')) return false;
  return state.allowedOrigins.some((origin) => {
    try {
      const url = new URL(origin);
      return host.toLowerCase() === `${url.hostname}:${url.port}`.toLowerCase();
    } catch {
      return false;
    }
  });
}

function originAllowed(origin: string, state: LocalTestConfig): boolean {
  if (!origin) return true;
  return state.allowedOrigins.includes(origin);
}

function integerField(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/**
 * Verify one cookie against the manifest. A forged person id or cm id in the payload is ignored:
 * the alias is the only selector, and the profile comes from the server-side manifest.
 */
export function readLocalTestCookie(
  token: string,
  state: LocalTestConfig,
  host: string,
  origin: string,
  nowMs = Date.now(),
): LocalTestPersona | null {
  if (!hostAllowed(host, state) || !originAllowed(origin, state)) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  let signature: Buffer;
  try {
    signature = Buffer.from(parts[1], 'base64url');
  } catch {
    return null;
  }
  if (!safeEqual(signature, mac(parts[0], state.cookieKey))) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const payload = parsed as Record<string, unknown>;
  if (payload.alg !== 'HS256') return null;
  const alias = payload.alias;
  const project = payload.project;
  const iat = integerField(payload.iat);
  const exp = integerField(payload.exp);
  if (typeof alias !== 'string' || typeof project !== 'string' || iat === null || exp === null) return null;
  if (project !== state.projectId) return null;
  if (exp <= iat || exp - iat > LOCAL_TEST_MAX_AGE_SEC) return null;
  const now = Math.floor(nowMs / 1000);
  if (now < iat || now >= exp) return null;

  return lookupLocalTestPersona({ alias }, state);
}

export function claimsForLocalTestPersona(persona: LocalTestPersona, state: LocalTestConfig): LocalTestSessionClaims {
  return {
    sub: persona.sub,
    email: persona.email,
    name: persona.name,
    active_org: { id: state.cmOrgId },
  };
}

let loadConfig: () => LocalTestConfigState = () => getLocalTestConfig();

/** Tests substitute the manifest reader. Production always uses the process cache. */
export function setLocalTestConfigLoaderForTests(loader?: () => LocalTestConfigState): void {
  loadConfig = loader ?? (() => getLocalTestConfig());
}

function loadState(): LocalTestConfigState | 'error' {
  try {
    return loadConfig();
  } catch {
    return 'error';
  }
}

/**
 * No real cauth/Bearer was presented. Disabled bench: ignore a leftover cookie.
 * Active bench with a bad cookie: explicit rejection. No cookie: caller keeps the anonymous path.
 */
export function localTestSessionFromHeaders(
  headers: Record<string, string | string[] | undefined> | undefined,
  nowMs = Date.now(),
): LocalTestHeaderOutcome {
  const cookieHeader = headerValue(headers, 'cookie');
  const state = loadState();
  if (state === 'error') {
    return cookieHeader.includes(LOCAL_TEST_COOKIE_PREFIX) ? { kind: 'reject' } : { kind: 'skip' };
  }
  if (!state.enabled) return { kind: 'skip' };

  const token = cookieValue(cookieHeader, localTestCookieName(state.projectId));
  if (token === null || token === '') {
    return cookieHeader.includes(LOCAL_TEST_COOKIE_PREFIX) ? { kind: 'reject' } : { kind: 'skip' };
  }
  const persona = readLocalTestCookie(
    token,
    state,
    headerValue(headers, 'host'),
    headerValue(headers, 'origin'),
    nowMs,
  );
  if (!persona) return { kind: 'reject' };
  return { kind: 'ok', claims: claimsForLocalTestPersona(persona, state), source: 'local-test' };
}
