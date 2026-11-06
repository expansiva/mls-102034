/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeSetContentsBig.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import Fastify from 'fastify';
import { draftDevHooks, registerCbeRoutes } from '/_102034_/l1/server/layer_1_external/cbe/cbeRoutes.js';
import { MAX_PART_CHARS, MAX_UPLOAD_CHARS, storePart } from '/_102034_/l1/server/layer_1_external/cbe/cbeUploads.js';

// rt189: setContents takes a compressed file (gzip-base64) and a file in parts (setContentsPart), up to 64 MB, in one commit.
const PROJECT_ID = 102047;
const SLUG = 'team-102047';
const MB = 1024 * 1024;

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

interface Env {
  base: string;
  root: string;
  draftRoot: string;
  app: ReturnType<typeof Fastify>;
  exec: (payload: Record<string, unknown>, headers?: Record<string, string>) => Promise<{ statusCode: number; json: () => Record<string, unknown> }>;
  /** Commits of the draft beyond the initial one. */
  commits: () => number;
}

async function withProject(run: (env: Env) => Promise<void>): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), 'cbe-big-'));
  const root = join(base, `mls-${PROJECT_ID}`);
  const keep = { dir: process.env.CBE_PROJECTS_DIR, login: process.env.CBE_REQUIRE_LOGIN, commit: process.env.CBE_COMMIT_ON_SAVE, rebuild: process.env.CBE_REBUILD_ON_SAVE };
  Object.assign(process.env, { CBE_PROJECTS_DIR: base, CBE_REQUIRE_LOGIN: 'never', CBE_COMMIT_ON_SAVE: 'always', CBE_REBUILD_ON_SAVE: 'never' });
  const restore = { restart: draftDevHooks.restartDevProcess, reaper: draftDevHooks.ensureDevReaper };
  draftDevHooks.restartDevProcess = () => new Promise(() => {});
  draftDevHooks.ensureDevReaper = () => {};
  const app = Fastify();
  registerCbeRoutes(app);
  try {
    git(base, ['init', '-q', '-b', 'main', root]);
    git(root, ['config', 'user.name', 'fixture']);
    git(root, ['config', 'user.email', 'fixture@test']);
    git(root, ['config', 'commit.gpgsign', 'false']);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
    const draftRoot = join(base, 'drafts', SLUG, `mls-${PROJECT_ID}`);
    const exec: Env['exec'] = (payload, headers = {}) => app.inject({ method: 'POST', url: '/exec', headers, payload: { project: PROJECT_ID, ...payload } });
    await run({ base, root, draftRoot, app, exec, commits: () => (existsSync(draftRoot) ? Number(git(draftRoot, ['rev-list', '--count', 'HEAD'])) - 1 : 0) });
  } finally {
    await app.close();
    draftDevHooks.restartDevProcess = restore.restart;
    draftDevHooks.ensureDevReaper = restore.reaper;
    for (const [key, value] of Object.entries({ CBE_PROJECTS_DIR: keep.dir, CBE_REQUIRE_LOGIN: keep.login, CBE_COMMIT_ON_SAVE: keep.commit, CBE_REBUILD_ON_SAVE: keep.rebuild })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(base, { recursive: true, force: true });
  }
}

/** The text of a file split in parts of `size` characters. */
function split(text: string, size: number): string[] {
  const parts: string[] = [];
  for (let at = 0; at < text.length; at += size) parts.push(text.slice(at, at + size));
  return parts;
}

test('gzip-base64: a compressed file is written as the original bytes; text and base64 files keep working', async () => {
  await withProject(async ({ exec, draftRoot }) => {
    const original = Buffer.from('export const big = "x";\n'.repeat(1000));
    const res = await exec({
      action: 'setContents',
      files: [
        { shortPath: 'l2/zipped.ts', content: gzipSync(original).toString('base64'), encoding: 'gzip-base64' },
        { shortPath: 'l2/plain.ts', content: 'export const plain = 1;\n', encoding: 'utf8' },
        { shortPath: 'l2/noenc.ts', content: 'export const noenc = 1;\n' },
        { shortPath: 'l3/pic.bin', content: Buffer.from([1, 2, 3, 255]).toString('base64'), encoding: 'base64' },
      ],
      comments: 'mixed',
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.json()));
    assert.deepEqual(readFileSync(join(draftRoot, 'l2/zipped.ts')), original);
    assert.equal(readFileSync(join(draftRoot, 'l2/plain.ts'), 'utf8'), 'export const plain = 1;\n');
    assert.equal(readFileSync(join(draftRoot, 'l2/noenc.ts'), 'utf8'), 'export const noenc = 1;\n');
    assert.deepEqual(readFileSync(join(draftRoot, 'l3/pic.bin')), Buffer.from([1, 2, 3, 255]));
  });
});

