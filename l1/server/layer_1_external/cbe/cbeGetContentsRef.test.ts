/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeGetContentsRef.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { draftDevHooks, registerCbeRoutes } from '/_102034_/l1/server/layer_1_external/cbe/cbeRoutes.js';

// rt188: getContents with `ref` reads many files of one commit in ONE git process.
const PROJECT_ID = 102047;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe]);

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

interface Env {
  base: string;
  root: string;
  oldRef: string;
  app: ReturnType<typeof Fastify>;
}

async function withProject(run: (env: Env) => Promise<void>): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), 'cbe-ref-'));
  const root = join(base, `mls-${PROJECT_ID}`);
  const keep = { dir: process.env.CBE_PROJECTS_DIR, login: process.env.CBE_REQUIRE_LOGIN, commit: process.env.CBE_COMMIT_ON_SAVE, rebuild: process.env.CBE_REBUILD_ON_SAVE };
  process.env.CBE_PROJECTS_DIR = base;
  process.env.CBE_REQUIRE_LOGIN = 'never';
  const app = Fastify();
  registerCbeRoutes(app);
  try {
    git(base, ['init', '-q', '-b', 'main', root]);
    git(root, ['config', 'user.name', 'fixture']);
    git(root, ['config', 'user.email', 'fixture@test']);
    git(root, ['config', 'commit.gpgsign', 'false']);
    mkdirSync(join(root, 'l2'), { recursive: true });
    mkdirSync(join(root, 'l3'), { recursive: true });
    writeFileSync(join(root, 'l2', 'keep.ts'), 'export const keep = 1;\n');
    writeFileSync(join(root, 'l2', 'changed.ts'), 'export const changed = "old";\n');
    writeFileSync(join(root, 'l2', 'gone.ts'), 'export const gone = true;\n');
    writeFileSync(join(root, 'l2', 'before-rename.ts'), 'export const renamed = 1;\n');
    writeFileSync(join(root, 'l3', 'pic.png'), PNG);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'old']);
    const oldRef = git(root, ['rev-parse', 'HEAD']);
    // afterwards: one file changed, one deleted, one renamed
    writeFileSync(join(root, 'l2', 'changed.ts'), 'export const changed = "new";\n');
    git(root, ['rm', '-q', 'l2/gone.ts']);
    git(root, ['mv', 'l2/before-rename.ts', 'l2/after-rename.ts']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'new']);
    await run({ base, root, oldRef, app });
  } finally {
    await app.close();
    for (const [key, value] of Object.entries({ CBE_PROJECTS_DIR: keep.dir, CBE_REQUIRE_LOGIN: keep.login, CBE_COMMIT_ON_SAVE: keep.commit, CBE_REBUILD_ON_SAVE: keep.rebuild })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(base, { recursive: true, force: true });
  }
}

async function post(app: ReturnType<typeof Fastify>, payload: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app.inject({ method: 'POST', url: '/exec', headers, payload: { action: 'getContents', project: PROJECT_ID, ...payload } });
}

test('with ref: the files as they were in the commit (changed, deleted-later, binary, renamed-later); missing ones left out', async () => {
  await withProject(async ({ app, oldRef }) => {
    const res = await post(app, { ref: oldRef, shortPaths: ['l2/keep.ts', 'l2/changed.ts', 'l2/gone.ts', 'l3/pic.png', 'l2/after-rename.ts', 'l2/never.ts'] });
    assert.equal(res.statusCode, 200, res.body);
    const files = res.json().files as Array<{ shortPath: string; content: string; encoding: string }>;
    const byPath = Object.fromEntries(files.map((file) => [file.shortPath, file]));
    assert.deepEqual(files.map((file) => file.shortPath), ['l2/keep.ts', 'l2/changed.ts', 'l2/gone.ts', 'l3/pic.png', 'l2/after-rename.ts'], 'the order of the request; the file that never existed is left out');
    assert.equal(byPath['l2/changed.ts'].content, 'export const changed = "old";\n', 'the content of the commit, not the current one');
    assert.equal(byPath['l2/gone.ts'].content, 'export const gone = true;\n', 'a file deleted afterwards is still there at the commit');
    assert.deepEqual([byPath['l3/pic.png'].encoding, Buffer.from(byPath['l3/pic.png'].content, 'base64').equals(PNG)], ['base64', true], 'binary comes back base64 and byte for byte');
    assert.equal(byPath['l2/keep.ts'].encoding, 'utf8');
    assert.equal(byPath['l2/after-rename.ts'].content, 'export const renamed = 1;\n', 'a file renamed afterwards is found under the name it had then');
  });
});

test('without ref nothing changes: the working tree answers', async () => {
  await withProject(async ({ app }) => {
    const res = await post(app, { shortPaths: ['l2/changed.ts', 'l2/gone.ts'] });
    assert.equal(res.statusCode, 200);
    assert.deepEqual((res.json().files as Array<{ shortPath: string; content: string }>).map((file) => [file.shortPath, file.content]), [['l2/changed.ts', 'export const changed = "new";\n']]);
  });
});

