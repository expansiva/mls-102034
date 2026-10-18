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
} from '/_102034_/l1/server/layer_1_external/cbe/cbeGitPromote.js';
import { ensureDraftWorktree } from '/_102034_/l1/server/layer_1_external/cbe/cbeDraft.js';

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
