/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeDesenv.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { registerCbeRoutes, sessionHooks } from '/_102034_/l1/server/layer_1_external/cbe/cbeRoutes.js';
import { draftSlugForUser } from '/_102034_/l1/server/layer_1_external/cbe/cbeDraft.js';
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
  const origFastForward = desenvIo.fastForwardDraft;
  const origDev = desenvIo.ensureDevProcess;
  const origReady = desenvIo.waitForDevReady;
  const origProject = desenvIo.resolveClientProjectId;
  desenvIo.resolveClientProjectId = () => String(PROJECT_ID);
  desenvIo.waitForDevReady = async () => true;
  desenvIo.fastForwardDraft = async () => ({ status: 'up_to_date' });
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

    const leftTo = await app.inject({
      method: 'GET',
      url: '/desenv/sair?to=' + encodeURIComponent('/agendaClinica?x=1'),
      headers: { host: REAL_HOST },
    });
    assert.equal(leftTo.statusCode, 302);
    assert.equal(headerValue(leftTo.headers.location), '/agendaClinica?x=1');
    assert.equal(headerValue(leftTo.headers['set-cookie']), clearDraftCookie());

    const protocolRelative = await app.inject({
      method: 'GET',
      url: '/desenv/sair?to=' + encodeURIComponent('//evil.com'),
      headers: { host: REAL_HOST },
    });
    assert.equal(protocolRelative.statusCode, 400);
    assert.equal(protocolRelative.json().msg, 'invalid redirect');
    assert.equal(headerValue(protocolRelative.headers['set-cookie']), '');

    const absolute = await app.inject({
      method: 'GET',
      url: '/desenv/sair?to=' + encodeURIComponent('https://x'),
      headers: { host: REAL_HOST },
    });
    assert.equal(absolute.statusCode, 400);
    assert.equal(absolute.json().msg, 'invalid redirect');
    assert.equal(headerValue(absolute.headers['set-cookie']), '');
  } finally {
    desenvIo.ensureDraftWorktree = origWorktree;
    desenvIo.fastForwardDraft = origFastForward;
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
  const origFastForward = desenvIo.fastForwardDraft;
  const origDev = desenvIo.ensureDevProcess;
  const origReady = desenvIo.waitForDevReady;
  const origProject = desenvIo.resolveClientProjectId;
  desenvIo.resolveClientProjectId = () => String(PROJECT_ID);
  desenvIo.fastForwardDraft = async () => ({ status: 'up_to_date' });
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
    desenvIo.fastForwardDraft = origFastForward;
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
  const origFastForward = desenvIo.fastForwardDraft;
  const origDev = desenvIo.ensureDevProcess;
  const origReady = desenvIo.waitForDevReady;
  const origProject = desenvIo.resolveClientProjectId;
  desenvIo.resolveClientProjectId = () => String(PROJECT_ID);
  desenvIo.fastForwardDraft = async () => ({ status: 'up_to_date' });
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
    desenvIo.fastForwardDraft = origFastForward;
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
  const origFastForward = desenvIo.fastForwardDraft;
  const origDev = desenvIo.ensureDevProcess;
  const origReady = desenvIo.waitForDevReady;
  const origProject = desenvIo.resolveClientProjectId;
  desenvIo.resolveClientProjectId = () => String(PROJECT_ID);
  desenvIo.fastForwardDraft = async () => ({ status: 'up_to_date' });
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
    desenvIo.fastForwardDraft = origFastForward;
    desenvIo.ensureDevProcess = origDev;
    desenvIo.waitForDevReady = origReady;
    desenvIo.resolveClientProjectId = origProject;
    if (prevLogin === undefined) delete process.env.CBE_REQUIRE_LOGIN;
    else process.env.CBE_REQUIRE_LOGIN = prevLogin;
    await app.close();
  }
});

