/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeGitCommit.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  authorFromSession,
  commitMessage,
  commitSavedSources,
  isCommitOnSaveEnabled,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeGitCommit.js';

let nextProjectId = 198001;

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * A project tree that is a real git checkout with one commit, under a temporary
 * CBE_PROJECTS_DIR — the same override cbeLogin.test.ts uses. CBE_COMMIT_ON_SAVE
 * is forced on: the default is production-only.
 */
async function withGitProject(
  fn: (ctx: { projectId: number; projectRoot: string }) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'cbe-commit-'));
  const projectId = nextProjectId++;
  const projectRoot = join(root, `mls-${projectId}`);
  const prevDir = process.env.CBE_PROJECTS_DIR;
  const prevFlag = process.env.CBE_COMMIT_ON_SAVE;
  process.env.CBE_PROJECTS_DIR = root;
  process.env.CBE_COMMIT_ON_SAVE = 'always';
  try {
    mkdirSync(join(projectRoot, 'l2'), { recursive: true });
    git(projectRoot, ['-c', 'init.defaultBranch=main', 'init']);
    git(projectRoot, ['config', 'user.name', 'fixture']);
    git(projectRoot, ['config', 'user.email', 'fixture@test']);
    git(projectRoot, ['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(projectRoot, 'l2', 'a.ts'), 'export const a = 1;\n');
    git(projectRoot, ['add', '-A']);
    git(projectRoot, ['commit', '-m', 'initial', '--no-verify']);
    await fn({ projectId, projectRoot });
  } finally {
    if (prevDir === undefined) delete process.env.CBE_PROJECTS_DIR;
    else process.env.CBE_PROJECTS_DIR = prevDir;
    if (prevFlag === undefined) delete process.env.CBE_COMMIT_ON_SAVE;
    else process.env.CBE_COMMIT_ON_SAVE = prevFlag;
    rmSync(root, { recursive: true, force: true });
  }
}

test('T1: commitMessage uses the save comment, and falls back when it is empty', () => {
  assert.equal(commitMessage('fix the parser', 1), 'fix the parser');
  assert.equal(commitMessage('first line\nsecond', 1), 'first line');
  assert.equal(commitMessage('', 3), 'studio save: 3 file(s)');
  assert.equal(commitMessage(undefined, 1), 'studio save: 1 file(s)');
});

test('T2: authorFromSession derives the identity from the session email', () => {
  assert.deepEqual(authorFromSession('ana@collab.codes'), { name: 'ana', email: 'ana@collab.codes' });
  // No session (anonymous / localhost): a fixed identity, never an invalid one.
  assert.equal(authorFromSession(undefined).email, 'studio@localhost');
  assert.equal(authorFromSession('not-an-email').email, 'studio@localhost');
});

test('T3: CBE_COMMIT_ON_SAVE overrides the production-only default', () => {
  const prevFlag = process.env.CBE_COMMIT_ON_SAVE;
  const prevEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'development';
    delete process.env.CBE_COMMIT_ON_SAVE;
    assert.equal(isCommitOnSaveEnabled(), false);
    process.env.CBE_COMMIT_ON_SAVE = 'always';
    assert.equal(isCommitOnSaveEnabled(), true);
    process.env.NODE_ENV = 'production';
    process.env.CBE_COMMIT_ON_SAVE = 'never';
    assert.equal(isCommitOnSaveEnabled(), false);
  } finally {
    if (prevFlag === undefined) delete process.env.CBE_COMMIT_ON_SAVE;
    else process.env.CBE_COMMIT_ON_SAVE = prevFlag;
    process.env.NODE_ENV = prevEnv;
  }
});

test('T4: an edit to a tracked file moves its blob OID in HEAD — the whole point', async () => {
  await withGitProject(async ({ projectId, projectRoot }) => {
    const before = git(projectRoot, ['rev-parse', 'HEAD:l2/a.ts']);
    writeFileSync(join(projectRoot, 'l2', 'a.ts'), 'export const a = 2;\n');

    const rc = await commitSavedSources(projectId, ['l2/a.ts'], {
      comments: 'edit a',
      author: { name: 'ana', email: 'ana@collab.codes' },
    });

    assert.equal(rc.status, 'committed');
    const after = git(projectRoot, ['rev-parse', 'HEAD:l2/a.ts']);
    assert.notEqual(after, before, 'versionRef would not move without this');
    // The OID the build reads is exactly the hash of the file on disk.
    assert.equal(after, git(projectRoot, ['hash-object', 'l2/a.ts']));
    assert.equal(git(projectRoot, ['log', '-1', '--format=%s']), 'edit a');
    assert.equal(git(projectRoot, ['log', '-1', '--format=%an <%ae>']), 'ana <ana@collab.codes>');
  });
});

