/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeRoutes.ts" enhancement="_blank" />
// Fastify wiring for the cbe-compatible endpoints on the runtime VM:
//   POST /exec               -> action dispatcher (login/authSession/authLogout; admin actions stay central)
//   GET  /exec/logout        -> navigation logout (clears cookies, 303 to /)
//   GET  /libs/*             -> mls lib assets (disk cache + remote origin)
//   GET  /monaco/*           -> monaco editor assets (disk cache + remote origin)
//   GET  /mlsServiceWorker.js
// Kept apart from the app/BFF routes on purpose — everything cbe-related lives
// in this folder so it can later move to a release-packaged module untouched.

import { closeSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Pool } from 'pg';
import { executeCbeLogin, readProjectFile } from '/_102034_/l1/server/layer_1_external/cbe/cbeLogin.js';
import { getProjectsBaseDir } from '/_102034_/l1/server/layer_1_external/cbe/cbeCompiledLocal.js';
import { getCbeStaticFile, logCbeStaticConfig } from '/_102034_/l1/server/layer_1_external/cbe/cbeStaticFiles.js';
import { draftSlugForProxy } from '/_102034_/l1/server/layer_1_external/transport/http/draftProxy.js';
import {
  activeOrganizationId,
  availableOrganizations,
  isJwtAuthEnabled,
  parseCookies,
  resolveJwtSession,
  selectOrganization,
  verifyAccessToken,
  type JwtSession,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeAuthJwt.js';
import { listSources, readSources, writeSources } from '/_102034_/l1/server/layer_1_external/cbe/cbeSources.js';
import { CANDIDATE_BODY_LIMIT, candidateActionAllowed, candidateHubMode, candidateHubOrgId, candidateIdentity, candidateLocalCaller, candidateOrigin, proxyCandidateRequest } from '/_102034_/l1/server/layer_1_external/cbe/cbeCandidateProxy.js';
import { handleCandidateRevision } from '/_102034_/l1/server/layer_1_external/candidate/candidateStore.js';
import { ensureCandidateSchema, PostgresCandidatePersistence } from '/_102034_/l1/server/layer_1_external/candidate/candidatePostgres.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { localTestSessionFromHeaders } from '/_102034_/l1/server/layer_1_external/auth/localTestSession.js';
import { getLocalTestConfig } from '/_102034_/l1/server/layer_1_external/config/localTestConfig.js';
import { expiredLocalTestCookie } from '/_102034_/l1/server/layer_1_external/transport/http/localTestSessionHttp.js';
import { parseDatabaseUrl } from '/_102034_/l1/server/layer_1_external/config/projectMode.js';
import { getSharedPgPool } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import { readHistory, readHistoryContent } from '/_102034_/l1/server/layer_1_external/cbe/cbeGit.js';
import { isRebuildInProgress, scheduleRebuildOnSave } from '/_102034_/l1/server/layer_1_external/cbe/cbeRebuildOnSave.js';
import { authorFromSession, commitSavedSources } from '/_102034_/l1/server/layer_1_external/cbe/cbeGitCommit.js';
import { discardDraft, draftDiff, listDrafts, promoteDraft } from '/_102034_/l1/server/layer_1_external/cbe/cbeGitPromote.js';
import { resolveRequestDraft, type RequestDraft } from '/_102034_/l1/server/layer_1_external/cbe/cbeDraft.js';
import { draftDatabaseUrl, ensureDevReaper, restartDevProcess, stopDevProcess } from '/_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.js';
import { desenvIo, handleDesenvEnter, handleDesenvExit } from '/_102034_/l1/server/layer_1_external/cbe/cbeDesenv.js';
import { getRunningRelease } from '/_102034_/l1/server/layer_1_external/cbe/cbeRelease.js';
import {
  CBE_HTTP_BAD_REQUEST,
  CBE_HTTP_NOT_FOUND,
  CBE_HTTP_NOT_MODIFIED,
  CBE_HTTP_OK,
  CBE_HTTP_SERVER_ERROR,
  CBE_HTTP_UNAUTHORIZED,
  type CbeRequestAuthSession,
  type CbeRequestBase,
  type CbeRequestDiscardDraft,
  type CbeRequestDraftDiff,
  type CbeRequestGetContents,
  type CbeRequestGetHistory,
  type CbeRequestGetHistoryContent,
  type CbeRequestListDrafts,
  type CbeRequestLoadFilesInfo,
  type CbeRequestLogin,
  type CbeRequestPromote,
  type CbeRequestSetContents,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeTypes.js';

// Bump on every change to the cbe module. Exposed via the x-cbe-version
// response header and the {action:'ping'} probe so a deploy can be verified:
//   curl -s localhost:3000/exec -H 'Content-Type: application/json' -d '{"action":"ping"}'
export const CBE_MODULE_VERSION = '1.8.3';

// no-cache = always revalidate with the ETag (304 when unchanged). The server
// is local to the VM, so revalidation is cheap — and a publish always lands
// without hard refresh. Long-lived caching needs versioned URLs (?v=) first.
const STATIC_CACHE_CONTROL = 'no-cache';

const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;

function clearedAuthCookies(): string[] {
  return [
    sessionCookie('cauth', '', { httpOnly: true, expire: true }),
    sessionCookie('crefresh', '', { httpOnly: true, expire: true }),
    sessionCookie('loginUser', 'anonymous'),
  ];
}

/** Cookies of a completed logout: expire cauth/crefresh/loginMsg, loginUser=anonymous. */
export function logoutCookies(): string[] {
  return [
    ...clearedAuthCookies(),
    sessionCookie('loginMsg', '', { httpOnly: true, expire: true }),
  ];
}

const LOGOUT_REVOKE_MS = 2000;

function authBaseUrl(): string {
  return (process.env.COLLAB_AUTH_BASE_URL ?? 'https://auth.collab.codes').replace(/\/$/u, '');
}

export async function revokeCrefresh(
  refreshToken: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const token = refreshToken?.trim();
  if (!token) return;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), LOGOUT_REVOKE_MS);
    try {
      const res = await fetchImpl(`${authBaseUrl()}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: token }),
        signal: ac.signal,
      });
      if (!res.ok) console.warn(`[cbe] logout revoke failed: collab-auth answered ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn(`[cbe] logout revoke failed: ${(err as Error).message}`);
  }
}

async function completeLogout(
  request: FastifyRequest,
  reply: FastifyReply,
  mode: 'redirect' | 'json',
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const session = await resolveSession(request);
  const who = session.email ?? session.testUser ?? 'anonymous';
  console.info(`[cbe] logout (${who})`);
  const cookies = parseCookies(request.headers.cookie as string | undefined);
  await revokeCrefresh(cookies.crefresh, fetchImpl);
  const setCookies = logoutCookies();
  try {
    const state = getLocalTestConfig();
    if (state.enabled) {
      setCookies.push(expiredLocalTestCookie(state.projectId, request.protocol === 'https'));
    }
  } catch {
    console.warn('[cbe] local test session config failed during logout');
    const projectId = readAppEnv().projectId;
    if (projectId) setCookies.push(expiredLocalTestCookie(projectId, request.protocol === 'https'));
  }
  reply.header('set-cookie', setCookies);
  reply.header('Cache-Control', 'no-store');
  if (mode === 'redirect') {
    reply.code(303).header('Location', '/').send();
    return;
  }
  reply.code(CBE_HTTP_OK).send({ statusCode: CBE_HTTP_OK, msg: 'ok' });
}

function sessionCookie(name: string, value: string, options: { httpOnly?: boolean; maxAgeMs?: number; expire?: boolean } = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/'];
  parts.push(options.httpOnly ? 'SameSite=Strict' : 'SameSite=Lax');
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.expire) parts.push(`Expires=${new Date(0).toUTCString()}`);
  else if (options.maxAgeMs) parts.push(`Expires=${new Date(Date.now() + options.maxAgeMs).toUTCString()}`);
  return parts.join('; ');
}