test('GET /desenv fast-forwards a draft with no own commits before the dev process starts', async () => {
  const prevLogin = process.env.CBE_REQUIRE_LOGIN;
  delete process.env.CBE_REQUIRE_LOGIN;

  const order: string[] = [];
  const stops: Array<{ base: string; slug: string }> = [];
  const syncs: Array<{ base: string; projectId: number; slug: string }> = [];
  const infos: string[] = [];
  const origWorktree = desenvIo.ensureDraftWorktree;
  const origFastForward = desenvIo.fastForwardDraft;
  const origStop = desenvIo.stopDevProcess;
  const origDev = desenvIo.ensureDevProcess;
  const origReady = desenvIo.waitForDevReady;
  const origProject = desenvIo.resolveClientProjectId;
  const origInfo = console.info;
  desenvIo.resolveClientProjectId = () => String(PROJECT_ID);
  desenvIo.ensureDraftWorktree = async () => {
    order.push('worktree');
    return '/tmp/draft';
  };
  desenvIo.fastForwardDraft = async (opts) => {
    order.push('fastForward');
    syncs.push({ base: opts.base, projectId: opts.projectId, slug: opts.slug });
    return { status: 'fast_forwarded', ref: 'abc123' };
  };
  desenvIo.stopDevProcess = (base, slug) => {
    order.push('stop');
    stops.push({ base, slug });
  };
  desenvIo.ensureDevProcess = () => {
    order.push('ensureDev');
    return { port: 4100, pid: 1, startedAt: 0, lastRequestAt: 0 };
  };
  desenvIo.waitForDevReady = async () => {
    order.push('ready');
    return true;
  };

  const app = Fastify();
  registerCbeRoutes(app);
  const base = getProjectsBaseDir();
  console.info = (...args: unknown[]) => {
    infos.push(args.map((arg) => String(arg)).join(' '));
  };
  try {
    const entered = await app.inject({
      method: 'GET',
      url: `/desenv?draft=${SLUG}`,
      headers: { host: 'localhost' },
    });
    assert.equal(entered.statusCode, 302);
    assert.equal(headerValue(entered.headers['set-cookie']), draftCookie(SLUG));
    assert.deepEqual(order, ['worktree', 'fastForward', 'stop', 'ensureDev', 'ready']);
    assert.deepEqual(syncs, [{ base, projectId: PROJECT_ID, slug: SLUG }]);
    assert.deepEqual(stops, [{ base, slug: SLUG }]);
    assert.deepEqual(infos, [`[cbe] /desenv: draft ${SLUG} fast-forwarded to abc123`]);
  } finally {
    console.info = origInfo;
    desenvIo.ensureDraftWorktree = origWorktree;
    desenvIo.fastForwardDraft = origFastForward;
    desenvIo.stopDevProcess = origStop;
    desenvIo.ensureDevProcess = origDev;
    desenvIo.waitForDevReady = origReady;
    desenvIo.resolveClientProjectId = origProject;
    if (prevLogin === undefined) delete process.env.CBE_REQUIRE_LOGIN;
    else process.env.CBE_REQUIRE_LOGIN = prevLogin;
    await app.close();
  }
});

