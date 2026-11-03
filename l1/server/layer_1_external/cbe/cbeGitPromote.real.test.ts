/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeGitPromote.real.test.ts" enhancement="_blank" />
// Round trip with the real git binary: the injected-git tests cannot catch a bad --format or exit code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  discardDraft,
  draftDiff,
  fastForwardDraft,
  listDrafts,
  mergeMainIntoDraft,
  promoteDraft,
  restoreDraftPaths,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeGitPromote.js';
import { ensureDraftWorktree } from '/_102034_/l1/server/layer_1_external/cbe/cbeDraft.js';
import { readHistoryContent } from '/_102034_/l1/server/layer_1_external/cbe/cbeGit.js';

function g(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
}

test('promote, list, diff and discard against a real repository', async () => {
  const base = mkdtempSync(join(tmpdir(), 'promo-'));
  const repo = join(base, 'mls-1');
  mkdirSync(repo, { recursive: true });
  g(repo, 'init', '-b', 'main');
  writeFileSync(join(repo, 'a.txt'), '1\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-m', 'init');

  const slug = 'team-1';
  const wt = await ensureDraftWorktree({ base, projectId: 1, slug, branch: 'team/1' });
  writeFileSync(join(wt, 'b.txt'), 'x\n');
  g(wt, 'add', '.');
  g(wt, 'commit', '-m', 'draft change');
  const author = { name: 'ana', email: 'ana@x.com' };

  const listed = await listDrafts({ base, projectId: 1 });
  assert.equal(listed.status, 'listed');
  if (listed.status === 'listed') {
    assert.equal(listed.drafts.length, 1);
    assert.equal(listed.drafts[0].branch, 'team/1');
    assert.equal(listed.drafts[0].ahead, 1);
    assert.equal(listed.drafts[0].behind, 0);
    assert.equal(listed.drafts[0].message, 'draft change');
    assert.deepEqual(listed.drafts[0].files, ['b.txt']);
  }

  const diff = await draftDiff({ base, projectId: 1, slug });
  assert.equal(diff.status, 'diff');
  if (diff.status === 'diff') assert.match(diff.text, /b\.txt/);

  const merged = await promoteDraft({ base, projectId: 1, slug, author, comment: 'go' });
  assert.equal(merged.status, 'merged');
  assert.ok(existsSync(join(repo, 'b.txt')));
  assert.match(g(repo, 'log', '-1', '--format=%an %s'), /ana promote team\/1: go/);
  assert.deepEqual(await promoteDraft({ base, projectId: 1, slug, author, comment: 'go' }), { status: 'nothing_to_promote' });

  writeFileSync(join(wt, 'a.txt'), 'draft\n');
  g(wt, 'add', '.');
  g(wt, 'commit', '-m', 'd2');
  writeFileSync(join(repo, 'a.txt'), 'main\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-m', 'm2');
  assert.deepEqual(
    await promoteDraft({ base, projectId: 1, slug, author, comment: 'go' }),
    { status: 409, code: 'DRAFT_CONFLICT', files: ['a.txt'] },
  );
  assert.equal(g(repo, 'status', '--porcelain'), '');

  writeFileSync(join(repo, 'a.txt'), 'dirty\n');
  assert.deepEqual(await promoteDraft({ base, projectId: 1, slug, author, comment: 'go' }), { status: 409, code: 'MAIN_DIRTY' });
  g(repo, 'checkout', '--', 'a.txt');

  assert.deepEqual(await discardDraft({ base, projectId: 1, slug }), { status: 'discarded' });
  assert.equal(g(wt, 'rev-parse', 'HEAD'), g(repo, 'rev-parse', 'main'));
});

test('draftDiff names returns the published main commit', async () => {
  const base = mkdtempSync(join(tmpdir(), 'promo-main-'));
  const repo = join(base, 'mls-1');
  mkdirSync(repo, { recursive: true });
  g(repo, 'init', '-b', 'main');
  writeFileSync(join(repo, 'a.txt'), 'published\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-m', 'init');

  const slug = 'team-1';
  const wt = await ensureDraftWorktree({ base, projectId: 1, slug, branch: 'team/1' });
  writeFileSync(join(wt, 'a.txt'), 'draft\n');
  g(wt, 'add', '.');
  g(wt, 'commit', '-m', 'draft change');

  const listed = await draftDiff({ base, projectId: 1, slug, names: true });
  assert.equal(listed.status, 'files');
  if (listed.status !== 'files') return;
  assert.equal(listed.main, g(repo, 'rev-parse', 'main'));
  assert.equal(readHistoryContent(1, 'a.txt', listed.main, wt), 'published\n');
});

