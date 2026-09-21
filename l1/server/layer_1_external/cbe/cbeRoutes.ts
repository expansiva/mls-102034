/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeRoutes.ts" enhancement="_blank" />
// Fastify wiring for the cbe-compatible endpoints on the runtime VM:
//   POST /exec               -> action dispatcher (login/authSession/authLogout; admin actions stay central)
//   GET  /libs/*             -> mls lib assets (disk cache + remote origin)
//   GET  /monaco/*           -> monaco editor assets (disk cache + remote origin)
//   GET  /mlsServiceWorker.js
// Kept apart from the app/BFF routes on purpose — everything cbe-related lives
// in this folder so it can later move to a release-packaged module untouched.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { executeCbeLogin } from '/_102034_/l1/server/layer_1_external/cbe/cbeLogin.js';
import { getProjectsBaseDir } from '/_102034_/l1/server/layer_1_external/cbe/cbeCompiledLocal.js';
import { getCbeStaticFile, logCbeStaticConfig } from '/_102034_/l1/server/layer_1_external/cbe/cbeStaticFiles.js';
import {
  isJwtAuthEnabled,
  parseCookies,
  resolveJwtSession,
  verifyAccessToken,
  type JwtSession,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeAuthJwt.js';
import { listSources, readSources, writeSources } from '/_102034_/l1/server/layer_1_external/cbe/cbeSources.js';
import { CANDIDATE_BODY_LIMIT, candidateActionAllowed, proxyCandidateRequest } from '/_102034_/l1/server/layer_1_external/cbe/cbeCandidateProxy.js';
import { readHistory, readHistoryContent } from '/_102034_/l1/server/layer_1_external/cbe/cbeGit.js';
import { isRebuildInProgress, scheduleRebuildOnSave } from '/_102034_/l1/server/layer_1_external/cbe/cbeRebuildOnSave.js';
import { authorFromSession, commitSavedSources } from '/_102034_/l1/server/layer_1_external/cbe/cbeGitCommit.js';
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
  type CbeRequestGetContents,
  type CbeRequestGetHistory,
  type CbeRequestGetHistoryContent,
  type CbeRequestLoadFilesInfo,
  type CbeRequestLogin,
  type CbeRequestSetContents,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeTypes.js';

// Bump on every change to the cbe module. Exposed via the x-cbe-version
// response header and the {action:'ping'} probe so a deploy can be verified:
//   curl -s localhost:3000/exec -H 'Content-Type: application/json' -d '{"action":"ping"}'
export const CBE_MODULE_VERSION = '1.8.0';

// no-cache = always revalidate with the ETag (304 when unchanged). The server
// is local to the VM, so revalidation is cheap — and a publish always lands
// without hard refresh. Long-lived caching needs versioned URLs (?v=) first.
const STATIC_CACHE_CONTROL = 'no-cache';

const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;

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

async function handleCandidateProxy(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = request.body as unknown;
  if (!candidateActionAllowed(body)) {
    reply.code(CBE_HTTP_BAD_REQUEST).send({ statusCode: CBE_HTTP_BAD_REQUEST, status: 'error', msg: 'candidate.invalid_action' });
    return;
  }
  const cookies = parseCookies(request.headers.cookie as string | undefined);
  const session = await resolveSession(request);
  // CBE_TEST_LOGIN_USER is never sufficient. Forward only a JWT which this host
  // verified (or its newly refreshed replacement), never raw request headers.
  const verifiedToken = session.email ? session.newAccessToken ?? cookies.cauth ?? '' : '';
  if (!verifiedToken) {
    reply.code(CBE_HTTP_UNAUTHORIZED).send({ statusCode: CBE_HTTP_UNAUTHORIZED, status: 'error', msg: 'candidate.unauthorized' });
    return;
  }
  try {
    const result = await proxyCandidateRequest(body, verifiedToken);
    if (session.newAccessToken) {
      reply.header('set-cookie', [sessionCookie('cauth', session.newAccessToken, { httpOnly: true, maxAgeMs: THIRTY_DAYS_MS })]);
    }
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
    const cookies = [
      sessionCookie('cauth', accessToken, { httpOnly: true, maxAgeMs: THIRTY_DAYS_MS }),
      // loginUser here too, so the UI unlocks without waiting for the next login call.
      sessionCookie('loginUser', claims.email),
    ];
    if (refreshToken) cookies.push(sessionCookie('crefresh', refreshToken, { httpOnly: true, maxAgeMs: THIRTY_DAYS_MS }));
    console.info(`[cbe] /exec action:authSession -> session established for ${claims.email}`);
    reply.code(CBE_HTTP_OK).header('set-cookie', cookies).send({ statusCode: CBE_HTTP_OK, msg: 'ok' });
  } catch (err) {
    console.info(`[cbe] /exec action:authSession invalid token: ${(err as Error).message}`);
    reply.code(CBE_HTTP_UNAUTHORIZED).send({ statusCode: CBE_HTTP_UNAUTHORIZED, msg: 'invalid access token' });
  }
}

function handleAuthLogout(reply: FastifyReply): void {
  const cookies = [
    sessionCookie('cauth', '', { httpOnly: true, expire: true }),
    sessionCookie('crefresh', '', { httpOnly: true, expire: true }),
    sessionCookie('loginMsg', '', { httpOnly: true, expire: true }),
    sessionCookie('loginUser', 'anonymous'),
  ];
  reply.code(CBE_HTTP_OK).header('set-cookie', cookies).send({ statusCode: CBE_HTTP_OK, msg: 'ok' });
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
  const files = readSources(project, body.shortPaths);
  reply.code(CBE_HTTP_OK).send({ statusCode: CBE_HTTP_OK, msg: 'ok', files });
}

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
  const rc = writeSources(project, body.files ?? [], body.deletes ?? []);
  if (!rc.ok) {
    reply.code(CBE_HTTP_BAD_REQUEST).send({ statusCode: CBE_HTTP_BAD_REQUEST, msg: rc.msg ?? 'invalid request' });
    return;
  }
  // Commit BEFORE scheduling the rebuild: the build reads each file's versionRef
  // from `git ls-tree -r HEAD`, so a build that runs on an uncommitted write
  // republishes the OLD versionRef and the browser keeps its cached source (see
  // cbeGitCommit.ts). It is also what puts these edits in getHistory. Awaited,
  // never fatal — the files are already on disk.
  const session = await resolveSession(request);
  const commit = await commitSavedSources(project, rc.paths, {
    comments: body.comments ?? undefined,
    author: authorFromSession(session.email ?? session.testUser),
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
  scheduleRebuildOnSave(project);
  reply.code(CBE_HTTP_OK).send({ statusCode: CBE_HTTP_OK, msg: 'ok', commit });
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
  reply.code(CBE_HTTP_OK).send({ statusCode: CBE_HTTP_OK, msg: 'ok', filesInfo: listSources(project) });
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
  // A project without .git, an untracked file or a rejected path all mean "no
  // history" — an empty list, not an error: the studio must degrade quietly.
  reply.code(CBE_HTTP_OK).send({ statusCode: CBE_HTTP_OK, msg: 'ok', history: readHistory(project, body.shortPath) });
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
  // An unacceptable ref (the UI's 'local' sentinel, anything non-hex) comes back
  // as null content, not 400: the diff panel asks for it on an ordinary click.
  const content = readHistoryContent(project, body.shortPath, body.ref);
  reply.code(CBE_HTTP_OK).send({ statusCode: CBE_HTTP_OK, msg: 'ok', content });
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

  // readSources drops a rejected path and a missing file alike — both are "not
  // here" to a reader, and telling them apart would report on the file system.
  const [file] = readSources(project, [query.path]);
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
        reply.code(CBE_HTTP_OK).send({
          statusCode: CBE_HTTP_OK,
          msg: 'pong',
          version: CBE_MODULE_VERSION,
          pid: process.pid,
          release: getRunningRelease(),
          rebuilding: isRebuildInProgress(),
        });
        return;
      case 'authSession':
        await handleAuthSession(body as CbeRequestAuthSession, reply);
        return;
      case 'authLogout':
        handleAuthLogout(reply);
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
      case 'login': {
        const start = Date.now();
        const session = await resolveSession(request);
        const mustLogin = requiresLogin(request);
        // The .env test user is a localhost convenience — on a real domain
        // ONLY a valid collab-auth JWT authenticates.
        const authenticated = Boolean(session.email || (!mustLogin && session.testUser));
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
        const rc = executeCbeLogin(body as CbeRequestLogin, session.email ?? session.testUser, session.picture);
        console.info(`[cbe] /exec action:login (${session.email ?? session.testUser ?? 'anonymous'}) -> ${rc.statusCode} in ${Date.now() - start}ms`);
        reply.header('set-cookie', buildLoginCookies(session));
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
  const rc = await getCbeStaticFile(request.raw.url ?? '', clientETag);

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
  app.post('/exec', handleExec);
  app.post('/exec/candidate', { bodyLimit: CANDIDATE_BODY_LIMIT }, handleCandidateProxy);
  app.get('/cbe/source', handleSourceView);
  app.get('/libs/*', handleStatic);
  app.get('/monaco/*', handleStatic);
  app.get('/mlsServiceWorker.js', handleStatic);
  console.info(`[cbe] v${CBE_MODULE_VERSION} routes registered: POST /exec (login/authSession/authLogout/getContents/setContents/loadFilesInfo/getHistory/getHistoryContent), POST /exec/candidate, GET /cbe/source, GET /libs/*, GET /monaco/*, GET /mlsServiceWorker.js`);
  logCbeStaticConfig();
  console.info(`[cbe] projects base: ${getProjectsBaseDir()} | jwtAuth: ${isJwtAuthEnabled() ? 'enabled' : 'DISABLED'}${process.env.CBE_TEST_LOGIN_USER ? ` | TEST user: ${process.env.CBE_TEST_LOGIN_USER}` : ''}`);
}