test('GET /desenv does not stop the dev process when the draft has diverged', async () => {
  const prevLogin = process.env.CBE_REQUIRE_LOGIN;
  delete process.env.CBE_REQUIRE_LOGIN;

  const order: string[] = [];
  let stopped = false;
  const origWorktree = desenvIo.ensureDraftWorktree;
  const origFastForward = desenvIo.fastForwardDraft;
  const origStop = desenvIo.stopDevProcess;
  const origDev = desenvIo.ensureDevProcess;
  const origReady = desenvIo.waitForDevReady;
  const origProject = desenvIo.resolveClientProjectId;
  desenvIo.resolveClientProjectId = () => String(PROJECT_ID);
  desenvIo.ensureDraftWorktree = async () => {
    order.push('worktree');
    return '/tmp/draft';
  };
  desenvIo.fastForwardDraft = async () => {
    order.push('fastForward');
    return { status: 'diverged', ahead: 1, behind: 2 };
  };
  desenvIo.stopDevProcess = () => {
    stopped = true;
  };
  desenvIo.ensureDevProcess = () => {
    order.push('ensureDev');
    return { port: 4100, pid: 1, startedAt: 0, lastRequestAt: 0 };
  };
  desenvIo.waitForDevReady = async () => {
    order.push('ready');
    return true;
  };

  const app = Fastify();
  registerCbeRoutes(app);
  try {
    const entered = await app.inject({
      method: 'GET',
      url: `/desenv?draft=${SLUG}`,
      headers: { host: 'localhost' },
    });
    assert.equal(entered.statusCode, 302);
    assert.equal(headerValue(entered.headers['set-cookie']), draftCookie(SLUG));
    assert.equal(stopped, false);
    assert.deepEqual(order, ['worktree', 'fastForward', 'ensureDev', 'ready']);
  } finally {
    desenvIo.ensureDraftWorktree = origWorktree;
    desenvIo.fastForwardDraft = origFastForward;
    desenvIo.stopDevProcess = origStop;
    desenvIo.ensureDevProcess = origDev;
    desenvIo.waitForDevReady = origReady;
    desenvIo.resolveClientProjectId = origProject;
    if (prevLogin === undefined) delete process.env.CBE_REQUIRE_LOGIN;
    else process.env.CBE_REQUIRE_LOGIN = prevLogin;
    await app.close();
  }
});

test('GET /desenv still enters when fast-forward fails', async () => {
  const prevLogin = process.env.CBE_REQUIRE_LOGIN;
  delete process.env.CBE_REQUIRE_LOGIN;

  const warns: string[] = [];
  let stopped = false;
  let mode: 'dirty' | 'throw' = 'dirty';
  const origWorktree = desenvIo.ensureDraftWorktree;
  const origFastForward = desenvIo.fastForwardDraft;
  const origStop = desenvIo.stopDevProcess;
  const origDev = desenvIo.ensureDevProcess;
  const origReady = desenvIo.waitForDevReady;
  const origProject = desenvIo.resolveClientProjectId;
  const origWarn = console.warn;
  desenvIo.resolveClientProjectId = () => String(PROJECT_ID);
  desenvIo.ensureDraftWorktree = async () => '/tmp/draft';
  desenvIo.fastForwardDraft = async () => {
    if (mode === 'throw') throw new Error('git exploded');
    return { status: 409, code: 'DRAFT_DIRTY' };
  };
  desenvIo.stopDevProcess = () => {
    stopped = true;
  };
  desenvIo.ensureDevProcess = () => ({ port: 4100, pid: 1, startedAt: 0, lastRequestAt: 0 });
  desenvIo.waitForDevReady = async () => true;
  console.warn = (...args: unknown[]) => {
    warns.push(args.map((arg) => String(arg)).join(' '));
  };

  const app = Fastify();
  registerCbeRoutes(app);
  try {
    const dirty = await app.inject({
      method: 'GET',
      url: `/desenv?draft=${SLUG}`,
      headers: { host: 'localhost' },
    });
    assert.equal(dirty.statusCode, 302);
    assert.equal(headerValue(dirty.headers['set-cookie']), draftCookie(SLUG));
    assert.equal(stopped, false);
    assert.deepEqual(warns, [`[cbe] /desenv: draft ${SLUG} not synced: DRAFT_DIRTY`]);

    mode = 'throw';
    const thrown = await app.inject({
      method: 'GET',
      url: `/desenv?draft=${SLUG}`,
      headers: { host: 'localhost' },
    });
    assert.equal(thrown.statusCode, 302);
    assert.equal(headerValue(thrown.headers['set-cookie']), draftCookie(SLUG));
    assert.equal(stopped, false);
    assert.deepEqual(warns, [
      `[cbe] /desenv: draft ${SLUG} not synced: DRAFT_DIRTY`,
      `[cbe] /desenv: draft ${SLUG} not synced: git exploded`,
    ]);
  } finally {
    console.warn = origWarn;
    desenvIo.ensureDraftWorktree = origWorktree;
    desenvIo.fastForwardDraft = origFastForward;
    desenvIo.stopDevProcess = origStop;
    desenvIo.ensureDevProcess = origDev;
    desenvIo.waitForDevReady = origReady;
    desenvIo.resolveClientProjectId = origProject;
    if (prevLogin === undefined) delete process.env.CBE_REQUIRE_LOGIN;
    else process.env.CBE_REQUIRE_LOGIN = prevLogin;
    await app.close();
  }
});