test('a 12 MB file in parts, plus a normal file, lands in ONE commit; the parts are removed afterwards', async () => {
  await withProject(async ({ exec, base, draftRoot, root, commits }) => {
    const original = randomBytes(12 * MB);
    const text = gzipSync(original).toString('base64');
    const parts = split(text, MAX_PART_CHARS);
    assert.ok(parts.length >= 5, `${parts.length} parts`);
    const uploadId = randomUUID();
    for (let index = 0; index < parts.length; index += 1) {
      const res = await exec({ action: 'setContentsPart', uploadId, index, total: parts.length, data: parts[index] });
      assert.equal(res.statusCode, 200, JSON.stringify(res.json()));
      assert.equal(res.json().received, index + 1);
    }
    assert.ok(existsSync(join(base, '.cbe-uploads', String(PROJECT_ID), SLUG, uploadId, '0')), 'kept outside the git tree, by project and draft');
    assert.equal(existsSync(join(root, '.cbe-uploads')), false);
    const before = commits();
    const saved = await exec({
      action: 'setContents',
      files: [
        { shortPath: 'l2/release.js', uploadId, encoding: 'gzip-base64', sha256: sha256(original) },
        { shortPath: 'l2/other.ts', content: 'export const other = 1;\n', encoding: 'utf8' },
      ],
      comments: 'big',
    });
    assert.equal(saved.statusCode, 200, JSON.stringify(saved.json()));
    assert.deepEqual(readFileSync(join(draftRoot, 'l2/release.js')), original);
    assert.equal(commits() - before, 1, 'one commit for the file in parts and the normal file');
    assert.deepEqual(git(draftRoot, ['show', '--name-only', '--format=', 'HEAD']).split('\n').sort(), ['l2/other.ts', 'l2/release.js']);
    assert.equal(existsSync(join(base, '.cbe-uploads', String(PROJECT_ID), SLUG, uploadId)), false, 'the used parts are removed');
  });
});

test('a missing part, a wrong sha256 and an unknown upload are 400 with the reason, and NOTHING is written (not even the other files)', async () => {
  await withProject(async ({ exec, draftRoot, commits }) => {
    const original = Buffer.from('export const a = 1;\n'.repeat(50));
    const text = original.toString('base64');
    const [first, second] = [text.slice(0, 40), text.slice(40)];
    const uploadId = randomUUID();
    await exec({ action: 'setContentsPart', uploadId, index: 0, total: 3, data: first });
    await exec({ action: 'setContentsPart', uploadId, index: 2, total: 3, data: second });
    const base = { action: 'setContents', files: [{ shortPath: 'l2/never-written.ts', content: 'x', encoding: 'utf8' }] };
    const before = commits();

    const missing = await exec({ ...base, files: [...base.files, { shortPath: 'l2/big.ts', uploadId, encoding: 'base64', sha256: sha256(original) }] });
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.json().msg, `upload ${uploadId}: missing part 1`);

    await exec({ action: 'setContentsPart', uploadId, index: 1, total: 3, data: '' });
    const wrong = await exec({ ...base, files: [...base.files, { shortPath: 'l2/big.ts', uploadId, encoding: 'base64', sha256: sha256(Buffer.from('other')) }] });
    assert.equal(wrong.statusCode, 400);
    assert.equal(wrong.json().msg, `upload ${uploadId}: sha256 mismatch`);

    const ghost = randomUUID();
    const unknown = await exec({ ...base, files: [{ shortPath: 'l2/big.ts', uploadId: ghost, encoding: 'base64', sha256: sha256(original) }] });
    assert.equal(unknown.statusCode, 400);
    assert.equal(unknown.json().msg, `upload ${ghost}: unknown`);

    assert.equal(existsSync(join(draftRoot, 'l2/never-written.ts')), false, 'the normal file of the same request was not written');
    assert.equal(existsSync(join(draftRoot, 'l2/big.ts')), false);
    assert.equal(commits() - before, 0, 'no commit');
  });
});

test('expired: an upload older than one hour is refused as expired, and then swept', async () => {
  await withProject(async ({ exec, base }) => {
    const uploadId = randomUUID();
    const data = Buffer.from('hello').toString('base64');
    await exec({ action: 'setContentsPart', uploadId, index: 0, total: 1, data });
    const dir = join(base, '.cbe-uploads', String(PROJECT_ID), SLUG, uploadId);
    const old = new Date(Date.now() - 61 * 60 * 1000);
    for (const name of readdirSync(dir)) utimesSync(join(dir, name), old, old);
    const res = await exec({ action: 'setContents', files: [{ shortPath: 'l2/late.ts', uploadId, encoding: 'base64', sha256: sha256(Buffer.from('hello')) }] });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().msg, `upload ${uploadId}: expired`);
    assert.equal(existsSync(dir), false, 'the expired upload is removed after being reported');
  });
});

