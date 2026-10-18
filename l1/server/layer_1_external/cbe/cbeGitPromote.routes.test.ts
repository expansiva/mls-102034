/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeGitPromote.routes.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { draftDatabaseUrl } from '/_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.js';
import { parseDatabaseUrl } from '/_102034_/l1/server/layer_1_external/config/projectMode.js';
import { draftDbHooks, draftDevHooks, draftSyncHooks, promoteRouteHooks, registerCbeRoutes } from '/_102034_/l1/server/layer_1_external/cbe/cbeRoutes.js';

const PROJECT_ID = 102047;
const SLUG = 'team-102047';
const BRANCH = 'team/102047';
const PARENT_TEST_URL = 'postgres://collab:secret@127.0.0.1:5432/collab_app_test';
const DRAFT_DATABASE = 'collab_app_draft_team_102047';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function inFlightPath(base: string): string {
  return join(base, '.promote-in-flight.json');
}

function readInFlight(base: string): { project: number; draft: string; startedAt: string } | null {
  const path = inFlightPath(base);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as { project: number; draft: string; startedAt: string };
}

test('exec promote, discardDraft, listDrafts and draftDiff', async () => {
  const base = mkdtempSync(join(tmpdir(), 'cbe-promote-routes-'));
  const projectRoot = join(base, `mls-${PROJECT_ID}`);
  const draftRoot = join(base, 'drafts', SLUG, `mls-${PROJECT_ID}`);
  const prev = {
    dir: process.env.CBE_PROJECTS_DIR,
    rebuild: process.env.CBE_REBUILD_ON_SAVE,
    login: process.env.CBE_REQUIRE_LOGIN,
    testDatabase: process.env.DATABASE_URL_TEST,
  };
  process.env.CBE_PROJECTS_DIR = base;
  process.env.CBE_REBUILD_ON_SAVE = 'never';
  process.env.CBE_REQUIRE_LOGIN = 'never';
  process.env.DATABASE_URL_TEST = PARENT_TEST_URL;

  const scheduled: Array<number | undefined> = [];
  const origSchedule = promoteRouteHooks.scheduleRebuildOnSave;
  const origBusy = promoteRouteHooks.isRebuildInProgress;
  const origNow = promoteRouteHooks.now;
  const origStateDir = promoteRouteHooks.promoteStateDir;
  const origDrop = draftDbHooks.dropDatabase;
  const origRestart = draftDevHooks.restartDevProcess;
  const origFastForward = draftSyncHooks.fastForwardDraft;
  const origMergeMain = draftSyncHooks.mergeMainIntoDraft;
  const drops: Array<{ adminUrl: string; name: string }> = [];
  const restarts: Array<{ base: string; slug: string; clientProjectId: number }> = [];
  let ffCalls = 0;
  let dropError: Error | null = null;
  let rebuildBusy = false;
  let nowMs = Date.parse('2026-10-12T15:00:00.000Z');
  promoteRouteHooks.scheduleRebuildOnSave = (project) => {
    scheduled.push(project);
  };
  promoteRouteHooks.isRebuildInProgress = () => rebuildBusy;
  promoteRouteHooks.promoteStateDir = () => base;
  promoteRouteHooks.now = () => nowMs;
  draftDbHooks.dropDatabase = async (adminUrl, name) => {
    drops.push({ adminUrl, name });
    if (dropError) throw dropError;
  };
  draftSyncHooks.fastForwardDraft = async (opts) => {
    ffCalls += 1;
    return origFastForward(opts);
  };
  draftDevHooks.restartDevProcess = async (opts) => {
    restarts.push({ base: opts.base, slug: opts.slug, clientProjectId: opts.clientProjectId });
    return { port: 1, pid: 1, startedAt: 0, lastRequestAt: 0 };
  };

  const app = Fastify();
  registerCbeRoutes(app);
  try {
    git(base, ['init', '-b', 'main', projectRoot]);
    git(projectRoot, ['config', 'user.name', 'fixture']);
    git(projectRoot, ['config', 'user.email', 'fixture@test']);
    git(projectRoot, ['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(projectRoot, 'README'), 'base\n');
    git(projectRoot, ['add', 'README']);
    git(projectRoot, ['commit', '--no-verify', '-m', 'init']);
    mkdirSync(join(base, 'drafts', SLUG), { recursive: true });
    git(projectRoot, ['worktree', 'add', '-b', BRANCH, draftRoot]);
    mkdirSync(join(draftRoot, 'l2'), { recursive: true });
    writeFileSync(join(draftRoot, 'l2', 'note.ts'), 'draft\n');
    git(draftRoot, ['add', 'l2/note.ts']);
    git(draftRoot, ['commit', '--no-verify', '-m', 'draft note']);
    const mainBefore = git(projectRoot, ['rev-parse', 'HEAD']);

    const listed = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'listDrafts', project: PROJECT_ID },
    });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(listed.json().status, 'listed');
    assert.equal(listed.json().drafts.length, 1);
    assert.equal(listed.json().drafts[0].branch, BRANCH);
    assert.equal(listed.json().drafts[0].ahead, 1);
    assert.equal(listed.json().drafts[0].behind, 0);
    assert.deepEqual(listed.json().drafts[0].files, ['l2/note.ts']);

    const diff = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'draftDiff', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(diff.statusCode, 200, diff.body);
    assert.equal(diff.json().status, 'diff');
    assert.ok(diff.json().text.includes('l2/note.ts'), diff.json().text);

    const homolog = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'promote', project: PROJECT_ID, draft: SLUG, target: 'homolog', comment: 'nope' },
    });
    assert.equal(homolog.statusCode, 400, homolog.body);
    assert.equal(homolog.json().code, 'NOT_YET');
    assert.equal(git(projectRoot, ['rev-parse', 'HEAD']), mainBefore);

    const badTarget = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'promote', project: PROJECT_ID, draft: SLUG, target: 'staging' },
    });
    assert.equal(badTarget.statusCode, 400, badTarget.body);
    assert.equal(badTarget.json().code, 'BAD_TARGET');

    rebuildBusy = true;
    const busy = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'promote', project: PROJECT_ID, draft: SLUG, target: 'production', comment: 'busy' },
    });
    assert.equal(busy.statusCode, 409, busy.body);
    assert.equal(busy.json().code, 'REBUILD_BUSY');
    assert.equal(git(projectRoot, ['rev-parse', 'HEAD']), mainBefore);
    assert.equal(existsSync(inFlightPath(base)), false);
    rebuildBusy = false;

    writeFileSync(join(projectRoot, 'dirty.txt'), 'dirty\n');
    const dirty = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'promote', project: PROJECT_ID, draft: SLUG, target: 'production' },
    });
    assert.equal(dirty.statusCode, 409, dirty.body);
    assert.equal(dirty.json().code, 'MAIN_DIRTY');
    assert.equal(git(projectRoot, ['rev-parse', 'HEAD']), mainBefore);
    assert.equal(existsSync(inFlightPath(base)), false);
    rmSync(join(projectRoot, 'dirty.txt'));

    const merged = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'promote', project: PROJECT_ID, draft: SLUG, target: 'production', comment: 'ship it' },
    });
    assert.equal(merged.statusCode, 200, merged.body);
    assert.equal(merged.json().status, 'merged');
    assert.equal(merged.json().release, 'scheduled');
    assert.equal(merged.json().draftSync, 'fast_forwarded');
    assert.equal(merged.json().ref, git(projectRoot, ['rev-parse', 'HEAD']));
    assert.equal(ffCalls, 1);
    assert.equal(restarts.length, 1);
    assert.equal(restarts[0].slug, SLUG);
    assert.equal(restarts[0].clientProjectId, PROJECT_ID);
    assert.equal(git(draftRoot, ['rev-parse', 'HEAD']), merged.json().ref);
    assert.equal(git(projectRoot, ['log', '-1', '--format=%s']), `promote ${BRANCH}: ship it`);
    assert.equal(git(projectRoot, ['show', 'HEAD:l2/note.ts']), 'draft');
    assert.deepEqual(scheduled, [PROJECT_ID]);
    const claimed = readInFlight(base);
    assert.ok(claimed);
    assert.equal(claimed.project, PROJECT_ID);
    assert.equal(claimed.draft, SLUG);
    const publishing = await app.inject({ method: 'POST', url: '/exec', payload: { action: 'ping' } });
    assert.equal(publishing.statusCode, 200, publishing.body);
    assert.deepEqual(publishing.json().promoting, claimed);
    assert.equal(publishing.json().lastPromote, null);

    nowMs += 2000;
    const second = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'promote', project: PROJECT_ID, draft: SLUG, target: 'production', comment: 'again' },
    });
    assert.equal(second.statusCode, 409, second.body);
    assert.equal(second.json().code, 'PROMOTE_IN_PROGRESS');
    assert.deepEqual(readInFlight(base), claimed);

    nowMs += 29_000;
    const expired = await app.inject({ method: 'POST', url: '/exec', payload: { action: 'ping' } });
    assert.equal(expired.statusCode, 200, expired.body);
    assert.equal(expired.json().promoting, null);
    assert.equal(expired.json().lastPromote.status, 'rebuild-not-started');
    assert.equal(expired.json().lastPromote.project, PROJECT_ID);
    assert.equal(expired.json().lastPromote.draft, SLUG);
    assert.equal(existsSync(inFlightPath(base)), false);

    const nothing = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'promote', project: PROJECT_ID, draft: SLUG, target: 'production', comment: 'again' },
    });
    assert.equal(nothing.statusCode, 200, nothing.body);
    assert.equal(nothing.json().status, 'nothing_to_promote');
    assert.equal(existsSync(inFlightPath(base)), false);
    assert.deepEqual(scheduled, [PROJECT_ID]);
    assert.equal(ffCalls, 1);
    assert.equal(restarts.length, 1);

    writeFileSync(join(projectRoot, 'l2', 'note.ts'), 'main-edit\n');
    git(projectRoot, ['add', 'l2/note.ts']);
    git(projectRoot, ['commit', '--no-verify', '-m', 'main edit']);
    writeFileSync(join(draftRoot, 'l2', 'note.ts'), 'draft-edit\n');
    git(draftRoot, ['add', 'l2/note.ts']);
    git(draftRoot, ['commit', '--no-verify', '-m', 'draft edit']);
    const mainAtConflict = git(projectRoot, ['rev-parse', 'HEAD']);
    const conflict = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'promote', project: PROJECT_ID, draft: SLUG, target: 'production', comment: 'clash' },
    });
    assert.equal(conflict.statusCode, 409, conflict.body);
    assert.equal(conflict.json().code, 'DRAFT_CONFLICT');
    assert.deepEqual(conflict.json().files, ['l2/note.ts']);
    assert.equal(git(projectRoot, ['rev-parse', 'HEAD']), mainAtConflict);
    assert.equal(git(projectRoot, ['status', '--porcelain']), '');
    assert.equal(existsSync(inFlightPath(base)), false);
    assert.deepEqual(scheduled, [PROJECT_ID]);

    writeFileSync(inFlightPath(base), JSON.stringify({
      project: PROJECT_ID,
      draft: SLUG,
      startedAt: new Date(nowMs - 31_000).toISOString(),
    }));
    const stale = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'promote', project: PROJECT_ID, draft: SLUG, target: 'production', comment: 'stale' },
    });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(stale.json().code, 'DRAFT_CONFLICT');
    assert.equal(existsSync(inFlightPath(base)), false);

    const devJson = join(base, 'drafts', SLUG, 'dev.json');
    writeFileSync(devJson, JSON.stringify({
      port: 4100, pid: 2147483646, startedAt: 0, lastRequestAt: 0, database: DRAFT_DATABASE,
    }));
    const expected = parseDatabaseUrl(draftDatabaseUrl(PARENT_TEST_URL, SLUG));
    assert.ok(expected);
    assert.equal(drops.length, 0);
    const discarded = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'discardDraft', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(discarded.statusCode, 200, discarded.body);
    assert.equal(discarded.json().status, 'discarded');
    assert.equal(discarded.json().databaseDropped, true);
    assert.equal(existsSync(devJson), false);
    assert.deepEqual(drops, [{ adminUrl: expected.adminUrl, name: DRAFT_DATABASE }]);
    assert.equal(git(draftRoot, ['rev-parse', 'HEAD']), git(projectRoot, ['rev-parse', 'HEAD']));

    writeFileSync(join(draftRoot, 'l2', 'ship.ts'), 'shipped\n');
    git(draftRoot, ['add', 'l2/ship.ts']);
    git(draftRoot, ['commit', '--no-verify', '-m', 'ship after discard']);
    const shipped = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'promote', project: PROJECT_ID, draft: SLUG, target: 'production', comment: 'after discard' },
    });
    assert.equal(shipped.statusCode, 200, shipped.body);
    assert.equal(shipped.json().status, 'merged');
    assert.equal(shipped.json().draftSync, 'fast_forwarded');
    assert.equal(ffCalls, 2);
    assert.equal(restarts.length, 2);
    assert.ok(readInFlight(base));
    rebuildBusy = true;
    const assumed = await app.inject({ method: 'POST', url: '/exec', payload: { action: 'ping' } });
    assert.equal(assumed.statusCode, 200, assumed.body);
    assert.equal(assumed.json().promoting, null);
    assert.equal(existsSync(inFlightPath(base)), false);
    rebuildBusy = false;
    assert.deepEqual(scheduled, [PROJECT_ID, PROJECT_ID]);
    assert.deepEqual(drops, [{ adminUrl: expected.adminUrl, name: DRAFT_DATABASE }]);

    dropError = new Error('drop refused');
    writeFileSync(devJson, JSON.stringify({
      port: 4100, pid: 2147483646, startedAt: 0, lastRequestAt: 0, database: DRAFT_DATABASE,
    }));
    const failedDrop = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'discardDraft', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(failedDrop.statusCode, 200, failedDrop.body);
    assert.equal(failedDrop.json().status, 'discarded');
    assert.equal(failedDrop.json().databaseDropped, false);
    assert.equal(failedDrop.json().cause, 'drop refused');
    assert.equal(existsSync(devJson), false);
    assert.equal(drops.length, 2);
    assert.equal(drops[1].name, DRAFT_DATABASE);

    delete process.env.DATABASE_URL_TEST;
    writeFileSync(devJson, JSON.stringify({
      port: 4100, pid: 2147483646, startedAt: 0, lastRequestAt: 0, database: DRAFT_DATABASE,
    }));
    const missingUrl = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'discardDraft', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(missingUrl.statusCode, 200, missingUrl.body);
    assert.equal(missingUrl.json().databaseDropped, false);
    assert.equal(missingUrl.json().cause, 'DATABASE_URL_TEST is not set');
    assert.equal(existsSync(devJson), false);
    assert.equal(drops.length, 2);

    writeFileSync(join(draftRoot, 'l2', 'syncfail.ts'), 'fail\n');
    git(draftRoot, ['add', 'l2/syncfail.ts']);
    git(draftRoot, ['commit', '--no-verify', '-m', 'sync fail']);
    const restartsBeforeFail = restarts.length;
    draftSyncHooks.fastForwardDraft = async () => {
      ffCalls += 1;
      throw new Error('sync blew up');
    };
    const failedSync = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'promote', project: PROJECT_ID, draft: SLUG, target: 'production', comment: 'sync fails' },
    });
    assert.equal(failedSync.statusCode, 200, failedSync.body);
    assert.equal(failedSync.json().status, 'merged');
    assert.equal(failedSync.json().draftSync, 'failed');
    assert.equal(ffCalls, 3);
    assert.equal(restarts.length, restartsBeforeFail);
    nowMs += 31_000;

    writeFileSync(join(draftRoot, 'l2', 'syncstay.ts'), 'stay\n');
    git(draftRoot, ['add', 'l2/syncstay.ts']);
    git(draftRoot, ['commit', '--no-verify', '-m', 'sync stay']);
    draftSyncHooks.fastForwardDraft = async () => {
      ffCalls += 1;
      return { status: 'up_to_date' };
    };
    const stayed = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'promote', project: PROJECT_ID, draft: SLUG, target: 'production', comment: 'sync stays' },
    });
    assert.equal(stayed.statusCode, 200, stayed.body);
    assert.equal(stayed.json().status, 'merged');
    assert.equal(stayed.json().draftSync, 'up_to_date');
    assert.equal(ffCalls, 4);
    assert.equal(restarts.length, restartsBeforeFail);
    nowMs += 31_000;

    let mergeResult:
      | { status: 'merged'; ref: string }
      | { status: 'up_to_date' }
      | { status: 409; code: 'DRAFT_CONFLICT'; files: string[] } = { status: 'merged', ref: 'abc123' };
    draftSyncHooks.mergeMainIntoDraft = async () => mergeResult;
    const synced = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'draftSync', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(synced.statusCode, 200, synced.body);
    assert.equal(synced.json().status, 'merged');
    assert.equal(synced.json().ref, 'abc123');
    assert.equal(restarts.length, restartsBeforeFail + 1);

    mergeResult = { status: 409, code: 'DRAFT_CONFLICT', files: ['l2/note.ts'] };
    const conflictSync = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'draftSync', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(conflictSync.statusCode, 409, conflictSync.body);
    assert.equal(conflictSync.json().code, 'DRAFT_CONFLICT');
    assert.deepEqual(conflictSync.json().files, ['l2/note.ts']);
    assert.equal(restarts.length, restartsBeforeFail + 1);

    mergeResult = { status: 'up_to_date' };
    const currentSync = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'draftSync', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(currentSync.statusCode, 200, currentSync.body);
    assert.equal(currentSync.json().status, 'up_to_date');
    assert.equal(currentSync.json().ref, undefined);
    assert.equal(restarts.length, restartsBeforeFail + 1);

    process.env.CBE_REQUIRE_LOGIN = 'always';
    for (const payload of [
      { action: 'promote', project: PROJECT_ID, draft: SLUG, target: 'production' },
      { action: 'discardDraft', project: PROJECT_ID, draft: SLUG },
      { action: 'listDrafts', project: PROJECT_ID },
      { action: 'draftDiff', project: PROJECT_ID, draft: SLUG },
    ]) {
      const denied = await app.inject({ method: 'POST', url: '/exec', payload });
      assert.equal(denied.statusCode, 401, `${payload.action} ${denied.body}`);
      assert.equal(denied.json().msg, 'login required');
    }
    assert.deepEqual(scheduled, [PROJECT_ID, PROJECT_ID, PROJECT_ID, PROJECT_ID]);
  } finally {
    promoteRouteHooks.scheduleRebuildOnSave = origSchedule;
    promoteRouteHooks.isRebuildInProgress = origBusy;
    promoteRouteHooks.now = origNow;
    promoteRouteHooks.promoteStateDir = origStateDir;
    draftDbHooks.dropDatabase = origDrop;
    draftDevHooks.restartDevProcess = origRestart;
    draftSyncHooks.fastForwardDraft = origFastForward;
    draftSyncHooks.mergeMainIntoDraft = origMergeMain;
    await app.close();
    if (prev.dir === undefined) delete process.env.CBE_PROJECTS_DIR;
    else process.env.CBE_PROJECTS_DIR = prev.dir;
    if (prev.rebuild === undefined) delete process.env.CBE_REBUILD_ON_SAVE;
    else process.env.CBE_REBUILD_ON_SAVE = prev.rebuild;
    if (prev.login === undefined) delete process.env.CBE_REQUIRE_LOGIN;
    else process.env.CBE_REQUIRE_LOGIN = prev.login;
    if (prev.testDatabase === undefined) delete process.env.DATABASE_URL_TEST;
    else process.env.DATABASE_URL_TEST = prev.testDatabase;
    rmSync(base, { recursive: true, force: true });
  }
});