test('POST /exec draftEnter returns JSON and never sets the draft cookie', async () => {
  const prevLogin = process.env.CBE_REQUIRE_LOGIN;
  delete process.env.CBE_REQUIRE_LOGIN;

  const worktrees: string[] = [];
  const origWorktree = desenvIo.ensureDraftWorktree;
  const origFastForward = desenvIo.fastForwardDraft;
  const origStop = desenvIo.stopDevProcess;
  const origDev = desenvIo.ensureDevProcess;
  const origReady = desenvIo.waitForDevReady;
  const origProject = desenvIo.resolveClientProjectId;
  desenvIo.resolveClientProjectId = () => String(PROJECT_ID);
  desenvIo.stopDevProcess = () => {};
  desenvIo.fastForwardDraft = async () => ({ status: 'fast_forwarded', ref: 'abc123' });
  desenvIo.ensureDraftWorktree = async (opts) => {
    worktrees.push(opts.slug);
    return '/tmp/draft';
  };
  desenvIo.ensureDevProcess = () => ({ port: 4100, pid: 1, startedAt: 0, lastRequestAt: 0 });
  desenvIo.waitForDevReady = async () => true;

  const app = Fastify();
  registerCbeRoutes(app);
  const post = (payload: { action: string; project: number | string; draft: string }, host: string) => app.inject({
    method: 'POST',
    url: '/exec',
    headers: { host, 'content-type': 'application/json' },
    payload,
  });

  try {
    const noSession = await post({ action: 'draftEnter', project: PROJECT_ID, draft: SLUG }, REAL_HOST);
    assert.equal(noSession.statusCode, 401);
    assert.equal(noSession.json().msg, 'login required');
    assert.equal(headerValue(noSession.headers['set-cookie']), '');
    assert.equal(worktrees.length, 0);

    const badSlug = await post({ action: 'draftEnter', project: PROJECT_ID, draft: 'nope' }, 'localhost');
    assert.equal(badSlug.statusCode, 400);
    assert.equal(badSlug.json().msg, 'invalid draft');
    assert.equal(worktrees.length, 0);

    const otherApp = await post({ action: 'draftEnter', project: 102099, draft: SLUG }, 'localhost');
    assert.equal(otherApp.statusCode, 400);
    assert.equal(otherApp.json().msg, 'invalid project');
    assert.equal(headerValue(otherApp.headers['set-cookie']), '');
    assert.equal(worktrees.length, 0);

    const entered = await post({ action: 'draftEnter', project: PROJECT_ID, draft: SLUG }, 'localhost');
    assert.equal(entered.statusCode, 200);
    assert.equal(headerValue(entered.headers['set-cookie']), '');
    assert.equal(headerValue(entered.headers.location), '');
    assert.deepEqual(entered.json(), { statusCode: 200, ok: true, slug: SLUG, head: 'abc123' });

    desenvIo.waitForDevReady = async () => false;
    const down = await post({ action: 'draftEnter', project: String(PROJECT_ID), draft: SLUG }, 'localhost');
    assert.equal(down.statusCode, 503);
    assert.equal(down.json().msg, 'draft unavailable: dev not ready');
    assert.equal(headerValue(down.headers['set-cookie']), '');
    assert.equal(headerValue(down.headers.location), '');
  } finally {
    desenvIo.ensureDraftWorktree = origWorktree;
    desenvIo.fastForwardDraft = origFastForward;
    desenvIo.stopDevProcess = origStop;
    desenvIo.ensureDevProcess = origDev;
    desenvIo.waitForDevReady = origReady;
    desenvIo.resolveClientProjectId = origProject;
    if (prevLogin === undefined) delete process.env.CBE_REQUIRE_LOGIN;
    else process.env.CBE_REQUIRE_LOGIN = prevLogin;
    await app.close();
  }
});