// ── Session resolution ──────────────────────────────────────────────────────
// Order: collab-auth JWT (cauth cookie, validated offline via JWKS) wins; the
// .env test user (CBE_TEST_LOGIN_USER) is the localhost/test fallback; else
// anonymous. Mirrors the central cbe where perfil.user comes from the JWT.
async function resolveSession(request: FastifyRequest): Promise<JwtSession & { testUser?: string }> {
  const cookies = parseCookies(request.headers.cookie as string | undefined);
  const session = await resolveJwtSession(cookies.cauth ?? '', cookies.crefresh ?? '');
  if (session.email) return session;
  const testUser = process.env.CBE_TEST_LOGIN_USER;
  return testUser ? { testUser } : {};
}

function headerString(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function requestHeaderRecord(headers: FastifyRequest['headers']): Record<string, string | string[] | undefined> {
  const record: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string' || Array.isArray(value) || value === undefined) record[key] = value;
  }
  return record;
}

let candidateSchemaStarted = false;
let hubStore: PostgresCandidatePersistence | undefined;

function hubCandidateStore(): PostgresCandidatePersistence {
  if (!hubStore) hubStore = new PostgresCandidatePersistence(getSharedPgPool(readAppEnv()));
  return hubStore;
}

async function handleCandidateProxy(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = request.body as unknown;
  if (!candidateActionAllowed(body)) {
    reply.code(CBE_HTTP_BAD_REQUEST).send({ statusCode: CBE_HTTP_BAD_REQUEST, status: 'error', msg: 'candidate.invalid_action' });
    return;
  }
  const cookies = parseCookies(request.headers.cookie as string | undefined);
  const session = await resolveSession(request);
  // CBE_TEST_LOGIN_USER is never sufficient, in either mode.
  if (candidateHubMode() === 'local') {
    const identity = candidateIdentity({
      email: session.email,
      authorization: headerString(request.headers.authorization),
      userId: headerString(request.headers['x-user-id']),
      orgId: headerString(request.headers['x-org-id']),
      serviceToken: process.env.COLLAB_SERVICE_TOKEN,
    });
    const caller = candidateLocalCaller(identity, session, process.env);
    if (!caller) {
      reply.code(CBE_HTTP_UNAUTHORIZED).send({ statusCode: CBE_HTTP_UNAUTHORIZED, status: 'error', msg: 'candidate.unauthorized' });
      return;
    }
    if (identity.kind === 'jwt' && session.newAccessToken) {
      reply.header('set-cookie', [sessionCookie('cauth', session.newAccessToken, { httpOnly: true, maxAgeMs: THIRTY_DAYS_MS })]);
    }
    try {
      const hubOrgId = candidateHubOrgId(
        readProjectFile(Number(process.env.COLLAB_PROJECT_ID))?.org.orgId ?? null,
        process.env,
      );
      const result = await handleCandidateRevision(
        caller,
        body as Parameters<typeof handleCandidateRevision>[1],
        hubOrgId,
        hubCandidateStore(),
      );
      reply.code(result.statusCode).header('Content-Type', 'application/json; charset=utf-8').header('Cache-Control', 'no-store').send(result);
    } catch (err) {
      console.error('[cbe:candidate] local hub failed:', (err as Error).message);
      reply.code(503).send({ statusCode: 503, status: 'error', msg: 'candidate.transport_unavailable' });
    }
    return;
  }
  // Forward a verified JWT as cauth, or the lima desenv identity from MSG_PROXY_*.
  // Never copy the inbound Authorization.
  if (session.email && session.newAccessToken) {
    reply.header('set-cookie', [sessionCookie('cauth', session.newAccessToken, { httpOnly: true, maxAgeMs: THIRTY_DAYS_MS })]);
  }
  const verifiedToken = session.email ? (session.newAccessToken ?? cookies.cauth ?? '') : '';
  try {
    const result = await proxyCandidateRequest(body, verifiedToken, fetch, process.env);
    reply.code(result.statusCode).header('Content-Type', result.contentType).header('Cache-Control', 'no-store').send(result.body);
  } catch (err) {
    console.error('[cbe:candidate] central transport failed:', (err as Error).message);
    reply.code(503).send({ statusCode: 503, status: 'error', msg: 'candidate.transport_unavailable' });
  }
}

