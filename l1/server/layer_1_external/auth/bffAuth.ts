/// <mls fileReference="_102034_/l1/server/layer_1_external/auth/bffAuth.ts" enhancement="_blank" />
// Collab-auth JWT verification for the single door of a generated app (`POST /execBff`).
//
// Mirrors the proven verifier of the platform (collab-messages authJwt.ts, itself mirrored from
// collab-billing/cbe): jose v6, `createRemoteJWKSet` + `jwtVerify`, issuer from env, and the same
// `grace_until` tolerance, so a token the cbe accepted inside its grace window is accepted here too.
//
// TOKEN SOURCE — the cookie comes FIRST here, and that is the whole point. The runtime login stores the
// access token in the **httpOnly** `cauth` cookie, which is exactly why the browser cannot send an
// Authorization header: JS never sees the token. Same-origin requests carry the cookie by themselves, so
// the page needs no change at all. The Bearer header stays as the secondary path for callers that do hold
// a token (server-to-server, the test runner). Never a query parameter.

import { createRemoteJWKSet, jwtVerify, errors as joseErrors, decodeJwt, type JWTPayload } from 'jose';

export interface CollabAuthClaims extends JWTPayload {
  sub: string;
  email: string;
  name?: string;
  /**
   * Module authorities of the user, as `<moduleId>:<actorId>` (`petShop:admin`) — the platform's own role
   * shape (`sites:admin`, `collab-llm:operator`) and exactly what the generated controllers already gate
   * on. Optional because the issuer does not emit them yet: until it does, this reads as "no authority",
   * which is today's behaviour.
   */
  authorities?: string[];
  /** Same list under the name the platform uses elsewhere; whichever arrives is read. */
  roles?: string[];
}

/**
 * The authorities of a module, from verified claims — `<moduleId>:<actorId>` filtered by this module.
 *
 * The prefix is the filter, not a convention to re-derive: an authority of another module says nothing
 * about this one. The list is what `sessionContext.actorScope` becomes, which is what `enforceActors` in
 * every generated controller reads.
 */
export function moduleAuthorities(claims: CollabAuthClaims | undefined, moduleId: string): string[] {
  if (!claims || !moduleId) return [];
  const declared = [
    ...(Array.isArray(claims.authorities) ? claims.authorities : []),
    ...(Array.isArray(claims.roles) ? claims.roles : []),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  const prefix = `${moduleId}:`;
  return [...new Set(declared.filter(value => value.startsWith(prefix)))];
}

/**
 * Is an EMPTY authority list a refusal?
 *
 * Today it is not: `enforceActors` treats an empty scope as permissive, which is why the actor gate is
 * inert for real HTTP traffic. Flipping that before the issuer emits authorities would lock every user out
 * of every module, so it waits behind its own flag (`BFF_ACTORS_ENFORCED`, default false) — the same staged
 * shape as the authentication itself.
 */
export function isActorEnforcementOn(): boolean {
  return process.env.BFF_ACTORS_ENFORCED === 'true';
}

const AUTH_BASE_URL = process.env.COLLAB_AUTH_BASE_URL ?? 'https://auth.collab.codes';
const JWKS_URL = process.env.COLLAB_AUTH_JWKS_URL
  ?? `${AUTH_BASE_URL.replace(/\/$/u, '')}/.well-known/jwks.json`;
const ISSUER = process.env.COLLAB_AUTH_ISSUER ?? 'https://auth.collab.codes';
const JWKS_TIMEOUT_MS = Number(process.env.COLLAB_AUTH_JWKS_TIMEOUT_MS ?? 5000);

/**
 * Is the 401 ENFORCED?
 *
 * Default **false** on purpose (stage 1 of the rollout): the verifier runs and the server reports who
 * WOULD have been rejected, without locking anyone out of an app that is already published. Flipping
 * `BFF_JWT_ENABLED=true` is a later act — env + restart, no deploy — and the same env back to `false` is
 * the emergency rollback afterwards.
 */
export function isBffAuthEnforced(): boolean {
  return process.env.BFF_JWT_ENABLED === 'true';
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) jwks = createRemoteJWKSet(new URL(JWKS_URL), { timeoutDuration: JWKS_TIMEOUT_MS });
  return jwks;
}

/** A bearer token from an Authorization header value, or '' when absent/malformed. */
export function bearerFromHeader(authorization: string | undefined): string {
  if (!authorization) return '';
  const match = /^Bearer\s+(.+)$/iu.exec(authorization.trim());
  return match ? match[1].trim() : '';
}

/** The value of one cookie from a raw Cookie header, or '' when absent. */
export function cookieFromHeader(cookieHeader: string | undefined, name: string): string {
  if (!cookieHeader) return '';
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`, 'u').exec(cookieHeader);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** Cookie `cauth` first (the browser path), Authorization header second. */
export function tokenFromRequest(headers: Record<string, string | string[] | undefined> | undefined): string {
  const read = (name: string): string | undefined => {
    const value = headers?.[name];
    return Array.isArray(value) ? value[0] : value;
  };
  return cookieFromHeader(read('cookie'), 'cauth') || bearerFromHeader(read('authorization'));
}

/** Verified claims, honouring `grace_until` exactly like the rest of the platform. */
export async function verifyAccessToken(token: string): Promise<CollabAuthClaims> {
  try {
    const { payload } = await jwtVerify(token, getJwks(), { issuer: ISSUER });
    return payload as CollabAuthClaims;
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
      const payload = decodeJwt(token);
      const graceUntil = payload.grace_until as number | undefined;
      if (typeof graceUntil === 'number' && Math.floor(Date.now() / 1000) < graceUntil) {
        return payload as CollabAuthClaims;
      }
    }
    throw error;
  }
}

export interface BffAuthOutcome {
  /** Verified identity, when a valid token was presented. */
  claims?: CollabAuthClaims;
  /** True when the request must be refused (no/invalid token AND enforcement is on). */
  reject: boolean;
  reason: 'ok' | 'missing-token' | 'invalid-token';
}

/**
 * Resolve the session of one `/execBff` call. Never throws: an unverifiable token is an OUTCOME, not an
 * exception, because stage 1 has to keep serving while reporting who would have been rejected.
 */
export async function resolveBffSession(
  headers: Record<string, string | string[] | undefined> | undefined,
): Promise<BffAuthOutcome> {
  const token = tokenFromRequest(headers);
  if (!token) return { reject: isBffAuthEnforced(), reason: 'missing-token' };
  try {
    return { claims: await verifyAccessToken(token), reject: false, reason: 'ok' };
  } catch {
    return { reject: isBffAuthEnforced(), reason: 'invalid-token' };
  }
}