test('draftEnter "user" resolves the session and writes nothing without one', async () => {
  const prevLogin = process.env.CBE_REQUIRE_LOGIN;
  const prevDir = process.env.CBE_PROJECTS_DIR;
  delete process.env.CBE_REQUIRE_LOGIN;
  const base = mkdtempSync(join(tmpdir(), 'cbe-draft-enter-user-'));
  process.env.CBE_PROJECTS_DIR = base;

  const worktrees: string[] = [];
  const origWorktree = desenvIo.ensureDraftWorktree;
  const origFastForward = desenvIo.fastForwardDraft;
  const origStop = desenvIo.stopDevProcess;
  const origDev = desenvIo.ensureDevProcess;
  const origReady = desenvIo.waitForDevReady;
  const origProject = desenvIo.resolveClientProjectId;
  const origEmail = sessionHooks.emailOf;
  let email: string | undefined;
  sessionHooks.emailOf = async () => email;
  desenvIo.resolveClientProjectId = () => String(PROJECT_ID);
  desenvIo.stopDevProcess = () => {};
  desenvIo.fastForwardDraft = async () => ({ status: 'fast_forwarded', ref: 'abc123' });
  desenvIo.ensureDraftWorktree = async (opts) => {
    worktrees.push(opts.slug);
    return '/tmp/draft';
  };
  desenvIo.ensureDevProcess = () => ({ port: 4100, pid: 1, startedAt: 0, lastRequestAt: 0 });
  desenvIo.waitForDevReady = async () => true;

  const app = Fastify();
  registerCbeRoutes(app);
  const post = () => app.inject({
    method: 'POST',
    url: '/exec',
    headers: { host: 'localhost', 'content-type': 'application/json' },
    payload: { action: 'draftEnter', project: PROJECT_ID, draft: 'user' },
  });

  try {
    const missing = await post();
    assert.equal(missing.statusCode, 401);
    assert.equal(missing.json().msg, 'draft.session_required');
    assert.equal(worktrees.length, 0);

    email = 'Ana@X.com';
    const entered = await post();
    const person = draftSlugForUser(email);
    assert.equal(entered.statusCode, 200, entered.body);
    assert.deepEqual(entered.json(), { statusCode: 200, ok: true, slug: person.slug, head: 'abc123' });
    assert.deepEqual(worktrees, [person.slug]);
    assert.equal(readFileSync(join(base, 'drafts', person.slug, 'owner.json'), 'utf8'), '{"email":"ana@x.com"}\n');
  } finally {
    sessionHooks.emailOf = origEmail;
    desenvIo.ensureDraftWorktree = origWorktree;
    desenvIo.fastForwardDraft = origFastForward;
    desenvIo.stopDevProcess = origStop;
    desenvIo.ensureDevProcess = origDev;
    desenvIo.waitForDevReady = origReady;
    desenvIo.resolveClientProjectId = origProject;
    if (prevLogin === undefined) delete process.env.CBE_REQUIRE_LOGIN;
    else process.env.CBE_REQUIRE_LOGIN = prevLogin;
    if (prevDir === undefined) delete process.env.CBE_PROJECTS_DIR;
    else process.env.CBE_PROJECTS_DIR = prevDir;
    rmSync(base, { recursive: true, force: true });
    await app.close();
  }
});

