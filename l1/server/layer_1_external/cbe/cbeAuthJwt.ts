/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeAuthJwt.ts" enhancement="_blank" />
// collab-auth JWT session for the runtime VM cbe module. Mirrors the proven
// pattern of cbe-collab-back-end/src/helpers/authJwt.ts (jose v6,
// createRemoteJWKSet + jwtVerify + grace_until + refresh), kept minimal.
//
// Everything here is ADDITIVE: it only activates when a `cauth` cookie (or an
// authSession call) reaches the VM. Without it the login stays anonymous,
// exactly as before. AUTH_JWT_ENABLED=false hard-disables the whole path
// (rollback = env change + pm2 restart, no deploy).

import { createRemoteJWKSet, jwtVerify, errors as joseErrors, decodeJwt, type JWTPayload } from 'jose';

export interface CollabAuthClaims extends JWTPayload {
  sub: string;
  email: string;
  name?: string;
}

const AUTH_BASE_URL = (process.env.COLLAB_AUTH_BASE_URL ?? 'https://auth.collab.codes').replace(/\/$/u, '');
const JWKS_URL = process.env.COLLAB_AUTH_JWKS_URL ?? `${AUTH_BASE_URL}/.well-known/jwks.json`;
const ISSUER = process.env.COLLAB_AUTH_ISSUER ?? 'https://auth.collab.codes';
const JWKS_TIMEOUT_MS = Number(process.env.COLLAB_AUTH_JWKS_TIMEOUT_MS ?? 5000);

export function isJwtAuthEnabled(): boolean {
  return process.env.AUTH_JWT_ENABLED !== 'false';
}

// Lazily built so importing this module never does network / URL work at load.
let _jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!_jwks) {
    _jwks = createRemoteJWKSet(new URL(JWKS_URL), { timeoutDuration: JWKS_TIMEOUT_MS });
  }
  return _jwks;
}

/**
 * Verifies a collab-auth access token offline against the cached JWKS.
 * Honors `grace_until`: an expired token is still accepted while within its
 * grace window (same behavior as the central cbe / collab-llm).
 */
export async function verifyAccessToken(token: string): Promise<CollabAuthClaims> {
  try {
    const { payload } = await jwtVerify(token, getJwks(), { issuer: ISSUER });
    return payload as CollabAuthClaims;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      const payload = decodeJwt(token);
      const graceUntil = payload['grace_until'] as number | undefined;
      if (typeof graceUntil === 'number' && Math.floor(Date.now() / 1000) < graceUntil) {
        return payload as CollabAuthClaims;
      }
    }
    throw err;
  }
}

/** Exchanges a refresh token for a fresh access token; null on any failure. */
export async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${AUTH_BASE_URL}/auth/token/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) {
      console.info(`[cbe:auth] refresh failed: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { access_token?: unknown };
    return typeof data.access_token === 'string' ? data.access_token : null;
  } catch (err) {
    console.error('[cbe:auth] refresh error:', (err as Error).message);
    return null;
  }
}

export interface JwtSession {
  email?: string;
  /** Set when a refresh produced a new access token that should replace the cauth cookie. */
  newAccessToken?: string;
}

/**
 * Resolves the JWT session from the cauth/crefresh cookie values. Returns an
 * empty session (anonymous) when there is no usable JWT — never throws.
 */
export async function resolveJwtSession(cauth: string, crefresh: string): Promise<JwtSession> {
  if (!isJwtAuthEnabled() || !cauth) return {};
  try {
    const claims = await verifyAccessToken(cauth);
    return { email: claims.email };
  } catch {
    if (!crefresh) return {};
    const newAccessToken = await refreshAccessToken(crefresh);
    if (!newAccessToken) return {};
    try {
      const claims = await verifyAccessToken(newAccessToken);
      return { email: claims.email, newAccessToken };
    } catch {
      return {};
    }
  }
}

/** Parses a Cookie request header into name -> decoded value (last one wins). */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }
  return cookies;
}