test('fastForwardDraft and mergeMainIntoDraft against a real draft worktree', async () => {
  const base = mkdtempSync(join(tmpdir(), 'sync-'));
  const repo = join(base, 'mls-1');
  mkdirSync(repo, { recursive: true });
  g(repo, 'init', '-b', 'main');
  writeFileSync(join(repo, 'a.txt'), '1\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-m', 'init');

  const slug = 'team-1';
  const wt = await ensureDraftWorktree({ base, projectId: 1, slug, branch: 'team/1' });
  const author = { name: 'ana', email: 'ana@x.com' };

  writeFileSync(join(repo, 'c.txt'), 'from-main\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-m', 'main moved');
  const forwarded = await fastForwardDraft({ base, projectId: 1, slug });
  assert.equal(forwarded.status, 'fast_forwarded');
  assert.equal(g(wt, 'rev-parse', 'HEAD'), g(repo, 'rev-parse', 'main'));

  writeFileSync(join(wt, 'd.txt'), 'draft\n');
  g(wt, 'add', '.');
  g(wt, 'commit', '-m', 'draft own');
  writeFileSync(join(repo, 'e.txt'), 'main2\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-m', 'main other file');
  const diverged = await fastForwardDraft({ base, projectId: 1, slug });
  assert.equal(diverged.status, 'diverged');
  if (diverged.status === 'diverged') {
    assert.equal(diverged.ahead, 1);
    assert.equal(diverged.behind, 1);
  }
  const merged = await mergeMainIntoDraft({ base, projectId: 1, slug, author });
  assert.equal(merged.status, 'merged');
  const afterMerge = g(wt, 'rev-list', '--left-right', '--count', 'main...HEAD');
  assert.equal(afterMerge.split(/\s+/u)[0], '0');

  writeFileSync(join(wt, 'a.txt'), 'draft-line\n');
  g(wt, 'add', '.');
  g(wt, 'commit', '-m', 'draft a');
  writeFileSync(join(repo, 'a.txt'), 'main-line\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-m', 'main a');
  const headBefore = g(wt, 'rev-parse', 'HEAD');
  assert.deepEqual(
    await mergeMainIntoDraft({ base, projectId: 1, slug, author }),
    { status: 409, code: 'DRAFT_CONFLICT', files: ['a.txt'] },
  );
  assert.equal(g(wt, 'status', '--porcelain'), '');
  assert.equal(g(wt, 'rev-parse', 'HEAD'), headBefore);
});