test('an invalid ref, an unknown commit and too many paths are 400, not an empty list', async () => {
  await withProject(async ({ app }) => {
    for (const ref of ['local', 'HEAD', '--output=x', 'zz12345', 'abc', 123]) {
      const res = await post(app, { ref, shortPaths: ['l2/keep.ts'] });
      assert.equal(res.statusCode, 400, `ref ${String(ref)}`);
      assert.equal(res.json().msg, 'invalid ref');
    }
    const unknown = await post(app, { ref: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', shortPaths: ['l2/keep.ts'] });
    assert.equal(unknown.statusCode, 400);
    assert.equal(unknown.json().msg, 'invalid ref');
  });
});

test('the limit is 500 paths per request with a ref: 500 passes, 501 is a 400', async () => {
  await withProject(async ({ app, oldRef }) => {
    const paths = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? 'l2/keep.ts' : `l2/missing-${i}.ts`));
    const ok = await post(app, { ref: oldRef, shortPaths: paths(500) });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().files.length, 1);
    const over = await post(app, { ref: oldRef, shortPaths: paths(501) });
    assert.equal(over.statusCode, 400);
    assert.match(over.json().msg, /too many shortPaths .*max 500/u);
  });
});

test('a path the project boundary rejects, or one with a newline, is left out (and cannot add objects to the batch)', async () => {
  await withProject(async ({ app, oldRef }) => {
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => { warns.push(args.map(String).join(' ')); };
    try {
      const res = await post(app, { ref: oldRef, shortPaths: ['../escape.ts', 'l2/keep.ts\nHEAD:l2/changed.ts', 'l2/keep.ts'] });
      assert.equal(res.statusCode, 200);
      assert.deepEqual((res.json().files as Array<{ shortPath: string }>).map((file) => file.shortPath), ['l2/keep.ts']);
    } finally {
      console.warn = original;
    }
    assert.ok(warns.some((line) => line.includes('rejected shortPath "../escape.ts"')));
  });
});

test('ONE git process per request, whatever the number of files (not one per file)', async () => {
  await withProject(async ({ app, oldRef, base }) => {
    // a git wrapper on the PATH that counts how many times it runs; the real git does the work
    const bin = join(base, 'bin');
    mkdirSync(bin, { recursive: true });
    const real = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const counter = join(base, 'git-calls.log');
    writeFileSync(join(bin, 'git'), `#!/bin/sh\necho "$@" >> "${counter}"\nexec "${real}" "$@"\n`, { mode: 0o755 });
    const keepPath = process.env.PATH;
    process.env.PATH = `${bin}:${keepPath}`;
    try {
      const many = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 'l2/keep.ts' : 'l2/changed.ts'));
      const res = await post(app, { ref: oldRef, shortPaths: many });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().files.length, 60);
      const calls = execFileSync('cat', [counter], { encoding: 'utf8' }).trim().split('\n');
      const catBatches = calls.filter((line) => line.includes('cat-file --batch'));
      assert.equal(catBatches.length, 1, `calls: ${calls.join(' | ')}`);
      assert.equal(calls.length, 3, `a rev-parse of the commit, the repo check and the single batch: ${calls.join(' | ')}`);
      assert.equal(calls.filter((line) => /\bshow\b/u.test(line)).length, 0, 'no git show per file');
    } finally {
      process.env.PATH = keepPath;
    }
  });
});

test('with the draft header it reads the draft tree', async () => {
  await withProject(async ({ app, base, root }) => {
    process.env.CBE_COMMIT_ON_SAVE = 'always';
    process.env.CBE_REBUILD_ON_SAVE = 'never';
    const restore = { restart: draftDevHooks.restartDevProcess, reaper: draftDevHooks.ensureDevReaper };
    draftDevHooks.restartDevProcess = () => new Promise(() => {});
    draftDevHooks.ensureDevReaper = () => {};
    try {
      const headers = { cookie: 'collab-draft=team-102047' };
      const saved = await app.inject({ method: 'POST', url: '/exec', headers, payload: { action: 'setContents', project: PROJECT_ID, files: [{ shortPath: 'l2/draft-only.ts', content: 'export const d = 1;\n', encoding: 'utf8' }], comments: 'draft save' } });
      assert.equal(saved.statusCode, 200, saved.body);
      const draftRoot = join(base, 'drafts', 'team-102047', `mls-${PROJECT_ID}`);
      const draftRef = git(draftRoot, ['rev-parse', 'HEAD']);
      assert.notEqual(draftRef, git(root, ['rev-parse', 'HEAD']));
      const res = await post(app, { ref: draftRef, shortPaths: ['l2/draft-only.ts', 'l2/keep.ts'] }, headers);
      assert.equal(res.statusCode, 200, res.body);
      assert.deepEqual((res.json().files as Array<{ shortPath: string; content: string }>).map((file) => [file.shortPath, file.content]), [['l2/draft-only.ts', 'export const d = 1;\n'], ['l2/keep.ts', 'export const keep = 1;\n']]);
      assert.deepEqual(res.json().draft, { slug: 'team-102047', branch: 'team/102047' });
    } finally {
      draftDevHooks.restartDevProcess = restore.restart;
      draftDevHooks.ensureDevReaper = restore.reaper;
    }
  });
});
