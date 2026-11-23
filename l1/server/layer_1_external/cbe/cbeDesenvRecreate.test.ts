/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeDesenvRecreate.test.ts" enhancement="_blank" />
// Recreate uses the real git binary. An injected git cannot show a deleted branch or folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { draftSlugForUser, ensureDraftWorktree, readDraftOwner, writeDraftOwner } from '/_102034_/l1/server/layer_1_external/cbe/cbeDraft.js';
import { desenvIo, prepareDraft } from '/_102034_/l1/server/layer_1_external/cbe/cbeDesenv.js';

const EMAIL = 'ana@x.com';

function g(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
}

function isAncestor(repo: string, ancestor: string, descendant: string): boolean {
  try {
    g(repo, 'merge-base', '--is-ancestor', ancestor, descendant);
    return true;
  } catch {
    return false;
  }
}

async function withStubbedDev<T>(fn: () => Promise<T>): Promise<T> {
  const orig = desenvIo.ensureDevProcess;
  desenvIo.ensureDevProcess = () => ({ port: 4100, pid: 1, startedAt: 0, lastRequestAt: 0 });
  try {
    return await fn();
  } finally {
    desenvIo.ensureDevProcess = orig;
  }
}

function captureWarn(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '));
  };
  return { lines, restore: () => { console.warn = orig; } };
}

test('a draft with two commits off main and behind main is recreated from main', async () => {
  const base = mkdtempSync(join(tmpdir(), 'recreate-diverged-'));
  const repo = join(base, 'mls-1');
  mkdirSync(repo, { recursive: true });
  g(repo, 'init', '-b', 'main');
  writeFileSync(join(repo, 'a.txt'), '1\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-m', 'init');

  const { slug, branch } = draftSlugForUser(EMAIL);
  await writeDraftOwner(base, slug, EMAIL);
  const wt = await ensureDraftWorktree({ base, projectId: 1, slug, branch });
  writeFileSync(join(base, 'drafts', slug, 'old-folder.txt'), 'old\n');
  const oldIno = statSync(wt).ino;
  writeFileSync(join(wt, 'b.txt'), 'one\n');
  g(wt, 'add', '.');
  g(wt, 'commit', '-m', 'draft one');
  writeFileSync(join(wt, 'c.txt'), 'two\n');
  g(wt, 'add', '.');
  g(wt, 'commit', '-m', 'draft two');
  const oldHead = g(wt, 'rev-parse', 'HEAD');
  writeFileSync(join(repo, 'd.txt'), 'from-main\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-m', 'main moved');

  const warns = captureWarn();
  try {
    const prepared = await withStubbedDev(() => prepareDraft({ base, projectId: 1, slug, branch }));
    assert.equal(prepared.recreated, 'not_synced');
    assert.equal(g(wt, 'rev-parse', 'HEAD'), g(repo, 'rev-parse', 'main'));
    assert.notEqual(g(repo, 'rev-parse', branch), oldHead);
    assert.equal(isAncestor(repo, oldHead, branch), false);
    assert.equal(existsSync(join(wt, 'b.txt')), false);
    assert.equal(existsSync(join(wt, 'c.txt')), false);
    assert.equal(existsSync(join(wt, 'd.txt')), true);
    assert.equal(existsSync(join(base, 'drafts', slug, 'old-folder.txt')), false);
    assert.notEqual(statSync(wt).ino, oldIno);
    assert.equal(await readDraftOwner(base, slug), EMAIL);
    assert.ok(warns.lines.some((line) => line.includes(slug) && line.includes(EMAIL) && line.includes('not_synced')));
  } finally {
    warns.restore();
  }
});

test('a draft with a tracked change is recreated equal to main', async () => {
  const base = mkdtempSync(join(tmpdir(), 'recreate-dirty-'));
  const repo = join(base, 'mls-1');
  mkdirSync(repo, { recursive: true });
  g(repo, 'init', '-b', 'main');
  writeFileSync(join(repo, 'a.txt'), '1\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-m', 'init');

  const { slug, branch } = draftSlugForUser(EMAIL);
  await writeDraftOwner(base, slug, EMAIL);
  const wt = await ensureDraftWorktree({ base, projectId: 1, slug, branch });
  writeFileSync(join(base, 'drafts', slug, 'old-folder.txt'), 'old\n');
  const oldIno = statSync(wt).ino;
  const oldHead = g(wt, 'rev-parse', 'HEAD');
  writeFileSync(join(wt, 'a.txt'), 'dirty\n');

  const warns = captureWarn();
  try {
    const prepared = await withStubbedDev(() => prepareDraft({ base, projectId: 1, slug, branch }));
    assert.equal(prepared.recreated, 'not_synced');
    assert.equal(g(wt, 'rev-parse', 'HEAD'), g(repo, 'rev-parse', 'main'));
    assert.equal(g(repo, 'rev-parse', branch), g(repo, 'rev-parse', 'main'));
    assert.notEqual(readFileSync(join(wt, 'a.txt'), 'utf8'), 'dirty\n');
    assert.equal(readFileSync(join(wt, 'a.txt'), 'utf8'), '1\n');
    assert.equal(existsSync(join(base, 'drafts', slug, 'old-folder.txt')), false);
    assert.notEqual(statSync(wt).ino, oldIno);
    assert.equal(await readDraftOwner(base, slug), EMAIL);
    assert.ok(warns.lines.some((line) => line.includes(slug) && line.includes(EMAIL) && line.includes('not_synced')));
    assert.equal(isAncestor(repo, oldHead, branch), true);
  } finally {
    warns.restore();
  }
});