test('restoreDraftPaths puts named paths back and drops a draft-only folder', async () => {
  const prev = process.env.CBE_COMMIT_ON_SAVE;
  process.env.CBE_COMMIT_ON_SAVE = 'always';
  const base = mkdtempSync(join(tmpdir(), 'restore-'));
  const repo = join(base, 'mls-1');
  mkdirSync(join(repo, 'l1', 'keep'), { recursive: true });
  mkdirSync(join(repo, 'l2', 'other'), { recursive: true });
  g(repo, 'init', '-b', 'main');
  writeFileSync(join(repo, 'l1', 'keep', 'a.ts'), 'main\n');
  writeFileSync(join(repo, 'l2', 'other', 'b.ts'), 'stay\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-m', 'init');
  const main = g(repo, 'rev-parse', 'HEAD');

  const slug = 'team-1';
  const wt = await ensureDraftWorktree({ base, projectId: 1, slug, branch: 'team/1' });
  const author = { name: 'ana', email: 'ana@x.com' };
  writeFileSync(join(wt, 'l1', 'keep', 'a.ts'), 'draft\n');
  writeFileSync(join(wt, 'l2', 'other', 'b.ts'), 'draft-other\n');
  mkdirSync(join(wt, 'l1', 'mod_old'), { recursive: true });
  writeFileSync(join(wt, 'l1', 'mod_old', 'c.ts'), 'only-draft\n');
  writeFileSync(join(wt, 'l1', 'mod_old', 'loose.ts'), 'untracked\n');
  g(wt, 'add', 'l1/keep/a.ts', 'l2/other/b.ts', 'l1/mod_old/c.ts');
  g(wt, 'commit', '-m', 'draft edits');
  const draftHead = g(wt, 'rev-parse', 'HEAD');

  const restored = await restoreDraftPaths({
    base,
    projectId: 1,
    slug,
    ref: 'main',
    paths: ['l1/keep/a.ts', 'l1/mod_old'],
    author,
  });
  assert.equal(restored.status, 'restored');
  if (restored.status !== 'restored') return;
  assert.equal(restored.restartDev, true);
  assert.equal(g(wt, 'rev-parse', 'HEAD^'), draftHead);
  assert.equal(g(wt, 'show', 'HEAD:l1/keep/a.ts'), 'main');
  assert.equal(g(wt, 'show', 'HEAD:l2/other/b.ts'), 'draft-other');
  assert.equal(existsSync(join(wt, 'l1', 'mod_old')), false);
  assert.match(g(wt, 'log', '-1', '--format=%an %ae %s'), /^ana ana@x.com discard /);
  assert.equal(g(repo, 'rev-parse', 'main'), main);

  // A module directory that exists in ref: files the draft added inside it go too (committed or loose).
  mkdirSync(join(wt, 'l1', 'keep', 'sub'), { recursive: true });
  writeFileSync(join(wt, 'l1', 'keep', 'added.ts'), 'added\n');
  writeFileSync(join(wt, 'l1', 'keep', 'sub', 'deep.ts'), 'deep\n');
  g(wt, 'add', 'l1/keep/added.ts');
  g(wt, 'commit', '-m', 'add inside keep');
  writeFileSync(join(wt, 'l1', 'keep', 'a.ts'), 'edited-again\n');
  writeFileSync(join(wt, 'l1', 'keep', 'loose2.ts'), 'loose\n');
  const dir = await restoreDraftPaths({ base, projectId: 1, slug, ref: 'main', paths: ['l1/keep'], author });
  assert.equal(dir.status, 'restored');
  assert.equal(g(wt, 'show', 'HEAD:l1/keep/a.ts'), 'main');
  assert.equal(g(wt, 'ls-tree', '-r', '--name-only', 'HEAD', 'l1/keep'), 'l1/keep/a.ts');
  assert.equal(existsSync(join(wt, 'l1', 'keep', 'added.ts')), false);
  assert.equal(existsSync(join(wt, 'l1', 'keep', 'loose2.ts')), false);
  assert.equal(existsSync(join(wt, 'l1', 'keep', 'sub', 'deep.ts')), false);
  assert.equal(g(wt, 'status', '--porcelain'), '');

  const l2 = await restoreDraftPaths({
    base,
    projectId: 1,
    slug,
    ref: 'main',
    paths: ['l2/other/b.ts'],
    author,
  });
  assert.equal(l2.status, 'restored');
  if (l2.status !== 'restored') return;
  assert.equal(l2.restartDev, false);
  assert.equal(g(wt, 'show', 'HEAD:l2/other/b.ts'), 'stay');
  assert.equal(g(wt, 'show', 'HEAD:l1/keep/a.ts'), 'main');

  const same = await restoreDraftPaths({
    base,
    projectId: 1,
    slug,
    ref: 'main',
    paths: ['l2/other/b.ts'],
    author,
  });
  assert.equal(same.status, 'unchanged');
  if (same.status === 'unchanged') assert.equal(same.head, l2.head);

  assert.equal((await restoreDraftPaths({ base, projectId: 1, slug, ref: 'main..', paths: ['l1/keep/a.ts'], author })).status, 400);
  assert.equal((await restoreDraftPaths({ base, projectId: 1, slug, ref: '-main', paths: ['l1/keep/a.ts'], author })).status, 400);
  const outside = await restoreDraftPaths({ base, projectId: 1, slug, ref: 'main', paths: ['../a.ts'], author });
  assert.equal(outside.status, 400);
  if (outside.status === 400) assert.equal(outside.msg, 'draft.path_invalid');
  const layer = await restoreDraftPaths({ base, projectId: 1, slug, ref: 'main', paths: ['README'], author });
  assert.equal(layer.status, 400);
  if (layer.status === 400) assert.equal(layer.msg, 'draft.path_outside_layers');
  const foreign = '0123456789abcdef0123456789abcdef01234567';
  const notAncestor = await restoreDraftPaths({ base, projectId: 1, slug, ref: foreign, paths: ['l1/keep/a.ts'], author });
  assert.equal(notAncestor.status, 400);
  if (notAncestor.status === 400) assert.equal(notAncestor.msg, 'draft.ref_not_ancestor');

  if (prev === undefined) delete process.env.CBE_COMMIT_ON_SAVE;
  else process.env.CBE_COMMIT_ON_SAVE = prev;
});
