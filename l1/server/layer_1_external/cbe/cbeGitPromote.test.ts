/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeGitPromote.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { draftSourceRoot } from '/_102034_/l1/server/layer_1_external/cbe/cbeDraft.js';
import {
  captureGit,
  discardDraft,
  draftDiff,
  fastForwardDraft,
  listDrafts,
  mergeMainIntoDraft,
  promoteDraft,
  type GitCapture,
  type PromoteGit,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeGitPromote.js';

const base = '/data/mls-base';
const projectId = 102047;
const slug = 'team-102047';
const branch = 'team/102047';
const repo = resolve(join(base, `mls-${projectId}`));
const author = { name: 'ana', email: 'ana@collab.codes' };

function innerArgs(args: string[]): string[] {
  return args[0] === '-c' ? args.slice(2) : args;
}

function assertSafeDirectory(args: string[], cwd: string): void {
  assert.equal(args[0], '-c');
  assert.equal(args[1], `safe.directory=${cwd}`);
}

function scriptedGit(
  respond: (cmd: string[], call: number) => GitCapture,
): { git: PromoteGit; calls: { args: string[]; cwd: string }[] } {
  const calls: { args: string[]; cwd: string }[] = [];
  const git: PromoteGit = async (args, cwd) => {
    calls.push({ args, cwd });
    assertSafeDirectory(args, cwd);
    return respond(innerArgs(args), calls.length - 1);
  };
  return { git, calls };
}

function promoteGit(respond: (cmd: string[]) => GitCapture): { git: PromoteGit; calls: { args: string[]; cwd: string }[] } {
  return scriptedGit((cmd) => respond(cmd));
}

test('promoteDraft merges a clean main with the author on the command', async () => {
  const { git, calls } = promoteGit((cmd) => {
    if (cmd[0] === 'rev-parse' && cmd[1] === '--verify') return { stdout: 'aaa\n', code: 0 };
    if (cmd[0] === 'rev-parse' && cmd[1] === '--abbrev-ref') return { stdout: 'main\n', code: 0 };
    if (cmd[0] === 'status') return { stdout: '', code: 0 };
    if (cmd[0] === 'rev-list') return { stdout: '2\n', code: 0 };
    if (cmd[0] === '-c') return { stdout: '', code: 0 };
    if (cmd[0] === 'rev-parse' && cmd[1] === 'HEAD') return { stdout: 'deadbeef\n', code: 0 };
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  });

  const result = await promoteDraft({ base, projectId, slug, author, comment: 'ship it', git });

  assert.deepEqual(result, { status: 'merged', ref: 'deadbeef' });
  assert.deepEqual(calls.map((call) => call.cwd), [repo, repo, repo, repo, repo, repo]);
  assert.deepEqual(innerArgs(calls[0].args), ['rev-parse', '--verify', `refs/heads/${branch}`]);
  assert.deepEqual(innerArgs(calls[1].args), ['rev-parse', '--abbrev-ref', 'HEAD']);
  assert.deepEqual(innerArgs(calls[2].args), ['status', '--porcelain']);
  assert.deepEqual(innerArgs(calls[3].args), ['rev-list', '--count', `main..${branch}`]);
  assert.deepEqual(innerArgs(calls[4].args), [
    '-c', 'user.name=ana',
    '-c', 'user.email=ana@collab.codes',
    'merge', '--no-ff',
    '-m', `promote ${branch}: ship it`,
    branch,
  ]);
  assert.deepEqual(innerArgs(calls[5].args), ['rev-parse', 'HEAD']);
});

test('promoteDraft reports the conflict, then aborts the merge', async () => {
  const { git, calls } = promoteGit((cmd) => {
    if (cmd[0] === 'rev-parse' && cmd[1] === '--verify') return { stdout: 'aaa\n', code: 0 };
    if (cmd[0] === 'rev-parse' && cmd[1] === '--abbrev-ref') return { stdout: 'main\n', code: 0 };
    if (cmd[0] === 'status') return { stdout: '', code: 0 };
    if (cmd[0] === 'rev-list') return { stdout: '1\n', code: 0 };
    if (cmd[0] === '-c') return { stdout: '', code: 1 };
    if (cmd[0] === 'diff') return { stdout: 'l2/a.ts\nl2/b.ts\n', code: 0 };
    if (cmd[0] === 'merge' && cmd[1] === '--abort') return { stdout: '', code: 0 };
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  });

  const result = await promoteDraft({ base, projectId, slug, author, comment: 'ship it', git });

  assert.deepEqual(result, { status: 409, code: 'DRAFT_CONFLICT', files: ['l2/a.ts', 'l2/b.ts'] });
  assert.deepEqual(innerArgs(calls[5].args), ['diff', '--name-only', '--diff-filter=U']);
  assert.deepEqual(innerArgs(calls[6].args), ['merge', '--abort']);
  assert.equal(calls.length, 7);
});

test('promoteDraft refuses a dirty main before merging', async () => {
  const { git, calls } = promoteGit((cmd) => {
    if (cmd[0] === 'rev-parse' && cmd[1] === '--verify') return { stdout: 'aaa\n', code: 0 };
    if (cmd[0] === 'rev-parse' && cmd[1] === '--abbrev-ref') return { stdout: 'main\n', code: 0 };
    if (cmd[0] === 'status') return { stdout: ' M l2/a.ts\n', code: 0 };
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  });

  const result = await promoteDraft({ base, projectId, slug, author, comment: 'ship it', git });

  assert.deepEqual(result, { status: 409, code: 'MAIN_DIRTY' });
  assert.equal(calls.length, 3);
});

test('promoteDraft refuses a main worktree that is not on main', async () => {
  const { git, calls } = promoteGit((cmd) => {
    if (cmd[0] === 'rev-parse' && cmd[1] === '--verify') return { stdout: 'aaa\n', code: 0 };
    if (cmd[0] === 'rev-parse' && cmd[1] === '--abbrev-ref') return { stdout: 'team/102047\n', code: 0 };
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  });

  const result = await promoteDraft({ base, projectId, slug, author, comment: 'ship it', git });

  assert.deepEqual(result, { status: 409, code: 'MAIN_NOT_ON_MAIN' });
  assert.equal(calls.length, 2);
});

test('promoteDraft returns 404 when the draft branch does not exist', async () => {
  const { git, calls } = promoteGit((cmd) => {
    if (cmd[0] === 'rev-parse' && cmd[1] === '--verify') return { stdout: '', code: 128 };
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  });

  const result = await promoteDraft({ base, projectId, slug, author, comment: 'ship it', git });

  assert.deepEqual(result, { status: 404, code: 'DRAFT_NOT_FOUND' });
  assert.equal(calls.length, 1);
});

test('promoteDraft does not merge when the draft has nothing the main lacks', async () => {
  const { git, calls } = promoteGit((cmd) => {
    if (cmd[0] === 'rev-parse' && cmd[1] === '--verify') return { stdout: 'aaa\n', code: 0 };
    if (cmd[0] === 'rev-parse' && cmd[1] === '--abbrev-ref') return { stdout: 'main\n', code: 0 };
    if (cmd[0] === 'status') return { stdout: '', code: 0 };
    if (cmd[0] === 'rev-list') return { stdout: '0\n', code: 0 };
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  });

  const result = await promoteDraft({ base, projectId, slug, author, comment: 'ship it', git });

  assert.deepEqual(result, { status: 'nothing_to_promote' });
  assert.equal(calls.length, 4);
});

test('an invalid slug is 400 and does not call git', async () => {
  const { git, calls } = promoteGit(() => {
    throw new Error('git must not be called');
  });

  assert.deepEqual(
    await promoteDraft({ base, projectId, slug: 'nope', author, comment: 'x', git }),
    { status: 400, code: 'BAD_DRAFT' },
  );
  assert.deepEqual(
    await discardDraft({ base, projectId, slug: '../team-102047', git }),
    { status: 400, code: 'BAD_DRAFT' },
  );
  assert.deepEqual(
    await draftDiff({ base, projectId, slug: 'TEAM-102047', git }),
    { status: 400, code: 'BAD_DRAFT' },
  );
  assert.equal(calls.length, 0);
});

test('discardDraft resets the draft worktree onto main', async () => {
  const worktree = resolve(draftSourceRoot(base, slug, projectId));
  const { git, calls } = scriptedGit((cmd) => {
    if (cmd[0] === 'reset') return { stdout: '', code: 0 };
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  });

  const result = await discardDraft({ base, projectId, slug, git });

  assert.deepEqual(result, { status: 'discarded' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, worktree);
  assert.deepEqual(innerArgs(calls[0].args), ['reset', '--hard', 'main']);
});

test('fastForwardDraft and mergeMainIntoDraft refuse an invalid slug without calling git', async () => {
  const { git, calls } = promoteGit(() => {
    throw new Error('git must not be called');
  });
  assert.deepEqual(
    await fastForwardDraft({ base, projectId, slug: 'nope', git }),
    { status: 400, code: 'BAD_DRAFT' },
  );
  assert.deepEqual(
    await mergeMainIntoDraft({ base, projectId, slug: '../team-102047', author, git }),
    { status: 400, code: 'BAD_DRAFT' },
  );
  assert.equal(calls.length, 0);
});

test('fastForwardDraft refuses a dirty draft worktree', async () => {
  const worktree = resolve(draftSourceRoot(base, slug, projectId));
  const { git, calls } = scriptedGit((cmd) => {
    if (cmd[0] === 'status') return { stdout: ' M l2/a.ts\n', code: 0 };
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  });

  const result = await fastForwardDraft({ base, projectId, slug, git });

  assert.deepEqual(result, { status: 409, code: 'DRAFT_DIRTY' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, worktree);
  assert.deepEqual(innerArgs(calls[0].args), ['status', '--porcelain']);
});

test('fastForwardDraft is up_to_date when the draft is not behind main', async () => {
  const worktree = resolve(draftSourceRoot(base, slug, projectId));
  const { git, calls } = scriptedGit((cmd) => {
    if (cmd[0] === 'status') return { stdout: '', code: 0 };
    if (cmd[0] === 'rev-list') return { stdout: '0\t2\n', code: 0 };
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  });

  const result = await fastForwardDraft({ base, projectId, slug, git });

  assert.deepEqual(result, { status: 'up_to_date' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].cwd, worktree);
  assert.deepEqual(innerArgs(calls[1].args), ['rev-list', '--left-right', '--count', 'main...HEAD']);
});

test('fastForwardDraft fast-forwards when the draft has no own commits', async () => {
  const worktree = resolve(draftSourceRoot(base, slug, projectId));
  const { git, calls } = scriptedGit((cmd) => {
    if (cmd[0] === 'status') return { stdout: '', code: 0 };
    if (cmd[0] === 'rev-list') return { stdout: '3\t0\n', code: 0 };
    if (cmd[0] === 'merge') return { stdout: '', code: 0 };
    if (cmd[0] === 'rev-parse' && cmd[1] === 'HEAD') return { stdout: 'cafe123\n', code: 0 };
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  });

  const result = await fastForwardDraft({ base, projectId, slug, git });

  assert.deepEqual(result, { status: 'fast_forwarded', ref: 'cafe123' });
  assert.equal(calls.length, 4);
  assert.equal(calls[0].cwd, worktree);
  assert.deepEqual(innerArgs(calls[2].args), ['merge', '--ff-only', 'main']);
  assert.deepEqual(innerArgs(calls[3].args), ['rev-parse', 'HEAD']);
});

test('fastForwardDraft reports diverged and does not merge when the draft has own commits', async () => {
  const { git, calls } = scriptedGit((cmd) => {
    if (cmd[0] === 'status') return { stdout: '', code: 0 };
    if (cmd[0] === 'rev-list') return { stdout: '2\t1\n', code: 0 };
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  });

  const result = await fastForwardDraft({ base, projectId, slug, git });

  assert.deepEqual(result, { status: 'diverged', ahead: 1, behind: 2 });
  assert.equal(calls.length, 2);
  assert.equal(calls.some((call) => innerArgs(call.args)[0] === 'merge'), false);
});

test('mergeMainIntoDraft merges main with the author when the draft has diverged', async () => {
  const worktree = resolve(draftSourceRoot(base, slug, projectId));
  const { git, calls } = scriptedGit((cmd) => {
    if (cmd[0] === 'status') return { stdout: '', code: 0 };
    if (cmd[0] === 'rev-list') return { stdout: '2\t1\n', code: 0 };
    if (cmd[0] === '-c') return { stdout: '', code: 0 };
    if (cmd[0] === 'rev-parse' && cmd[1] === 'HEAD') return { stdout: 'beef456\n', code: 0 };
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  });

  const result = await mergeMainIntoDraft({ base, projectId, slug, author, git });

  assert.deepEqual(result, { status: 'merged', ref: 'beef456' });
  assert.equal(calls.length, 4);
  assert.equal(calls[0].cwd, worktree);
  assert.deepEqual(innerArgs(calls[2].args), [
    '-c', 'user.name=ana',
    '-c', 'user.email=ana@collab.codes',
    'merge', '--no-ff',
    '-m', `sync main into ${branch}`,
    'main',
  ]);
  assert.deepEqual(innerArgs(calls[3].args), ['rev-parse', 'HEAD']);
});

test('mergeMainIntoDraft reports the conflict, then aborts the merge', async () => {
  const { git, calls } = scriptedGit((cmd) => {
    if (cmd[0] === 'status') return { stdout: '', code: 0 };
    if (cmd[0] === 'rev-list') return { stdout: '1\t1\n', code: 0 };
    if (cmd[0] === '-c') return { stdout: '', code: 1 };
    if (cmd[0] === 'diff') return { stdout: 'l2/a.ts\n', code: 0 };
    if (cmd[0] === 'merge' && cmd[1] === '--abort') return { stdout: '', code: 0 };
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  });

  const result = await mergeMainIntoDraft({ base, projectId, slug, author, git });

  assert.deepEqual(result, { status: 409, code: 'DRAFT_CONFLICT', files: ['l2/a.ts'] });
  assert.deepEqual(innerArgs(calls[3].args), ['diff', '--name-only', '--diff-filter=U']);
  assert.deepEqual(innerArgs(calls[4].args), ['merge', '--abort']);
  assert.equal(calls.length, 5);
});

test('fastForwardDraft returns GIT_ERROR when git fails unexpectedly', async () => {
  const { git, calls } = scriptedGit((cmd) => {
    if (cmd[0] === 'status') return { stdout: '', stderr: 'index.lock', code: 128 };
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  });

  const result = await fastForwardDraft({ base, projectId, slug, git });

  assert.deepEqual(result, { status: 500, code: 'GIT_ERROR' });
  assert.equal(calls.length, 1);
});

test('listDrafts returns ahead/behind, the last commit and the touched files', async () => {
  const team = `team/102047${'\x1f'}Ana${'\x1f'}<ana@collab.codes>${'\x1f'}2026-10-12T00:00:00Z${'\x1f'}ship it`;
  const user = `user/bob@x.com${'\x1f'}Bob${'\x1f'}<bob@x.com>${'\x1f'}2026-10-11T00:00:00Z${'\x1f'}wip`;
  const { git, calls } = promoteGit((cmd) => {
    if (cmd[0] === 'for-each-ref') return { stdout: `${team}\n${user}\n`, code: 0 };
    if (cmd[0] === 'rev-list' && cmd[3] === 'main...team/102047') return { stdout: '1\t3\n', code: 0 };
    if (cmd[0] === 'rev-list' && cmd[3] === 'main...user/bob@x.com') return { stdout: '0\t0\n', code: 0 };
    if (cmd[0] === 'diff' && cmd[2] === 'main...team/102047') return { stdout: 'l2/a.ts\n', code: 0 };
    if (cmd[0] === 'diff' && cmd[2] === 'main...user/bob@x.com') return { stdout: '', code: 0 };
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  });

  const result = await listDrafts({ base, projectId, git });

  assert.deepEqual(result, {
    status: 'listed',
    drafts: [
      {
        branch: 'team/102047',
        ahead: 3,
        behind: 1,
        author: 'Ana',
        email: 'ana@collab.codes',
        date: '2026-10-12T00:00:00Z',
        message: 'ship it',
        files: ['l2/a.ts'],
      },
      {
        branch: 'user/bob@x.com',
        ahead: 0,
        behind: 0,
        author: 'Bob',
        email: 'bob@x.com',
        date: '2026-10-11T00:00:00Z',
        message: 'wip',
        files: [],
      },
    ],
  });
  assert.deepEqual(innerArgs(calls[0].args).slice(0, 1), ['for-each-ref']);
  assert.ok(innerArgs(calls[0].args).includes('refs/heads/team'));
  assert.ok(innerArgs(calls[0].args).includes('refs/heads/user'));
  assert.deepEqual(innerArgs(calls[1].args), ['rev-list', '--left-right', '--count', 'main...team/102047']);
  assert.deepEqual(innerArgs(calls[2].args), ['diff', '--name-only', 'main...team/102047']);
});

test('draftDiff is the whole branch, or one contained path', async () => {
  const whole = promoteGit((cmd) => {
    if (cmd[0] === 'diff') return { stdout: 'diff --git a/l2/a.ts\n', code: 0 };
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  });
  const wholeResult = await draftDiff({ base, projectId, slug, git: whole.git });
  assert.deepEqual(wholeResult, { status: 'diff', text: 'diff --git a/l2/a.ts\n' });
  assert.deepEqual(innerArgs(whole.calls[0].args), ['diff', `main...${branch}`]);
  assert.equal(whole.calls[0].cwd, repo);

  const one = promoteGit((cmd) => {
    if (cmd[0] === 'diff') return { stdout: 'diff --git a/l2/a.ts\n', code: 0 };
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  });
  const oneResult = await draftDiff({ base, projectId, slug, shortPath: 'l2/a.ts', git: one.git });
  assert.equal(oneResult.status, 'diff');
  assert.deepEqual(innerArgs(one.calls[0].args), ['diff', `main...${branch}`, '--', 'l2/a.ts']);

  const escaped = promoteGit(() => {
    throw new Error('git must not be called');
  });
  const escapedResult = await draftDiff({ base, projectId, slug, shortPath: '../secret', git: escaped.git });
  assert.deepEqual(escapedResult, { status: 400, code: 'BAD_PATH' });
  assert.equal(escaped.calls.length, 0);
});

test('captureGit returns a non-zero exit instead of throwing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cbe-promote-'));
  try {
    execFileSync('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: root, stdio: 'ignore' });
    const clean = await captureGit(['status', '--porcelain'], root);
    assert.equal(clean.code, 0);
    const missing = await captureGit(['rev-parse', '--verify', 'refs/heads/missing'], root);
    assert.notEqual(missing.code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
