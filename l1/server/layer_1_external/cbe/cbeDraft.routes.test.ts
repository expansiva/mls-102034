/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeDraft.routes.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { draftDevHooks, registerCbeRoutes } from '/_102034_/l1/server/layer_1_external/cbe/cbeRoutes.js';

const PROJECT_ID = 102047;
const SLUG = 'team-102047';
const BRANCH = 'team/102047';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function head(cwd: string): string {
  return git(cwd, ['rev-parse', 'HEAD']);
}

test('setContents: draft cookie commits on the draft branch and skips the release rebuild', async () => {
  const base = mkdtempSync(join(tmpdir(), 'cbe-draft-routes-'));
  const projectRoot = join(base, `mls-${PROJECT_ID}`);
  const draftRoot = join(base, 'drafts', SLUG, `mls-${PROJECT_ID}`);
  const prev = {
    dir: process.env.CBE_PROJECTS_DIR,
    commit: process.env.CBE_COMMIT_ON_SAVE,
    rebuild: process.env.CBE_REBUILD_ON_SAVE,
    login: process.env.CBE_REQUIRE_LOGIN,
  };
  process.env.CBE_PROJECTS_DIR = base;
  process.env.CBE_COMMIT_ON_SAVE = 'always';
  process.env.CBE_REBUILD_ON_SAVE = 'never';
  process.env.CBE_REQUIRE_LOGIN = 'never';

  const logs: string[] = [];
  const origInfo = console.info;
  console.info = (...args: unknown[]) => {
    logs.push(args.map((part) => String(part)).join(' '));
    origInfo.apply(console, args);
  };

  const app = Fastify();
  registerCbeRoutes(app);
  const restarts: Array<{ base: string; slug: string; clientProjectId: number }> = [];
  const reaperBases: string[] = [];
  const origRestart = draftDevHooks.restartDevProcess;
  const origReaper = draftDevHooks.ensureDevReaper;
  draftDevHooks.restartDevProcess = (opts) => {
    restarts.push({ base: opts.base, slug: opts.slug, clientProjectId: opts.clientProjectId });
    return new Promise(() => {});
  };
  draftDevHooks.ensureDevReaper = (dir) => {
    reaperBases.push(dir);
  };
  try {
    git(base, ['init', '-b', 'main', projectRoot]);
    git(projectRoot, ['config', 'user.name', 'fixture']);
    git(projectRoot, ['config', 'user.email', 'fixture@test']);
    git(projectRoot, ['config', 'commit.gpgsign', 'false']);
    git(projectRoot, ['commit', '--allow-empty', '-m', 'init', '--no-verify']);
    const mainAtStart = head(projectRoot);

    const draftRes = await app.inject({
      method: 'POST',
      url: '/exec',
      headers: { cookie: `collab-draft=${SLUG}` },
      payload: {
        action: 'setContents',
        project: PROJECT_ID,
        files: [{ shortPath: 'l2/draft.ts', content: 'export const draft = 1;\n', encoding: 'utf8' }],
        comments: 'draft save',
      },
    });
    assert.equal(draftRes.statusCode, 200, draftRes.body);
    const draftBody = draftRes.json();
    assert.equal(draftBody.commit.status, 'committed');
    assert.deepEqual(draftBody.draft, { slug: SLUG, branch: BRANCH });
    assert.equal(readFileSync(join(draftRoot, 'l2/draft.ts'), 'utf8'), 'export const draft = 1;\n');
    assert.equal(existsSync(join(projectRoot, 'l2/draft.ts')), false);
    assert.equal(git(draftRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), BRANCH);
    assert.equal(git(draftRoot, ['log', '-1', '--format=%s']), 'draft save');
    assert.equal(head(projectRoot), mainAtStart);
    assert.ok(logs.some((line) => line === `[cbe] draft ${SLUG}: no release rebuild`));
    assert.ok(logs.some((line) => line === `[cbe] draft ${SLUG}: l2/l3 only, no restart`));
    assert.deepEqual(restarts, []);
    assert.deepEqual(reaperBases, [base]);

    const readDraft = await app.inject({
      method: 'POST',
      url: '/exec',
      headers: { cookie: `collab-draft=${SLUG}` },
      payload: { action: 'getContents', project: PROJECT_ID, shortPaths: ['l2/draft.ts'] },
    });
    assert.equal(readDraft.statusCode, 200);
    assert.equal(readDraft.json().files[0].content, 'export const draft = 1;\n');
    assert.deepEqual(readDraft.json().draft, { slug: SLUG, branch: BRANCH });

    const viewed = await app.inject({
      method: 'GET',
      url: `/cbe/source?project=${PROJECT_ID}&path=l2/draft.ts`,
      headers: { cookie: `collab-draft=${SLUG}` },
    });
    assert.equal(viewed.statusCode, 200);
    assert.equal(viewed.body, 'export const draft = 1;\n');

    const history = await app.inject({
      method: 'POST',
      url: '/exec',
      headers: { cookie: `collab-draft=${SLUG}` },
      payload: { action: 'getHistory', project: PROJECT_ID, shortPath: 'l2/draft.ts' },
    });
    assert.equal(history.json().history[0].message, 'draft save');
    const ref = history.json().history[0].ref as string;
    const atRef = await app.inject({
      method: 'POST',
      url: '/exec',
      headers: { cookie: `collab-draft=${SLUG}` },
      payload: { action: 'getHistoryContent', project: PROJECT_ID, shortPath: 'l2/draft.ts', ref },
    });
    assert.equal(atRef.json().content, 'export const draft = 1;\n');

    logs.length = 0;
    const plain = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: {
        action: 'setContents',
        project: PROJECT_ID,
        files: [{ shortPath: 'l2/plain.ts', content: 'export const plain = 1;\n', encoding: 'utf8' }],
        comments: 'main save',
      },
    });
    assert.equal(plain.statusCode, 200, plain.body);
    assert.equal(plain.json().commit.status, 'committed');
    assert.equal(plain.json().draft, null);
    assert.equal(readFileSync(join(projectRoot, 'l2/plain.ts'), 'utf8'), 'export const plain = 1;\n');
    assert.equal(git(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
    assert.equal(git(projectRoot, ['log', '-1', '--format=%s']), 'main save');
    assert.notEqual(head(projectRoot), mainAtStart);
    assert.equal(logs.some((line) => line.includes('no release rebuild')), false);
    assert.deepEqual(restarts, []);
    assert.deepEqual(reaperBases, [base]);

    const mainBeforeInvalid = head(projectRoot);
    logs.length = 0;
    const invalid = await app.inject({
      method: 'POST',
      url: '/exec',
      headers: { cookie: 'collab-draft=nope' },
      payload: {
        action: 'setContents',
        project: PROJECT_ID,
        files: [{ shortPath: 'l2/bad.ts', content: 'export const bad = 1;\n', encoding: 'utf8' }],
        comments: 'invalid cookie save',
      },
    });
    assert.equal(invalid.statusCode, 200, invalid.body);
    assert.equal(invalid.json().draft, null);
    assert.equal(invalid.json().commit.status, 'committed');
    assert.equal(readFileSync(join(projectRoot, 'l2/bad.ts'), 'utf8'), 'export const bad = 1;\n');
    assert.equal(git(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
    assert.notEqual(head(projectRoot), mainBeforeInvalid);
    assert.equal(existsSync(join(base, 'drafts', 'nope')), false);
    assert.equal(logs.some((line) => line.includes('no release rebuild')), false);

    const l1Save = await app.inject({
      method: 'POST',
      url: '/exec',
      headers: { cookie: `collab-draft=${SLUG}` },
      payload: {
        action: 'setContents',
        project: PROJECT_ID,
        files: [{ shortPath: 'l1/usecase.ts', content: 'export const n = 42;\n', encoding: 'utf8' }],
        comments: 'l1 save',
      },
    });
    assert.equal(l1Save.statusCode, 200, l1Save.body);
    assert.equal(readFileSync(join(draftRoot, 'l1/usecase.ts'), 'utf8'), 'export const n = 42;\n');
    assert.deepEqual(restarts, [{ base, slug: SLUG, clientProjectId: PROJECT_ID }]);

    const l1Delete = await app.inject({
      method: 'POST',
      url: '/exec',
      headers: { cookie: `collab-draft=${SLUG}` },
      payload: {
        action: 'setContents',
        project: PROJECT_ID,
        deletes: ['l1/usecase.ts'],
        comments: 'l1 delete',
      },
    });
    assert.equal(l1Delete.statusCode, 200, l1Delete.body);
    assert.equal(existsSync(join(draftRoot, 'l1/usecase.ts')), false);
    assert.deepEqual(restarts, [
      { base, slug: SLUG, clientProjectId: PROJECT_ID },
      { base, slug: SLUG, clientProjectId: PROJECT_ID },
    ]);
  } finally {
    draftDevHooks.restartDevProcess = origRestart;
    draftDevHooks.ensureDevReaper = origReaper;
    console.info = origInfo;
    await app.close();
    if (prev.dir === undefined) delete process.env.CBE_PROJECTS_DIR;
    else process.env.CBE_PROJECTS_DIR = prev.dir;
    if (prev.commit === undefined) delete process.env.CBE_COMMIT_ON_SAVE;
    else process.env.CBE_COMMIT_ON_SAVE = prev.commit;
    if (prev.rebuild === undefined) delete process.env.CBE_REBUILD_ON_SAVE;
    else process.env.CBE_REBUILD_ON_SAVE = prev.rebuild;
    if (prev.login === undefined) delete process.env.CBE_REQUIRE_LOGIN;
    else process.env.CBE_REQUIRE_LOGIN = prev.login;
    rmSync(base, { recursive: true, force: true });
  }
});
