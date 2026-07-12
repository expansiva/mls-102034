/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeRoutes.ts" enhancement="_blank" />
// Fastify wiring for the cbe-compatible endpoints on the runtime VM:
//   POST /exec               -> action dispatcher (login only; admin actions stay central)
//   GET  /libs/*             -> mls lib assets (disk cache + remote origin)
//   GET  /mlsServiceWorker.js
// Kept apart from the app/BFF routes on purpose — everything cbe-related lives
// in this folder so it can later move to a release-packaged module untouched.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { executeCbeLogin } from '/_102034_/l1/server/layer_1_external/cbe/cbeLogin.js';
import { getProjectsBaseDir } from '/_102034_/l1/server/layer_1_external/cbe/cbeCompiledLocal.js';
import { getCbeStaticFile, logCbeStaticConfig } from '/_102034_/l1/server/layer_1_external/cbe/cbeStaticFiles.js';
import {
  CBE_HTTP_BAD_REQUEST,
  CBE_HTTP_NOT_MODIFIED,
  CBE_HTTP_OK,
  CBE_HTTP_SERVER_ERROR,
  type CbeRequestBase,
  type CbeRequestLogin,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeTypes.js';

// Bump on every change to the cbe module. Exposed via the x-cbe-version
// response header and the {action:'ping'} probe so a deploy can be verified:
//   curl -s localhost:3000/exec -H 'Content-Type: application/json' -d '{"action":"ping"}'
export const CBE_MODULE_VERSION = '1.0.8';

// no-cache = always revalidate with the ETag (304 when unchanged). The server
// is local to the VM, so revalidation is cheap — and a publish always lands
// without hard refresh. Long-lived caching needs versioned URLs (?v=) first.
const STATIC_CACHE_CONTROL = 'no-cache';

// ── Test session (.env) ─────────────────────────────────────────────────────
// When CBE_TEST_LOGIN_USER is set the login answers as that user instead of
// anonymous — useful for fixed tests (localhost) where no real user connects.
// CBE_TEST_CAUTH / CBE_TEST_LOGIN_MSG optionally fill the session cookies the
// cfe expects. Never set these in a real client VM.
function buildLoginCookies(): string[] {
  const testUser = process.env.CBE_TEST_LOGIN_USER;
  if (!testUser) {
    return ['loginUser=anonymous; Path=/; SameSite=Lax'];
  }

  console.warn(`[cbe] TEST session active (CBE_TEST_LOGIN_USER=${testUser}) — do not use in production`);
  const cookies = [`loginUser=${encodeURIComponent(testUser)}; Path=/; SameSite=Lax`];
  const cauth = process.env.CBE_TEST_CAUTH;
  if (cauth) cookies.push(`cauth=${encodeURIComponent(cauth)}; Path=/; SameSite=Strict; HttpOnly`);
  const loginMsg = process.env.CBE_TEST_LOGIN_MSG;
  if (loginMsg) cookies.push(`loginMsg=${encodeURIComponent(loginMsg)}; Path=/; SameSite=Strict; HttpOnly`);
  return cookies;
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
        reply.code(CBE_HTTP_OK).send({ statusCode: CBE_HTTP_OK, msg: 'pong', version: CBE_MODULE_VERSION });
        return;
      case 'login': {
        const start = Date.now();
        const rc = executeCbeLogin(body as CbeRequestLogin);
        console.info(`[cbe] /exec action:login -> ${rc.statusCode} in ${Date.now() - start}ms`);
        // Session cookies, host-only (no shared domain on the VM). The cfe
        // frontend gates its UI on the presence of `loginUser`. With the test
        // session env keys set, the login answers as a fixed user (see above).
        reply.header('set-cookie', buildLoginCookies());
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
          msg: `action "${body.action}" is not handled by the runtime cbe module (only login runs on the VM)`,
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
  app.get('/libs/*', handleStatic);
  app.get('/mlsServiceWorker.js', handleStatic);
  console.info(`[cbe] v${CBE_MODULE_VERSION} routes registered: POST /exec, GET /libs/*, GET /mlsServiceWorker.js`);
  logCbeStaticConfig();
  console.info(`[cbe] projects base: ${getProjectsBaseDir()}${process.env.CBE_TEST_LOGIN_USER ? ` | TEST user: ${process.env.CBE_TEST_LOGIN_USER}` : ''}`);
}