// Studio sources require a JWT session on real domains (102045.collabcodes.com
// etc.); localhost/dev needs none. CBE_REQUIRE_LOGIN=always|never overrides
// the host-based default. The production APP (BFF) is never gated by this —
// only the cbe login's sources/orgs delivery.
function requiresLogin(request: FastifyRequest): boolean {
  const override = process.env.CBE_REQUIRE_LOGIN;
  if (override === 'always') return true;
  if (override === 'never') return false;
  const host = String(request.headers.host ?? '').split(':')[0].toLowerCase();
  return !(host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local') || host === '');
}

// Cookies for the login response. The cfe frontend gates its UI on the
// JS-readable `loginUser`; cauth/crefresh stay httpOnly (set by authSession).
function buildLoginCookies(session: JwtSession & { testUser?: string }): string[] {
  if (session.email) {
    const cookies = [sessionCookie('loginUser', session.email)];
    if (session.newAccessToken) {
      cookies.push(sessionCookie('cauth', session.newAccessToken, { httpOnly: true, maxAgeMs: THIRTY_DAYS_MS }));
    }
    return cookies;
  }

  if (session.testUser) {
    console.warn(`[cbe] TEST session active (CBE_TEST_LOGIN_USER=${session.testUser}) — do not use in production`);
    const cookies = [sessionCookie('loginUser', session.testUser)];
    const cauth = process.env.CBE_TEST_CAUTH;
    if (cauth) cookies.push(sessionCookie('cauth', cauth, { httpOnly: true }));
    const loginMsg = process.env.CBE_TEST_LOGIN_MSG;
    if (loginMsg) cookies.push(sessionCookie('loginMsg', loginMsg, { httpOnly: true }));
    return cookies;
  }

  return [sessionCookie('loginUser', 'anonymous')];
}

// authSession: establish the JWT session from the collab-auth callback tokens
// (the cfe posts them from the URL fragment). Verify before trusting — a bad
// token must never set a session cookie. Same contract as the central cbe.
async function handleAuthSession(body: CbeRequestAuthSession, reply: FastifyReply): Promise<void> {
  if (!isJwtAuthEnabled()) {
    reply.code(CBE_HTTP_BAD_REQUEST).send({ statusCode: CBE_HTTP_BAD_REQUEST, msg: 'JWT auth disabled (AUTH_JWT_ENABLED=false)' });
    return;
  }
  const accessToken = (body.access_token ?? '').trim();
  const refreshToken = (body.refresh_token ?? '').trim();
  if (!accessToken) {
    reply.code(CBE_HTTP_BAD_REQUEST).send({ statusCode: CBE_HTTP_BAD_REQUEST, msg: 'missing access_token' });
    return;
  }

  try {
    const claims = await verifyAccessToken(accessToken);
    const currentOrg = activeOrganizationId(claims);
    const requestedOrg = typeof body.org_id === 'string' ? body.org_id.trim() : '';
    if (!currentOrg && !requestedOrg) {
      reply.code(409).header('set-cookie', clearedAuthCookies()).send({
        statusCode: 409,
        code: 'ORG_SELECTION_REQUIRED',
        msg: 'Select an organization for this session',
        orgs: availableOrganizations(claims),
      });
      return;
    }
    const selectedToken = requestedOrg
      ? await selectOrganization(accessToken, claims, requestedOrg)
      : accessToken;
    if (!selectedToken) {
      reply.code(CBE_HTTP_UNAUTHORIZED).header('set-cookie', clearedAuthCookies()).send({ statusCode: CBE_HTTP_UNAUTHORIZED, code: 'ORG_SELECTION_DENIED', msg: 'Organization selection was not authorized' });
      return;
    }
    const selectedClaims = requestedOrg ? await verifyAccessToken(selectedToken) : claims;
    const cookies = [
      sessionCookie('cauth', selectedToken, { httpOnly: true, maxAgeMs: THIRTY_DAYS_MS }),
      // loginUser here too, so the UI unlocks without waiting for the next login call.
      sessionCookie('loginUser', selectedClaims.email),
    ];
    if (refreshToken) cookies.push(sessionCookie('crefresh', refreshToken, { httpOnly: true, maxAgeMs: THIRTY_DAYS_MS }));
    console.info('[cbe] /exec action:authSession -> organization session established');
    reply.code(CBE_HTTP_OK).header('set-cookie', cookies).send({ statusCode: CBE_HTTP_OK, msg: 'ok' });
  } catch (err) {
    console.info(`[cbe] /exec action:authSession invalid token: ${(err as Error).message}`);
    reply.code(CBE_HTTP_UNAUTHORIZED).header('set-cookie', clearedAuthCookies()).send({ statusCode: CBE_HTTP_UNAUTHORIZED, msg: 'invalid access token' });
  }
}

async function handleAuthLogout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await completeLogout(request, reply, 'json');
}

async function handleExecLogout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await completeLogout(request, reply, 'redirect');
}

// ── Source I/O (VM storage driver) ──────────────────────────────────────────
// Same gate as the login's sources delivery: on a real domain a JWT session is
// required. Writing is stricter — it changes files on the VM's disk, so an
// unauthenticated caller is refused even where reading would be allowed.
async function isSourceRequestAllowed(request: FastifyRequest): Promise<boolean> {
  if (!requiresLogin(request)) return true;
  const session = await resolveSession(request);
  return Boolean(session.email);
}

function readProjectId(body: { project?: number }): number | null {
  const project = Number(body.project);
  return Number.isInteger(project) && project > 0 ? project : null;
}

function draftBody(draft: RequestDraft | null): { slug: string; branch: string } | null {
  return draft ? { slug: draft.slug, branch: draft.branch } : null;
}

async function handleGetContents(request: FastifyRequest, body: CbeRequestGetContents, reply: FastifyReply): Promise<void> {
  if (!await isSourceRequestAllowed(request)) {
    reply.code(CBE_HTTP_UNAUTHORIZED).send({ statusCode: CBE_HTTP_UNAUTHORIZED, msg: 'login required' });
    return;
  }
  const project = readProjectId(body);
  if (!project || !Array.isArray(body.shortPaths)) {
    reply.code(CBE_HTTP_BAD_REQUEST).send({ statusCode: CBE_HTTP_BAD_REQUEST, msg: 'invalid project or shortPaths' });
    return;
  }
  const draft = await resolveRequestDraft(request.headers.cookie as string | undefined, getProjectsBaseDir(), project);
  const files = readSources(project, body.shortPaths, draft?.sourceRoot);
  reply.code(CBE_HTTP_OK).send({ statusCode: CBE_HTTP_OK, msg: 'ok', files, draft: draftBody(draft) });
}

/** Route tests replace these so a draft save does not spawn Deno. */
export const draftDevHooks = {
  restartDevProcess,
  ensureDevReaper,
};

