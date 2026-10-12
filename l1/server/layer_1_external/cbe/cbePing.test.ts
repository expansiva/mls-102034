/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbePing.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import Fastify from 'fastify';
import { promoteRouteHooks, registerCbeRoutes } from '/_102034_/l1/server/layer_1_external/cbe/cbeRoutes.js';

const PROJECT_ID = 102047;
const SLUG = 'team-102047';
const BRANCH = 'team/102047';

function realGit(): string {
  return execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
}

function git(bin: string, cwd: string, args: string[]): string {
  return execFileSync(bin, args, { cwd, encoding: 'utf8' }).trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${file}`);
    await sleep(20);
  }
}

test('exec ping reports promoting while a publish merge is in flight, and null otherwise', async () => {
  const base = mkdtempSync(join(tmpdir(), 'cbe-ping-'));
  const holdReady = join(base, 'hold-ready');
  const holdGo = join(base, 'hold-go');
  const gitBin = realGit();
  const prev = {
    dir: process.env.CBE_PROJECTS_DIR,
    rebuild: process.env.CBE_REBUILD_ON_SAVE,
    login: process.env.CBE_REQUIRE_LOGIN,
    path: process.env.PATH,
    holdReady: process.env.CBE_PING_HOLD_READY,
    holdGo: process.env.CBE_PING_HOLD_GO,
    realGit: process.env.CBE_PING_REAL_GIT,
  };
  process.env.CBE_PROJECTS_DIR = base;
  process.env.CBE_REBUILD_ON_SAVE = 'never';
  process.env.CBE_REQUIRE_LOGIN = 'never';

  const origSchedule = promoteRouteHooks.scheduleRebuildOnSave;
  const origBusy = promoteRouteHooks.isRebuildInProgress;
  promoteRouteHooks.scheduleRebuildOnSave = () => {};
  promoteRouteHooks.isRebuildInProgress = () => false;

  const app = Fastify();
  registerCbeRoutes(app);
  let promote: Promise<{ statusCode: number; body: string; json: () => { status?: string; promoting?: unknown } }> | null = null;
  try {
    const idle = await app.inject({ method: 'POST', url: '/exec', payload: { action: 'ping' } });
    assert.equal(idle.statusCode, 200, idle.body);
    assert.equal(idle.json().msg, 'pong');
    assert.equal(idle.json().promoting, null);

    const projectRoot = join(base, `mls-${PROJECT_ID}`);
    const draftRoot = join(base, 'drafts', SLUG, `mls-${PROJECT_ID}`);
    git(gitBin, base, ['init', '-b', 'main', projectRoot]);
    git(gitBin, projectRoot, ['config', 'user.name', 'fixture']);
    git(gitBin, projectRoot, ['config', 'user.email', 'fixture@test']);
    git(gitBin, projectRoot, ['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(projectRoot, 'README'), 'base\n');
    git(gitBin, projectRoot, ['add', 'README']);
    git(gitBin, projectRoot, ['commit', '--no-verify', '-m', 'init']);
    mkdirSync(join(base, 'drafts', SLUG), { recursive: true });
    git(gitBin, projectRoot, ['worktree', 'add', '-b', BRANCH, draftRoot]);
    mkdirSync(join(draftRoot, 'l2'), { recursive: true });
    writeFileSync(join(draftRoot, 'l2', 'note.ts'), 'draft\n');
    git(gitBin, draftRoot, ['add', 'l2/note.ts']);
    git(gitBin, draftRoot, ['commit', '--no-verify', '-m', 'draft note']);

    const binDir = join(base, 'bin');
    mkdirSync(binDir);
    writeFileSync(join(binDir, 'git'), [
      '#!/bin/sh',
      'for arg in "$@"; do',
      '  if [ "$arg" = "--no-ff" ]; then',
      '    : > "$CBE_PING_HOLD_READY"',
      '    while [ ! -f "$CBE_PING_HOLD_GO" ]; do sleep 0.05; done',
      '    break',
      '  fi',
      'done',
      'exec "$CBE_PING_REAL_GIT" "$@"',
      '',
    ].join('\n'));
    chmodSync(join(binDir, 'git'), 0o755);
    process.env.PATH = `${binDir}${delimiter}${prev.path ?? ''}`;
    process.env.CBE_PING_HOLD_READY = holdReady;
    process.env.CBE_PING_HOLD_GO = holdGo;
    process.env.CBE_PING_REAL_GIT = gitBin;

    promote = app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'promote', project: PROJECT_ID, draft: SLUG, target: 'production', comment: 'ship it' },
    });
    await waitForFile(holdReady);

    const publishing = await app.inject({ method: 'POST', url: '/exec', payload: { action: 'ping' } });
    assert.equal(publishing.statusCode, 200, publishing.body);
    const inFlight = publishing.json().promoting as { project: number; draft: string; startedAt: string };
    assert.equal(inFlight.project, PROJECT_ID);
    assert.equal(inFlight.draft, SLUG);
    assert.match(inFlight.startedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    writeFileSync(holdGo, 'go\n');
    const merged = await promote;
    promote = null;
    assert.equal(merged.statusCode, 200, merged.body);
    assert.equal(merged.json().status, 'merged');

    const done = await app.inject({ method: 'POST', url: '/exec', payload: { action: 'ping' } });
    assert.equal(done.statusCode, 200, done.body);
    assert.equal(done.json().promoting, null);
  } finally {
    if (!existsSync(holdGo)) writeFileSync(holdGo, 'go\n');
    if (promote) await promote.catch(() => undefined);
    promoteRouteHooks.scheduleRebuildOnSave = origSchedule;
    promoteRouteHooks.isRebuildInProgress = origBusy;
    await app.close();
    if (prev.dir === undefined) delete process.env.CBE_PROJECTS_DIR;
    else process.env.CBE_PROJECTS_DIR = prev.dir;
    if (prev.rebuild === undefined) delete process.env.CBE_REBUILD_ON_SAVE;
    else process.env.CBE_REBUILD_ON_SAVE = prev.rebuild;
    if (prev.login === undefined) delete process.env.CBE_REQUIRE_LOGIN;
    else process.env.CBE_REQUIRE_LOGIN = prev.login;
    if (prev.path === undefined) delete process.env.PATH;
    else process.env.PATH = prev.path;
    if (prev.holdReady === undefined) delete process.env.CBE_PING_HOLD_READY;
    else process.env.CBE_PING_HOLD_READY = prev.holdReady;
    if (prev.holdGo === undefined) delete process.env.CBE_PING_HOLD_GO;
    else process.env.CBE_PING_HOLD_GO = prev.holdGo;
    if (prev.realGit === undefined) delete process.env.CBE_PING_REAL_GIT;
    else process.env.CBE_PING_REAL_GIT = prev.realGit;
    rmSync(base, { recursive: true, force: true });
  }
});
