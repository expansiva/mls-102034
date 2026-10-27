/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeDraft.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  draftSourceRoot,
  ensureDraftWorktree,
  parseDraftSlug,
  requestDraftValue,
  type DraftGit,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeDraft.js';

function innerArgs(args: string[]): string[] {
  return args[0] === '-c' ? args.slice(2) : args;
}

function assertSafeDirectory(args: string[], cwd: string): void {
  assert.equal(args[0], '-c');
  assert.equal(args[1], `safe.directory=${cwd}`);
}

test('parseDraftSlug: 6 valid/invalid cases', () => {
  assert.deepEqual(parseDraftSlug('team-102047'), { slug: 'team-102047', branch: 'team/102047' });
  assert.deepEqual(parseDraftSlug('user-alice_collab_codes'), {
    slug: 'user-alice_collab_codes',
    branch: 'user/alice@collab.codes',
  });
  assert.equal(parseDraftSlug(undefined), null);
  assert.equal(parseDraftSlug(''), null);
  assert.equal(parseDraftSlug('TEAM-102047'), null);
  assert.equal(parseDraftSlug(`team-${'a'.repeat(65)}`), null);
});

test('requestDraftValue prefers x-collab-draft and does not fall through when that header is invalid', () => {
  const slug = 'team-102047';
  const cookie = `cauth=abc; collab-draft=${slug}`;
  assert.equal(requestDraftValue({ 'x-collab-draft': 'user-ada_collab_codes', cookie }), 'user-ada_collab_codes');
  assert.equal(requestDraftValue({ 'x-collab-draft': 'not-a-slug', cookie }), 'not-a-slug');
  assert.equal(requestDraftValue({ 'x-collab-draft': '', cookie }), slug);
  assert.equal(requestDraftValue({ cookie }), slug);
  assert.equal(requestDraftValue({}), undefined);
  assert.equal(requestDraftValue(undefined), undefined);
  assert.equal(parseDraftSlug(requestDraftValue({ 'x-collab-draft': 'not-a-slug', cookie })), null);
  assert.equal(parseDraftSlug(requestDraftValue({ cookie }))?.slug, slug);
});

test('draftSourceRoot is <base>/drafts/<slug>/mls-<id>', () => {
  assert.equal(
    draftSourceRoot('/data/mls-base', 'team-102047', 102047),
    join('/data/mls-base', 'drafts', 'team-102047', 'mls-102047'),
  );
});

test('ensureDraftWorktree creates a worktree for a new branch (command sequence)', async () => {
  const base = '/data/mls-base';
  const projectId = 102047;
  const slug = 'team-102047';
  const branch = 'team/102047';
  const repoPath = resolve(join(base, `mls-${projectId}`));
  const worktreePath = resolve(draftSourceRoot(base, slug, projectId));
  const calls: { args: string[]; cwd: string }[] = [];

  const git: DraftGit = async (args, cwd) => {
    calls.push({ args, cwd });
    const cmd = innerArgs(args);
    if (cmd[0] === 'worktree' && cmd[1] === 'list') return '';
    if (cmd[0] === 'rev-parse') {
      throw Object.assign(new Error('Needed a single revision'), { stderr: 'fatal: Needed a single revision' });
    }
    if (cmd[0] === 'worktree' && cmd[1] === 'add') return '';
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  };

  const path = await ensureDraftWorktree({ base, projectId, slug, branch, git });
  assert.equal(path, worktreePath);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.cwd, repoPath);
    assertSafeDirectory(call.args, repoPath);
  }
  assert.deepEqual(innerArgs(calls[0].args), ['worktree', 'list', '--porcelain']);
  assert.deepEqual(innerArgs(calls[1].args), ['rev-parse', '--verify', `refs/heads/${branch}`]);
  assert.deepEqual(innerArgs(calls[2].args), ['worktree', 'add', '-B', branch, worktreePath, 'main']);
});