async function handleSetContents(request: FastifyRequest, body: CbeRequestSetContents, reply: FastifyReply): Promise<void> {
  if (!await isSourceRequestAllowed(request)) {
    reply.code(CBE_HTTP_UNAUTHORIZED).send({ statusCode: CBE_HTTP_UNAUTHORIZED, msg: 'login required' });
    return;
  }
  const project = readProjectId(body);
  if (!project) {
    reply.code(CBE_HTTP_BAD_REQUEST).send({ statusCode: CBE_HTTP_BAD_REQUEST, msg: 'invalid project' });
    return;
  }
  const draft = await resolveRequestDraft(request.headers.cookie as string | undefined, getProjectsBaseDir(), project);
  const rc = writeSources(project, body.files ?? [], body.deletes ?? [], { sourceRoot: draft?.sourceRoot });
  if (!rc.ok) {
    reply.code(CBE_HTTP_BAD_REQUEST).send({ statusCode: CBE_HTTP_BAD_REQUEST, msg: rc.msg ?? 'invalid request' });
    return;
  }
  // Commit BEFORE scheduling the rebuild: the build reads each file's versionRef
  // from `git ls-tree -r HEAD`, so a build that runs on an uncommitted write
  // republishes the OLD versionRef and the browser keeps its cached source (see
  // cbeGitCommit.ts). It is also what puts these edits in getHistory. Awaited,
  // never fatal — the files are already on disk. `sourceRoot` is the draft
  // worktree; omitted, the commit stays on the project's current branch.
  const session = await resolveSession(request);
  const commit = await commitSavedSources(project, rc.paths, {
    comments: body.comments ?? undefined,
    author: authorFromSession(session.email ?? session.testUser),
    sourceRoot: draft?.sourceRoot,
  });
  if (commit.status === 'failed') {
    console.warn(`[cbe] setContents project ${project}: commit failed (save kept, versionRef will not move): ${commit.msg}`);
  } else if (commit.status === 'committed') {
    console.info(`[cbe] setContents project ${project}: committed ${commit.ref?.slice(0, 8)}`);
  }
  // Fire-and-forget: debounced, cross-worker-safe rebuild+redeploy (see
  // cbeRebuildOnSave.ts). Never blocks this response. The project goes along so
  // its obj/compiled.zip is refreshed — `pnpm build` alone skips it whenever the
  // project is inside the release fecho, which the VM's own app always is.
  // A draft commit stays on its branch: no release rebuild.
  if (draft) {
    console.info(`[cbe] draft ${draft.slug}: no release rebuild`);
    const base = getProjectsBaseDir();
    draftDevHooks.ensureDevReaper(base);
    const files = body.files ?? [];
    const deletes = body.deletes ?? [];
    const l1Changed = files.some((file) => file.shortPath.startsWith('l1/'))
      || deletes.some((shortPath) => shortPath.startsWith('l1/'));
    // l2/l3 are served from the Studio cache; only an l1 change needs a new dev process.
    if (!l1Changed) {
      console.info(`[cbe] draft ${draft.slug}: l2/l3 only, no restart`);
    } else {
      // Fire-and-forget: the save responds before the debounced restart. A rejection
      // (or a sync throw from an invalid slug) is logged and never fails this handler.
      try {
        void draftDevHooks.restartDevProcess({
          base,
          slug: draft.slug,
          clientProjectId: project,
        }).catch((err: unknown) => {
          console.error(`[cbe] draft ${draft.slug}: dev restart failed: ${(err as Error).message}`);
        });
      } catch (err) {
        console.error(`[cbe] draft ${draft.slug}: dev restart failed: ${(err as Error).message}`);
      }
    }
  } else {
    scheduleRebuildOnSave(project);
  }
  reply.code(CBE_HTTP_OK).send({ statusCode: CBE_HTTP_OK, msg: 'ok', commit, draft: draftBody(draft) });
}

async function handleLoadFilesInfo(request: FastifyRequest, body: CbeRequestLoadFilesInfo, reply: FastifyReply): Promise<void> {
  if (!await isSourceRequestAllowed(request)) {
    reply.code(CBE_HTTP_UNAUTHORIZED).send({ statusCode: CBE_HTTP_UNAUTHORIZED, msg: 'login required' });
    return;
  }
  const project = readProjectId(body);
  if (!project) {
    reply.code(CBE_HTTP_BAD_REQUEST).send({ statusCode: CBE_HTTP_BAD_REQUEST, msg: 'invalid project' });
    return;
  }
  const draft = await resolveRequestDraft(request.headers.cookie as string | undefined, getProjectsBaseDir(), project);
  reply.code(CBE_HTTP_OK).send({ statusCode: CBE_HTTP_OK, msg: 'ok', filesInfo: listSources(project, draft?.sourceRoot), draft: draftBody(draft) });
}

// History is source code: the same session gate the read actions use applies.
async function handleGetHistory(request: FastifyRequest, body: CbeRequestGetHistory, reply: FastifyReply): Promise<void> {
  if (!await isSourceRequestAllowed(request)) {
    reply.code(CBE_HTTP_UNAUTHORIZED).send({ statusCode: CBE_HTTP_UNAUTHORIZED, msg: 'login required' });
    return;
  }
  const project = readProjectId(body);
  if (!project || typeof body.shortPath !== 'string') {
    reply.code(CBE_HTTP_BAD_REQUEST).send({ statusCode: CBE_HTTP_BAD_REQUEST, msg: 'invalid project or shortPath' });
    return;
  }
  const draft = await resolveRequestDraft(request.headers.cookie as string | undefined, getProjectsBaseDir(), project);
  // A project without .git, an untracked file or a rejected path all mean "no
  // history" — an empty list, not an error: the studio must degrade quietly.
  reply.code(CBE_HTTP_OK).send({
    statusCode: CBE_HTTP_OK,
    msg: 'ok',
    history: readHistory(project, body.shortPath, draft?.sourceRoot),
    draft: draftBody(draft),
  });
}

async function handleGetHistoryContent(request: FastifyRequest, body: CbeRequestGetHistoryContent, reply: FastifyReply): Promise<void> {
  if (!await isSourceRequestAllowed(request)) {
    reply.code(CBE_HTTP_UNAUTHORIZED).send({ statusCode: CBE_HTTP_UNAUTHORIZED, msg: 'login required' });
    return;
  }
  const project = readProjectId(body);
  if (!project || typeof body.shortPath !== 'string' || typeof body.ref !== 'string') {
    reply.code(CBE_HTTP_BAD_REQUEST).send({ statusCode: CBE_HTTP_BAD_REQUEST, msg: 'invalid project, shortPath or ref' });
    return;
  }
  const draft = await resolveRequestDraft(request.headers.cookie as string | undefined, getProjectsBaseDir(), project);
  // An unacceptable ref (the UI's 'local' sentinel, anything non-hex) comes back
  // as null content, not 400: the diff panel asks for it on an ordinary click.
  const content = readHistoryContent(project, body.shortPath, body.ref, draft?.sourceRoot);
  reply.code(CBE_HTTP_OK).send({ statusCode: CBE_HTTP_OK, msg: 'ok', content, draft: draftBody(draft) });
}