test('limits: 64 MB per file (a small gzip that inflates past it), 3 MB per part, 64 parts, UUID, index; and the whole upload may not pile up past a 64 MB file', async () => {
  await withProject(async ({ exec, base }) => {
    const bomb = gzipSync(Buffer.alloc(70 * MB)).toString('base64');
    assert.ok(bomb.length < 1 * MB, 'the bomb is small on the wire');
    const over = await exec({ action: 'setContents', files: [{ shortPath: 'l2/bomb.ts', content: bomb, encoding: 'gzip-base64' }] });
    assert.equal(over.statusCode, 400);
    assert.equal(over.json().msg, 'file l2/bomb.ts exceeds 64 MB');
    const exact = await exec({ action: 'setContents', files: [{ shortPath: 'l2/zeros.bin', content: gzipSync(Buffer.alloc(64 * MB)).toString('base64'), encoding: 'gzip-base64' }] });
    assert.equal(exact.statusCode, 200, 'exactly 64 MB passes');

    const id = randomUUID();
    const bad = async (payload: Record<string, unknown>) => (await exec({ action: 'setContentsPart', ...payload })).json().msg;
    assert.equal(await bad({ uploadId: id, index: 0, total: 1, data: 'a'.repeat(MAX_PART_CHARS + 1) }), 'part exceeds 3 MB');
    assert.match(String(await bad({ uploadId: id, index: 0, total: 65, data: 'a' })), /invalid total/u);
    assert.match(String(await bad({ uploadId: id, index: 3, total: 3, data: 'a' })), /invalid index/u);
    assert.match(String(await bad({ uploadId: 'not-a-uuid', index: 0, total: 1, data: 'a' })), /invalid uploadId/u);
    assert.match(String(await bad({ uploadId: id, index: 0, total: 1 })), /invalid data/u);
    assert.equal(existsSync(join(base, '.cbe-uploads', String(PROJECT_ID), SLUG, id)), false, 'a refused part keeps nothing');

    // the accumulated text of one upload: 28 parts of 3 MB fit, the 29th does not (the base64 of 64 MB is the ceiling)
    const piled = randomUUID();
    const chunk = 'a'.repeat(MAX_PART_CHARS);
    for (let index = 0; index < 28; index += 1) assert.equal(storePart(base, PROJECT_ID, SLUG, { uploadId: piled, index, total: 64, data: chunk }).ok, true, `part ${index}`);
    const last = storePart(base, PROJECT_ID, SLUG, { uploadId: piled, index: 28, total: 64, data: chunk });
    assert.deepEqual(last, { ok: false, msg: `upload ${piled}: exceeds 64 MB` });
    assert.ok(28 * MAX_PART_CHARS <= MAX_UPLOAD_CHARS && 29 * MAX_PART_CHARS > MAX_UPLOAD_CHARS);
  });
});

test('a repeated part overwrites (safe to resend) and a different total is refused', async () => {
  await withProject(async ({ exec }) => {
    const uploadId = randomUUID();
    const one = await exec({ action: 'setContentsPart', uploadId, index: 0, total: 2, data: 'AAAA' });
    const again = await exec({ action: 'setContentsPart', uploadId, index: 0, total: 2, data: 'AAAA' });
    assert.equal(one.json().received, 1);
    assert.equal(again.json().received, 1, 'the same part sent again is still one part');
    const changed = await exec({ action: 'setContentsPart', uploadId, index: 1, total: 3, data: 'BBBB' });
    assert.equal(changed.statusCode, 400);
    assert.match(String(changed.json().msg), /total changed/u);
  });
});

test('the parts wait in the draft that will use them: another draft does not see them', async () => {
  await withProject(async ({ exec, base }) => {
    const uploadId = randomUUID();
    const bytes = Buffer.from('shared?');
    await exec({ action: 'setContentsPart', uploadId, index: 0, total: 1, data: bytes.toString('base64') });
    assert.ok(existsSync(join(base, '.cbe-uploads', String(PROJECT_ID), SLUG, uploadId)));
    const person = 'user-0123456789abcdef';
    const elsewhere = await exec({ action: 'setContents', files: [{ shortPath: 'l2/x.ts', uploadId, encoding: 'base64', sha256: sha256(bytes) }] }, { cookie: `collab-draft=${person}` });
    assert.equal(elsewhere.statusCode, 400);
    assert.equal(elsewhere.json().msg, `upload ${uploadId}: unknown`);
    const same = await exec({ action: 'setContents', files: [{ shortPath: 'l2/x.ts', uploadId, encoding: 'base64', sha256: sha256(bytes) }] });
    assert.equal(same.statusCode, 200, JSON.stringify(same.json()));
  });
});

test('an entry with neither content nor uploadId is a 400, not a 500', async () => {
  await withProject(async ({ exec }) => {
    const res = await exec({ action: 'setContents', files: [{ shortPath: 'l2/empty.ts' }] });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().msg, 'file l2/empty.ts: content or uploadId is required');
  });
});