test('ensureDraftWorktree reuses an existing worktree', async () => {
  const base = '/data/mls-base';
  const projectId = 102047;
  const slug = 'team-102047';
  const branch = 'team/102047';
  const worktreePath = resolve(draftSourceRoot(base, slug, projectId));
  const calls: { args: string[]; cwd: string }[] = [];

  const git: DraftGit = async (args, cwd) => {
    calls.push({ args, cwd });
    const cmd = innerArgs(args);
    if (cmd[0] === 'worktree' && cmd[1] === 'list') {
      return `worktree ${worktreePath}\nHEAD abcdef\nbranch refs/heads/${branch}\n`;
    }
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  };

  const path = await ensureDraftWorktree({ base, projectId, slug, branch, git });
  assert.equal(path, worktreePath);
  assert.equal(calls.length, 1);
  assert.deepEqual(innerArgs(calls[0].args), ['worktree', 'list', '--porcelain']);
});

test('ensureDraftWorktree retries once on index.lock', async () => {
  const base = '/data/mls-base';
  const projectId = 102047;
  const slug = 'team-102047';
  const branch = 'team/102047';
  const worktreePath = resolve(draftSourceRoot(base, slug, projectId));
  let addAttempts = 0;
  const git: DraftGit = async (args) => {
    const cmd = innerArgs(args);
    if (cmd[0] === 'worktree' && cmd[1] === 'list') return '';
    if (cmd[0] === 'rev-parse') {
      throw Object.assign(new Error('Needed a single revision'), { stderr: 'fatal: Needed a single revision' });
    }
    if (cmd[0] === 'worktree' && cmd[1] === 'add') {
      addAttempts += 1;
      if (addAttempts === 1) {
        throw Object.assign(new Error('Unable to create index.lock'), {
          stderr: 'fatal: Unable to create \'.git/index.lock\': File exists.',
        });
      }
      return '';
    }
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  };

  const path = await ensureDraftWorktree({ base, projectId, slug, branch, git });
  assert.equal(path, worktreePath);
  assert.equal(addAttempts, 2);
});

test('ensureDraftWorktree retries when another caller just created the branch', async () => {
  const base = '/data/mls-base';
  const projectId = 102047;
  const slug = 'team-x';
  const branch = 'team/x';
  const worktreePath = resolve(draftSourceRoot(base, slug, projectId));
  let addAttempts = 0;
  let listAttempts = 0;

  const git: DraftGit = async (args) => {
    const cmd = innerArgs(args);
    if (cmd[0] === 'worktree' && cmd[1] === 'list') {
      listAttempts += 1;
      if (listAttempts === 1) return '';
      return `worktree ${worktreePath}\nHEAD abcdef\nbranch refs/heads/${branch}\n`;
    }
    if (cmd[0] === 'rev-parse') {
      throw Object.assign(new Error('Needed a single revision'), { stderr: 'fatal: Needed a single revision' });
    }
    if (cmd[0] === 'worktree' && cmd[1] === 'add') {
      addAttempts += 1;
      const stderr = `fatal: cannot force update the branch '${branch}' used by worktree at ${worktreePath}`;
      throw Object.assign(new Error(stderr), { stderr });
    }
    throw new Error(`unexpected git ${cmd.join(' ')}`);
  };

  const path = await ensureDraftWorktree({ base, projectId, slug, branch, git });
  assert.equal(path, worktreePath);
  assert.equal(addAttempts, 1);
  assert.equal(listAttempts, 2);
});

const execFileAsync = promisify(execFile);

async function initMainRepo(repoPath: string): Promise<void> {
  await mkdir(repoPath, { recursive: true });
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repoPath });
  await execFileAsync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'],
    { cwd: repoPath },
  );
}

test('ensureDraftWorktree with real git: second call reuses; parallel calls do not throw', async () => {
  const base = await mkdtemp(join(tmpdir(), 'cbe-draft-'));
  try {
    const projectId = 102047;
    await initMainRepo(join(base, `mls-${projectId}`));

    const first = await ensureDraftWorktree({
      base, projectId, slug: 'team-102047', branch: 'team/102047',
    });
    const second = await ensureDraftWorktree({
      base, projectId, slug: 'team-102047', branch: 'team/102047',
    });
    assert.equal(first, second);

    const [left, right] = await Promise.all([
      ensureDraftWorktree({ base, projectId, slug: 'team-race', branch: 'team/race' }),
      ensureDraftWorktree({ base, projectId, slug: 'team-race', branch: 'team/race' }),
    ]);
    assert.equal(left, right);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