// GET /cbe/source?project=<id>&path=<shortPath> — the file as the VM has it.
//
// This is what the editor's "View on repository" opens here: on the VM the
// repository IS the VM, and DriverIOBase.getUrl is SYNCHRONOUS, so the driver
// can only return a url it can build client-side — a same-origin one. Reads the
// tree through readSources, so it shows exactly what getContents serves, and
// goes through the same session gate and the same path boundary as /exec.
async function handleSourceView(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!await isSourceRequestAllowed(request)) {
    reply.code(CBE_HTTP_UNAUTHORIZED).type('text/plain; charset=utf-8').send('login required');
    return;
  }
  const query = request.query as { project?: string; path?: string };
  const project = Number(query.project);
  if (!Number.isInteger(project) || project <= 0 || typeof query.path !== 'string' || !query.path) {
    reply.code(CBE_HTTP_BAD_REQUEST).type('text/plain; charset=utf-8').send('invalid project or path');
    return;
  }
  const draft = await resolveRequestDraft(request.headers.cookie as string | undefined, getProjectsBaseDir(), project);

  // readSources drops a rejected path and a missing file alike — both are "not
  // here" to a reader, and telling them apart would report on the file system.
  const [file] = readSources(project, [query.path], draft?.sourceRoot);
  if (!file) {
    reply.code(CBE_HTTP_NOT_FOUND).type('text/plain; charset=utf-8').send('not found');
    return;
  }
  if (file.encoding === 'base64') {
    // An l3 asset: hand it over as bytes instead of showing base64 as if it were the file.
    reply.code(CBE_HTTP_OK).type('application/octet-stream').send(Buffer.from(file.content, 'base64'));
    return;
  }
  // text/plain so the browser shows the source instead of downloading it.
  reply.code(CBE_HTTP_OK).type('text/plain; charset=utf-8').send(file.content);
}

/** Publish claim shared by both pm2 workers. Alive until the rebuild lock appears, or 30s. */
interface PromoteInFlight {
  project: number;
  draft: string;
  startedAt: string;
}

/** Written when a claim expires and the rebuild never started. `ping` returns it. */
interface LastPromote {
  status: 'rebuild-not-started';
  project: number;
  draft: string;
  at: string;
}

const PROMOTE_IN_FLIGHT_FILE = '.promote-in-flight.json';
const LAST_PROMOTE_FILE = '.last-promote.json';
const PROMOTE_IN_FLIGHT_MS = 30_000;

function buildPromoteInFlight(project: number, draft: string, startedAt: string): PromoteInFlight {
  return { project, draft, startedAt };
}

function buildLastPromote(project: number, draft: string, at: string): LastPromote {
  return { status: 'rebuild-not-started', project, draft, at };
}

/** Route tests replace these so a promote does not start a release build. */
export const promoteRouteHooks = {
  scheduleRebuildOnSave,
  isRebuildInProgress,
  promoteStateDir: (): string => getProjectsBaseDir(),
  now: (): number => Date.now(),
};

interface DraftDbDrop {
  dropDatabase(adminUrl: string, name: string): Promise<void>;
}

const DRAFT_DATABASE_NAME = /^[a-z0-9_]+$/u;

/** Route tests replace `dropDatabase` so a discard does not open Postgres. */
export const draftDbHooks: DraftDbDrop = {
  dropDatabase: dropDraftDatabase,
};

async function dropDraftDatabase(adminUrl: string, name: string): Promise<void> {
  if (!DRAFT_DATABASE_NAME.test(name)) {
    console.error(`[cbe] discard draft: invalid database name`);
    throw new Error('invalid database name');
  }
  const admin = new Pool({ connectionString: adminUrl });
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    try {
      await admin.end();
    } catch (err) {
      console.error(`[cbe] discard draft: closing admin connection failed: ${(err as Error).message}`);
    }
  }
}

interface DiscardedDraftBody {
  statusCode: number;
  status: 'discarded';
  databaseDropped: boolean;
  cause?: string;
}

function buildDiscardedDraftBody(
  drop: { databaseDropped: true } | { databaseDropped: false; cause: string },
): DiscardedDraftBody {
  if (drop.databaseDropped) {
    return { statusCode: CBE_HTTP_OK, status: 'discarded', databaseDropped: true };
  }
  return { statusCode: CBE_HTTP_OK, status: 'discarded', databaseDropped: false, cause: drop.cause };
}

async function discardDraftDatabase(
  slug: string,
): Promise<{ databaseDropped: true } | { databaseDropped: false; cause: string }> {
  const testUrl = process.env.DATABASE_URL_TEST;
  if (!testUrl) {
    const cause = 'DATABASE_URL_TEST is not set';
    console.error(`[cbe] discard draft ${slug}: ${cause}`);
    return { databaseDropped: false, cause };
  }
  let parsed: { database: string; adminUrl: string } | null;
  try {
    parsed = parseDatabaseUrl(draftDatabaseUrl(testUrl, slug));
  } catch (err) {
    const cause = (err as Error).message || String(err);
    console.error(`[cbe] discard draft ${slug}: ${cause}`);
    return { databaseDropped: false, cause };
  }
  if (!parsed) {
    const cause = 'invalid database url';
    console.error(`[cbe] discard draft ${slug}: ${cause}`);
    return { databaseDropped: false, cause };
  }
  try {
    await draftDbHooks.dropDatabase(parsed.adminUrl, parsed.database);
  } catch (err) {
    const cause = (err as Error).message || String(err);
    console.error(`[cbe] discard draft ${slug}: drop database ${parsed.database} failed: ${cause}`);
    return { databaseDropped: false, cause };
  }
  return { databaseDropped: true };
}

function promoteInFlightPath(): string {
  return join(promoteRouteHooks.promoteStateDir(), PROMOTE_IN_FLIGHT_FILE);
}

function lastPromotePath(): string {
  return join(promoteRouteHooks.promoteStateDir(), LAST_PROMOTE_FILE);
}

function isPromoteInFlight(value: Partial<PromoteInFlight> | null): value is PromoteInFlight {
  return !!value
    && Number.isInteger(value.project)
    && typeof value.draft === 'string'
    && typeof value.startedAt === 'string'
    && Number.isFinite(Date.parse(value.startedAt));
}

