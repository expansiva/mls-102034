/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeDesenv.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerCbeRoutes } from '/_102034_/l1/server/layer_1_external/cbe/cbeRoutes.js';
import {
  clearDraftCookie,
  desenvIo,
  draftCookie,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeDesenv.js';
import { getProjectsBaseDir } from '/_102034_/l1/server/layer_1_external/cbe/cbeCompiledLocal.js';
import { AncestorDenoConfigError, DraftDatabaseError } from '/_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.js';

const SLUG = 'team-102047';
const PROJECT_ID = 102047;
const REAL_HOST = '102047.collabcodes.com';

function headerValue(value: unknown): string {
  if (Array.isArray(value)) return value.join('\n');
  return value === undefined ? '' : String(value);
}

test('GET /desenv sets the draft cookie; GET /desenv/sair clears it', async () => {
  const prevLogin = process.env.CBE_REQUIRE_LOGIN;
  delete process.env.CBE_REQUIRE_LOGIN;

  const worktrees: Array<{ base: string; projectId: number; slug: string; branch: string }> = [];
  const devs: Array<{ base: string; slug: string; clientProjectId: number }> = [];
  const origWorktree = desenvIo.ensureDraftWorktree;
  const origDev = desenvIo.ensureDevProcess;
  const origReady = desenvIo.waitForDevReady;
  const origProject = desenvIo.resolveClientProjectId;
  desenvIo.resolveClientProjectId = () => String(PROJECT_ID);
  desenvIo.waitForDevReady = async () => true;
  desenvIo.ensureDraftWorktree = async (opts) => {
    worktrees.push({ base: opts.base, projectId: opts.projectId, slug: opts.slug, branch: opts.branch });
    return '/tmp/draft';
  };
  desenvIo.ensureDevProcess = (opts) => {
    devs.push({ base: opts.base, slug: opts.slug, clientProjectId: opts.clientProjectId });
    return { port: 4100, pid: 1, startedAt: 0, lastRequestAt: 0 };
  };

  const app = Fastify();
  registerCbeRoutes(app);
  const base = getProjectsBaseDir();

  try {
    const noSession = await app.inject({
      method: 'GET',
      url: `/desenv?draft=${SLUG}`,
      headers: { host: REAL_HOST },
    });
    assert.equal(noSession.statusCode, 401);
    assert.equal(worktrees.length, 0);
    assert.equal(devs.length, 0);

    const badSlug = await app.inject({
      method: 'GET',
      url: '/desenv?draft=nope',
      headers: { host: 'localhost' },
    });
    assert.equal(badSlug.statusCode, 400);
    assert.equal(worktrees.length, 0);

    const entered = await app.inject({
      method: 'GET',
      url: `/desenv?draft=${SLUG}`,
      headers: { host: 'localhost' },
    });
    assert.equal(entered.statusCode, 302);
    assert.equal(headerValue(entered.headers.location), '/');
    assert.equal(headerValue(entered.headers['set-cookie']), draftCookie(SLUG));
    assert.equal(headerValue(entered.headers['set-cookie']).includes('HttpOnly'), false);
    assert.deepEqual(worktrees, [{ base, projectId: PROJECT_ID, slug: SLUG, branch: 'team/102047' }]);
    assert.deepEqual(devs, [{ base, slug: SLUG, clientProjectId: PROJECT_ID }]);

    const returned = await app.inject({
      method: 'GET',
      url: `/desenv?draft=${SLUG}&to=/app`,
      headers: { host: 'localhost' },
    });
    assert.equal(returned.statusCode, 302);
    assert.equal(headerValue(returned.headers.location), '/app');

    const foreign = await app.inject({
      method: 'GET',
      url: `/desenv?draft=${SLUG}&to=https://evil.example/app`,
      headers: { host: 'localhost' },
    });
    assert.equal(foreign.statusCode, 400);

    const left = await app.inject({
      method: 'GET',
      url: '/desenv/sair',
      headers: { host: REAL_HOST },
    });
    assert.equal(left.statusCode, 302);
    assert.equal(headerValue(left.headers.location), '/');
    assert.equal(headerValue(left.headers['set-cookie']), clearDraftCookie());
  } finally {
    desenvIo.ensureDraftWorktree = origWorktree;
    desenvIo.ensureDevProcess = origDev;
    desenvIo.waitForDevReady = origReady;
    desenvIo.resolveClientProjectId = origProject;
    if (prevLogin === undefined) delete process.env.CBE_REQUIRE_LOGIN;
    else process.env.CBE_REQUIRE_LOGIN = prevLogin;
    await app.close();
  }
});

test('GET /desenv answers 503 without a cookie when the dev port is not ready', async () => {
  const prevLogin = process.env.CBE_REQUIRE_LOGIN;
  delete process.env.CBE_REQUIRE_LOGIN;

  const origWorktree = desenvIo.ensureDraftWorktree;
  const origDev = desenvIo.ensureDevProcess;
  const origReady = desenvIo.waitForDevReady;
  const origProject = desenvIo.resolveClientProjectId;
  desenvIo.resolveClientProjectId = () => String(PROJECT_ID);
  desenvIo.ensureDraftWorktree = async () => '/tmp/draft';
  desenvIo.ensureDevProcess = () => ({ port: 4100, pid: 1, startedAt: 0, lastRequestAt: 0 });
  let waited: number | undefined;
  desenvIo.waitForDevReady = async (port) => {
    waited = port;
    return false;
  };

  const app = Fastify();
  registerCbeRoutes(app);
  try {
    const down = await app.inject({
      method: 'GET',
      url: `/desenv?draft=${SLUG}`,
      headers: { host: 'localhost' },
    });
    assert.equal(down.statusCode, 503);
    assert.equal(headerValue(down.headers['set-cookie']), '');
    assert.equal(headerValue(down.headers.location), '');
    assert.deepEqual(down.json(), { statusCode: 503, msg: 'draft unavailable: dev not ready' });
    assert.equal(waited, 4100);
  } finally {
    desenvIo.ensureDraftWorktree = origWorktree;
    desenvIo.ensureDevProcess = origDev;
    desenvIo.waitForDevReady = origReady;
    desenvIo.resolveClientProjectId = origProject;
    if (prevLogin === undefined) delete process.env.CBE_REQUIRE_LOGIN;
    else process.env.CBE_REQUIRE_LOGIN = prevLogin;
    await app.close();
  }
});

test('GET /desenv answers 503 without a cookie when an ancestor deno config blocks the dev process', async () => {
  const prevLogin = process.env.CBE_REQUIRE_LOGIN;
  delete process.env.CBE_REQUIRE_LOGIN;

  const origWorktree = desenvIo.ensureDraftWorktree;
  const origDev = desenvIo.ensureDevProcess;
  const origReady = desenvIo.waitForDevReady;
  const origProject = desenvIo.resolveClientProjectId;
  desenvIo.resolveClientProjectId = () => String(PROJECT_ID);
  desenvIo.ensureDraftWorktree = async () => '/tmp/draft';
  desenvIo.ensureDevProcess = () => {
    throw new AncestorDenoConfigError('ancestor deno config: /data/mls-base/deno.json');
  };
  let waited = false;
  desenvIo.waitForDevReady = async () => {
    waited = true;
    return true;
  };

  const app = Fastify();
  registerCbeRoutes(app);
  try {
    const blocked = await app.inject({
      method: 'GET',
      url: `/desenv?draft=${SLUG}`,
      headers: { host: 'localhost' },
    });
    assert.equal(blocked.statusCode, 503);
    assert.equal(headerValue(blocked.headers['set-cookie']), '');
    assert.equal(headerValue(blocked.headers.location), '');
    assert.deepEqual(blocked.json(), {
      statusCode: 503,
      msg: 'draft unavailable: ancestor deno config: /data/mls-base/deno.json',
    });
    assert.equal(waited, false);
  } finally {
    desenvIo.ensureDraftWorktree = origWorktree;
    desenvIo.ensureDevProcess = origDev;
    desenvIo.waitForDevReady = origReady;
    desenvIo.resolveClientProjectId = origProject;
    if (prevLogin === undefined) delete process.env.CBE_REQUIRE_LOGIN;
    else process.env.CBE_REQUIRE_LOGIN = prevLogin;
    await app.close();
  }
});

test('GET /desenv answers 503 without a cookie when the draft database is refused', async () => {
  const prevLogin = process.env.CBE_REQUIRE_LOGIN;
  delete process.env.CBE_REQUIRE_LOGIN;

  const origWorktree = desenvIo.ensureDraftWorktree;
  const origDev = desenvIo.ensureDevProcess;
  const origReady = desenvIo.waitForDevReady;
  const origProject = desenvIo.resolveClientProjectId;
  desenvIo.resolveClientProjectId = () => String(PROJECT_ID);
  desenvIo.ensureDraftWorktree = async () => '/tmp/draft';
  desenvIo.ensureDevProcess = () => {
    throw new DraftDatabaseError('project mode production is not a test mode');
  };
  let waited = false;
  desenvIo.waitForDevReady = async () => {
    waited = true;
    return true;
  };

  const app = Fastify();
  registerCbeRoutes(app);
  try {
    const blocked = await app.inject({
      method: 'GET',
      url: `/desenv?draft=${SLUG}`,
      headers: { host: 'localhost' },
    });
    assert.equal(blocked.statusCode, 503);
    assert.equal(headerValue(blocked.headers['set-cookie']), '');
    assert.equal(headerValue(blocked.headers.location), '');
    assert.deepEqual(blocked.json(), {
      statusCode: 503,
      msg: 'draft unavailable: project mode production is not a test mode',
    });
    assert.equal(waited, false);
  } finally {
    desenvIo.ensureDraftWorktree = origWorktree;
    desenvIo.ensureDevProcess = origDev;
    desenvIo.waitForDevReady = origReady;
    desenvIo.resolveClientProjectId = origProject;
    if (prevLogin === undefined) delete process.env.CBE_REQUIRE_LOGIN;
    else process.env.CBE_REQUIRE_LOGIN = prevLogin;
    await app.close();
  }
});
