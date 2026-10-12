/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeGitPromote.real.test.ts" enhancement="_blank" />
// Round trip with the real git binary: the injected-git tests cannot catch a bad --format or exit code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discardDraft, draftDiff, listDrafts, promoteDraft } from '/_102034_/l1/server/layer_1_external/cbe/cbeGitPromote.js';
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