/** `null` when the file is absent. `'corrupt'` when it is there but unusable. */
function readPromoteFile(): PromoteInFlight | null | 'corrupt' {
  const path = promoteInFlightPath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.warn(`[cbe] promote in-flight unreadable: ${(err as Error).message}`);
    return 'corrupt';
  }
  try {
    const value = JSON.parse(raw) as Partial<PromoteInFlight>;
    if (!isPromoteInFlight(value)) {
      console.warn('[cbe] promote in-flight file has an invalid shape');
      return 'corrupt';
    }
    return value;
  } catch (err) {
    console.warn(`[cbe] promote in-flight file is not json: ${(err as Error).message}`);
    return 'corrupt';
  }
}

/**
 * The claim the panel should show, or null. Reading is what retires it:
 * a rebuild in progress takes over, and 30s without one records `lastPromote`.
 */
function readLivePromote(): PromoteInFlight | null {
  const record = readPromoteFile();
  if (record === null) return null;
  if (record === 'corrupt') {
    rmSync(promoteInFlightPath(), { force: true });
    return null;
  }
  if (promoteRouteHooks.isRebuildInProgress()) {
    rmSync(promoteInFlightPath(), { force: true });
    return null;
  }
  if (promoteRouteHooks.now() - Date.parse(record.startedAt) >= PROMOTE_IN_FLIGHT_MS) {
    const last = buildLastPromote(record.project, record.draft, new Date(promoteRouteHooks.now()).toISOString());
    rmSync(promoteInFlightPath(), { force: true });
    try {
      writeFileSync(lastPromotePath(), JSON.stringify(last));
    } catch (err) {
      console.warn(`[cbe] could not record last promote: ${(err as Error).message}`);
    }
    return null;
  }
  return record;
}