test('T5: a brand new file is committed (git commit -- <path> alone would not see it)', async () => {
  await withGitProject(async ({ projectId, projectRoot }) => {
    writeFileSync(join(projectRoot, 'l2', 'novo.ts'), 'export const novo = true;\n');
    const rc = await commitSavedSources(projectId, ['l2/novo.ts'], {});
    assert.equal(rc.status, 'committed');
    assert.equal(git(projectRoot, ['log', '-1', '--name-only', '--format=']), 'l2/novo.ts');
  });
});

test('T6: a deleted file is committed as a deletion', async () => {
  await withGitProject(async ({ projectId, projectRoot }) => {
    rmSync(join(projectRoot, 'l2', 'a.ts'));
    const rc = await commitSavedSources(projectId, ['l2/a.ts'], {});
    assert.equal(rc.status, 'committed');
    assert.equal(git(projectRoot, ['log', '-1', '--diff-filter=D', '--name-only', '--format=']), 'l2/a.ts');
  });
});

test('T7: only the saved paths are committed — unrelated edits stay out', async () => {
  await withGitProject(async ({ projectId, projectRoot }) => {
    writeFileSync(join(projectRoot, 'l2', 'a.ts'), 'export const a = 3;\n');
    writeFileSync(join(projectRoot, 'l2', 'outro.ts'), 'export const outro = 1;\n');
    const rc = await commitSavedSources(projectId, ['l2/a.ts'], {});
    assert.equal(rc.status, 'committed');
    assert.equal(git(projectRoot, ['log', '-1', '--name-only', '--format=']), 'l2/a.ts');
  });
});

test('T8: rewriting a file with the same bytes commits nothing', async () => {
  await withGitProject(async ({ projectId }) => {
    const rc = await commitSavedSources(projectId, ['l2/a.ts'], {});
    assert.equal(rc.status, 'nothing');
  });
});

test('T9: a project tree without .git is reported, not thrown', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cbe-commit-'));
  const projectId = nextProjectId++;
  const prevDir = process.env.CBE_PROJECTS_DIR;
  const prevFlag = process.env.CBE_COMMIT_ON_SAVE;
  process.env.CBE_PROJECTS_DIR = root;
  process.env.CBE_COMMIT_ON_SAVE = 'always';
  try {
    mkdirSync(join(root, `mls-${projectId}`, 'l2'), { recursive: true });
    const rc = await commitSavedSources(projectId, ['l2/a.ts'], {});
    assert.equal(rc.status, 'not-a-repo');
  } finally {
    if (prevDir === undefined) delete process.env.CBE_PROJECTS_DIR;
    else process.env.CBE_PROJECTS_DIR = prevDir;
    if (prevFlag === undefined) delete process.env.CBE_COMMIT_ON_SAVE;
    else process.env.CBE_COMMIT_ON_SAVE = prevFlag;
    rmSync(root, { recursive: true, force: true });
  }
});

test('T10: disabled by default outside production — no commit happens', async () => {
  await withGitProject(async ({ projectId, projectRoot }) => {
    const prevFlag = process.env.CBE_COMMIT_ON_SAVE;
    const prevEnv = process.env.NODE_ENV;
    process.env.CBE_COMMIT_ON_SAVE = 'never';
    try {
      writeFileSync(join(projectRoot, 'l2', 'a.ts'), 'export const a = 9;\n');
      const rc = await commitSavedSources(projectId, ['l2/a.ts'], {});
      assert.equal(rc.status, 'disabled');
      assert.equal(git(projectRoot, ['log', '-1', '--format=%s']), 'initial');
    } finally {
      process.env.CBE_COMMIT_ON_SAVE = prevFlag as string;
      process.env.NODE_ENV = prevEnv;
    }
  });
});