function readLastPromote(): LastPromote | null {
  const path = lastPromotePath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[cbe] last promote unreadable: ${(err as Error).message}`);
    }
    return null;
  }
  try {
    const value = JSON.parse(raw) as Partial<LastPromote>;
    if (value.status !== 'rebuild-not-started' || !Number.isInteger(value.project) || typeof value.draft !== 'string' || typeof value.at !== 'string') {
      console.warn('[cbe] last promote file has an invalid shape — removing it');
      rmSync(path, { force: true });
      return null;
    }
    return value as LastPromote;
  } catch (err) {
    console.warn(`[cbe] last promote file is not json — removing it: ${(err as Error).message}`);
    rmSync(path, { force: true });
    return null;
  }
}

function tryClaimPromote(record: PromoteInFlight): 'ok' | 'eexist' | 'error' {
  let fd: number;
  try {
    fd = openSync(promoteInFlightPath(), 'wx');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return 'eexist';
    console.warn(`[cbe] promote project ${record.project}: claim failed: ${(err as Error).message}`);
    return 'error';
  }
  try {
    writeSync(fd, JSON.stringify(record));
  } catch (err) {
    console.warn(`[cbe] promote project ${record.project}: claim write failed: ${(err as Error).message}`);
    closeSync(fd);
    rmSync(promoteInFlightPath(), { force: true });
    return 'error';
  }
  closeSync(fd);
  return 'ok';
}

/** Drops the file only when it is still the claim this request created. */
function releaseClaim(record: PromoteInFlight): void {
  const current = readPromoteFile();
  if (current === null) return;
  if (current === 'corrupt' || current.project !== record.project || current.draft !== record.draft || current.startedAt !== record.startedAt) {
    console.warn(`[cbe] promote project ${record.project}: in-flight file is not this claim — leaving it`);
    return;
  }
  rmSync(promoteInFlightPath(), { force: true });
}

function replyPromoteBlocked(reply: FastifyReply, code: 'REBUILD_BUSY' | 'PROMOTE_IN_PROGRESS'): void {
  reply.code(409).send({ statusCode: 409, code });
}

/** `true` once this request owns the file. One retry when the file on disk has expired. */
function claimPromote(record: PromoteInFlight, reply: FastifyReply): boolean {
  const first = takePromoteClaim(record, reply);
  if (first !== 'retry') return first === 'ok';
  const second = takePromoteClaim(record, reply);
  if (second === 'retry') {
    console.warn(`[cbe] promote project ${record.project}: in-flight file still blocked after one retry`);
    replyPromoteBlocked(reply, 'PROMOTE_IN_PROGRESS');
    return false;
  }
  return second === 'ok';
}

function takePromoteClaim(record: PromoteInFlight, reply: FastifyReply): 'ok' | 'retry' | 'rejected' {
  const attempt = tryClaimPromote(record);
  if (attempt === 'ok') return 'ok';
  if (attempt === 'error') {
    reply.code(CBE_HTTP_SERVER_ERROR).send({ statusCode: CBE_HTTP_SERVER_ERROR, code: 'PROMOTE_CLAIM_FAILED' });
    return 'rejected';
  }
  const live = readLivePromote();
  if (live) {
    console.warn(`[cbe] promote project ${record.project}: another promote is in flight for ${live.project}/${live.draft}`);
    replyPromoteBlocked(reply, 'PROMOTE_IN_PROGRESS');
    return 'rejected';
  }
  if (promoteRouteHooks.isRebuildInProgress()) {
    console.warn(`[cbe] promote project ${record.project}: rebuild took the in-flight promote`);
    replyPromoteBlocked(reply, 'REBUILD_BUSY');
    return 'rejected';
  }
  return 'retry';
}

async function requireSourceProject(
  request: FastifyRequest,
  body: { project?: number },
  reply: FastifyReply,
): Promise<number | null> {
  if (!await isSourceRequestAllowed(request)) {
    reply.code(CBE_HTTP_UNAUTHORIZED).send({ statusCode: CBE_HTTP_UNAUTHORIZED, msg: 'login required' });
    return null;
  }
  const project = readProjectId(body);
  if (!project) {
    reply.code(CBE_HTTP_BAD_REQUEST).send({ statusCode: CBE_HTTP_BAD_REQUEST, msg: 'invalid project' });
    return null;
  }
  return project;
}

function replyGitFailure(
  reply: FastifyReply,
  result: { status: number; code: string; files?: string[] },
): void {
  reply.code(result.status).send({
    statusCode: result.status,
    code: result.code,
    ...('files' in result ? { files: result.files } : {}),
  });
}

async function handlePromote(request: FastifyRequest, body: CbeRequestPromote, reply: FastifyReply): Promise<void> {
  const project = await requireSourceProject(request, body, reply);
  if (!project) return;

  if (body.target !== 'production') {
    const code = body.target === 'homolog' ? 'NOT_YET' : 'BAD_TARGET';
    console.warn(`[cbe] promote project ${project}: rejected target ${String(body.target)} (${code})`);
    reply.code(CBE_HTTP_BAD_REQUEST).send({ statusCode: CBE_HTTP_BAD_REQUEST, code });
    return;
  }

  // Before any git: a rebuild already running must not start a second release.
  if (promoteRouteHooks.isRebuildInProgress()) {
    console.warn(`[cbe] promote project ${project}: rebuild in progress`);
    replyPromoteBlocked(reply, 'REBUILD_BUSY');
    return;
  }

  const session = await resolveSession(request);
  const slug = typeof body.draft === 'string' ? body.draft : '';
  const comment = typeof body.comment === 'string' ? body.comment : '';
  const claim = buildPromoteInFlight(project, slug, new Date(promoteRouteHooks.now()).toISOString());
  if (!claimPromote(claim, reply)) return;

  let result;
  try {
    result = await promoteDraft({
      base: getProjectsBaseDir(),
      projectId: project,
      slug,
      author: authorFromSession(session.email),
      comment,
    });
  } catch (err) {
    releaseClaim(claim);
    throw err;
  }
  if (result.status !== 'merged') releaseClaim(claim);

  if (result.status === 'merged') {
    promoteRouteHooks.scheduleRebuildOnSave(project);
    reply.code(CBE_HTTP_OK).send({
      statusCode: CBE_HTTP_OK,
      status: 'merged',
      ref: result.ref,
      release: 'scheduled',
    });
    return;
  }
  if (typeof result.status === 'number') {
    replyGitFailure(reply, result);
    return;
  }
  reply.code(CBE_HTTP_OK).send({ statusCode: CBE_HTTP_OK, status: result.status });
}

async function handleDiscardDraft(request: FastifyRequest, body: CbeRequestDiscardDraft, reply: FastifyReply): Promise<void> {
  const project = await requireSourceProject(request, body, reply);
  if (!project) return;
  const slug = typeof body.draft === 'string' ? body.draft : '';
  const base = getProjectsBaseDir();
  const result = await discardDraft({ base, projectId: project, slug });
  if (typeof result.status === 'number') {
    replyGitFailure(reply, result);
    return;
  }
  try {
    stopDevProcess(base, slug);
  } catch (err) {
    console.error(`[cbe] discard draft ${slug}: stop dev process failed: ${(err as Error).message}`);
  }
  const drop = await discardDraftDatabase(slug);
  reply.code(CBE_HTTP_OK).send(buildDiscardedDraftBody(drop));
}

async function handleListDrafts(request: FastifyRequest, body: CbeRequestListDrafts, reply: FastifyReply): Promise<void> {
  const project = await requireSourceProject(request, body, reply);
  if (!project) return;
  const result = await listDrafts({ base: getProjectsBaseDir(), projectId: project });
  if (typeof result.status === 'number') {
    replyGitFailure(reply, result);
    return;
  }
  reply.code(CBE_HTTP_OK).send({ statusCode: CBE_HTTP_OK, status: 'listed', drafts: result.drafts });
}

async function handleDraftDiff(request: FastifyRequest, body: CbeRequestDraftDiff, reply: FastifyReply): Promise<void> {
  const project = await requireSourceProject(request, body, reply);
  if (!project) return;
  const result = await draftDiff({
    base: getProjectsBaseDir(),
    projectId: project,
    slug: typeof body.draft === 'string' ? body.draft : '',
    shortPath: typeof body.shortPath === 'string' ? body.shortPath : undefined,
  });
  if (typeof result.status === 'number') {
    replyGitFailure(reply, result);
    return;
  }
  reply.code(CBE_HTTP_OK).send({ statusCode: CBE_HTTP_OK, status: 'diff', text: result.text });
}

async function handleExec(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = request.body as CbeRequestBase | undefined;
  if (!body || typeof body !== 'object' || Array.isArray(body) || !body.action) {
    reply.code(CBE_HTTP_BAD_REQUEST).send({ statusCode: CBE_HTTP_BAD_REQUEST, msg: 'invalid body, no action' });
    return;
  }

  reply.header('x-cbe-version', CBE_MODULE_VERSION);
  try {
    switch (body.action) {
      case 'ping':
        // Enough for a browser to tell whether the save it just made is live:
        // `release` is the identity of THIS worker (stable while it runs), `pid`
        // says which of the two cluster workers answered, and `rebuilding` is read
        // from disk on the spot. A release id that changed means a new release is
        // being served; unchanged after rebuilding goes false means the build failed.
        // `promoting` is the publish in flight (the file, so both workers agree), or null.
        // `lastPromote` is set when that claim expired and the rebuild never started.
        reply.code(CBE_HTTP_OK).send({
          statusCode: CBE_HTTP_OK,
          msg: 'pong',
          version: CBE_MODULE_VERSION,
          pid: process.pid,
          release: getRunningRelease(),
          rebuilding: isRebuildInProgress(),
          promoting: readLivePromote(),
          lastPromote: readLastPromote(),
        });
        return;
      case 'authSession':
        await handleAuthSession(body as CbeRequestAuthSession, reply);
        return;
      case 'authLogout':
        await handleAuthLogout(request, reply);
        return;
      case 'getContents':
        await handleGetContents(request, body as CbeRequestGetContents, reply);
        return;
      case 'setContents':
        await handleSetContents(request, body as CbeRequestSetContents, reply);
        return;
      case 'loadFilesInfo':
        await handleLoadFilesInfo(request, body as CbeRequestLoadFilesInfo, reply);
        return;
      case 'getHistory':
        await handleGetHistory(request, body as CbeRequestGetHistory, reply);
        return;
      case 'getHistoryContent':
        await handleGetHistoryContent(request, body as CbeRequestGetHistoryContent, reply);
        return;
      case 'promote':
        await handlePromote(request, body as CbeRequestPromote, reply);
        return;
      case 'discardDraft':
        await handleDiscardDraft(request, body as CbeRequestDiscardDraft, reply);
        return;
      case 'listDrafts':
        await handleListDrafts(request, body as CbeRequestListDrafts, reply);
        return;
      case 'draftDiff':
        await handleDraftDiff(request, body as CbeRequestDraftDiff, reply);
        return;
      case 'login': {
        const start = Date.now();
        const session = await resolveSession(request);
        const mustLogin = requiresLogin(request);
        // A verified JWT stays on the existing path. Otherwise a valid local-test
        // cookie names the person; a rejected cookie is anonymous and must not
        // fall through to CBE_TEST_LOGIN_USER (that user writes a fake cauth).
        const localTest = session.email ? undefined : localTestSessionFromHeaders(requestHeaderRecord(request.headers));
        const localOk = localTest?.kind === 'ok' ? localTest : undefined;
        const testUser = localTest?.kind === 'reject' ? undefined : session.testUser;
        // The .env test user is a localhost convenience — on a real domain
        // ONLY a valid collab-auth JWT authenticates.
        const authenticated = Boolean(session.email || (!mustLogin && testUser));
        if (mustLogin && !authenticated) {
          // Real domain without a JWT session: answer the login shape the cfe
          // expects, but with NO orgs/sources — the studio stays locked until
          // authSession establishes the collab-auth JWT. The app itself keeps
          // working (BFF routes are not part of /exec).
          console.info('[cbe] /exec action:login -> anonymous denied (login required on this host)');
          reply.header('set-cookie', [sessionCookie('loginUser', 'anonymous')]);
          reply.code(CBE_HTTP_OK).header('Content-Type', 'text/json; charset=utf-8').send({
            statusCode: CBE_HTTP_OK,
            msg: 'login required',
            services: [], orgs: {}, inits: {}, providers: [],
            avatar_url: '', baseProject: (body as CbeRequestLogin).baseProject ?? 0,
            alertMessage: '', errorMessage: 'Login required on this domain.',
          });
          return;
        }
        if (localOk) {
          const email = localOk.claims.email;
          const rc = executeCbeLogin(body as CbeRequestLogin, email, session.picture);
          console.info(`[cbe] /exec action:login (${email}) -> ${rc.statusCode} in ${Date.now() - start}ms`);
          reply.header('set-cookie', [
            sessionCookie('loginUser', email),
            sessionCookie('cauth', '', { httpOnly: true, expire: true }),
            sessionCookie('loginMsg', '', { httpOnly: true, expire: true }),
          ]);
          reply
            .code(rc.statusCode)
            .header('Content-Type', 'text/json; charset=utf-8')
            .header('Cache-Control', 'no-cache')
            .send(rc);
          return;
        }
        const loginSession = session.email ? session : { ...session, testUser };
        const rc = executeCbeLogin(body as CbeRequestLogin, session.email ?? testUser, session.picture);
        console.info(`[cbe] /exec action:login (${session.email ?? testUser ?? 'anonymous'}) -> ${rc.statusCode} in ${Date.now() - start}ms`);
        reply.header('set-cookie', buildLoginCookies(loginSession));
        reply
          .code(rc.statusCode)
          .header('Content-Type', 'text/json; charset=utf-8')
          .header('Cache-Control', 'no-cache')
          .send(rc);
        return;
      }
      default:
        console.info(`[cbe] /exec unsupported action: ${body.action}`);
        reply.code(CBE_HTTP_BAD_REQUEST).send({
          statusCode: CBE_HTTP_BAD_REQUEST,
          msg: `action "${body.action}" is not handled by the runtime cbe module (only login/authSession/authLogout and the source I/O actions run on the VM)`,
        });
        return;
    }
  } catch (err) {
    console.error('[cbe] /exec error:', err);
    reply.code(CBE_HTTP_SERVER_ERROR).send({
      statusCode: CBE_HTTP_SERVER_ERROR,
      msg: `Abend: ${(err as Error).message || String(err)}`,
    });
  }
}

async function handleStatic(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const clientETag = (request.headers['if-none-match'] as string | undefined) ?? '';
  const rc = await getCbeStaticFile(request.raw.url ?? '', clientETag, draftSlugForProxy(request.headers.cookie));

  if (rc.statusCode === CBE_HTTP_NOT_MODIFIED) {
    reply.code(CBE_HTTP_NOT_MODIFIED).send();
    return;
  }
  if (rc.statusCode !== CBE_HTTP_OK || !rc.content) {
    reply.code(rc.statusCode).send({ statusCode: rc.statusCode, msg: rc.msg ?? 'error' });
    return;
  }

  reply
    .code(CBE_HTTP_OK)
    .header('Content-Type', rc.contentType ?? 'application/octet-stream')
    .header('Cache-Control', STATIC_CACHE_CONTROL)
    .header('ETag', `"${rc.eTag}"`)
    .send(rc.content);
}

export function registerCbeRoutes(app: FastifyInstance): void {
  desenvIo.isAllowed = isSourceRequestAllowed;
  app.post('/exec', handleExec);
  app.get('/exec/logout', handleExecLogout);
  app.post('/exec/candidate', { bodyLimit: CANDIDATE_BODY_LIMIT }, handleCandidateProxy);
  app.get('/desenv/sair', handleDesenvExit);
  app.get('/desenv', handleDesenvEnter);
  app.get('/cbe/source', handleSourceView);
  app.get('/libs/*', handleStatic);
  app.get('/monaco/*', handleStatic);
  app.get('/mlsServiceWorker.js', handleStatic);
  console.info(`[cbe] v${CBE_MODULE_VERSION} routes registered: POST /exec (login/authSession/authLogout/getContents/setContents/loadFilesInfo/getHistory/getHistoryContent/promote/discardDraft/listDrafts/draftDiff), GET /exec/logout, POST /exec/candidate, GET /desenv, GET /desenv/sair, GET /cbe/source, GET /libs/*, GET /monaco/*, GET /mlsServiceWorker.js`);
  if (candidateHubMode() === 'local') {
    if (!candidateSchemaStarted) {
      candidateSchemaStarted = true;
      void ensureCandidateSchema(getSharedPgPool(readAppEnv())).catch((err) => {
        console.error('[cbe:candidate] schema ensure failed:', (err as Error).message);
      });
    }
    console.info('[cbe] candidate: local hub');
  } else {
    console.info(`[cbe] candidate: forward to ${candidateOrigin()}`);
  }
  logCbeStaticConfig();
  console.info(`[cbe] projects base: ${getProjectsBaseDir()} | jwtAuth: ${isJwtAuthEnabled() ? 'enabled' : 'DISABLED'}${process.env.CBE_TEST_LOGIN_USER ? ` | TEST user: ${process.env.CBE_TEST_LOGIN_USER}` : ''}`);
}
