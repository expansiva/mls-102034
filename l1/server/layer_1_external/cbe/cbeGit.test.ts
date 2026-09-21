/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeGit.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isGitRepo, readHistory, readHistoryContent } from '/_102034_/l1/server/layer_1_external/cbe/cbeGit.js';

const PROJECT_ID = 198001;

function git(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true });
}

/**
 * A real repository in a temp dir, pointed at by CBE_PROJECTS_DIR (the same
 * override cbeLogin.test.ts uses). Faking git output would test the parser
 * against my idea of git, not against git.
 */
function withRepo<T>(fn: (dir: string) => T, { init = true }: { init?: boolean } = {}): T {
  const root = mkdtempSync(join(tmpdir(), 'cbe-git-'));
  const dir = join(root, `mls-${PROJECT_ID}`);
  mkdirSync(join(dir, 'l2'), { recursive: true });
  const prev = process.env.CBE_PROJECTS_DIR;
  process.env.CBE_PROJECTS_DIR = root;
  try {
    if (init) {
      git(dir, ['init', '-b', 'main']);
      git(dir, ['config', 'user.name', 'Test Author']);
      git(dir, ['config', 'user.email', 'test@collab.codes']);
    }
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env.CBE_PROJECTS_DIR;
    else process.env.CBE_PROJECTS_DIR = prev;
    rmSync(root, { recursive: true, force: true });
  }
}

function commit(dir: string, message: string): void {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', message]);
}

test('readHistory returns the commits newest first, with numstat', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, 'l2', 'foo.ts'), 'line1\nline2\n');
    commit(dir, 'first');
    writeFileSync(join(dir, 'l2', 'foo.ts'), 'line1\nline2\nline3\n');
    commit(dir, 'second');

    const history = readHistory(PROJECT_ID, 'l2/foo.ts');
    assert.equal(history.length, 2);
    assert.equal(history[0].message, 'second');
    assert.equal(history[1].message, 'first');
    assert.equal(history[0].authorName, 'Test Author');
    assert.match(history[0].ref, /^[0-9a-f]{40}$/u);
    assert.match(history[0].date, /^\d{4}-\d{2}-\d{2}T/u);
    // second added one line to the existing file; first created both.
    assert.deepEqual([history[0].additions, history[0].deletions], [1, 0]);
    assert.deepEqual([history[1].additions, history[1].deletions], [2, 0]);
  });
});

test('a subject with a tab, and a body, do not break the parse', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, 'l2', 'foo.ts'), 'a\n');
    // A tab is also the numstat column separator, so a subject containing one
    // is exactly what would break a parser that split the record on tabs.
    // The body (after the blank line) is not part of %s.
    commit(dir, 'fix:\tpanel\n\nbody line, not part of the subject');

    const history = readHistory(PROJECT_ID, 'l2/foo.ts');
    assert.equal(history.length, 1);
    assert.equal(history[0].message, 'fix:\tpanel');
    assert.deepEqual([history[0].additions, history[0].deletions], [1, 0]);
  });
});

test('readHistoryContent returns the content at that commit', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, 'l2', 'foo.ts'), 'old\n');
    commit(dir, 'first');
    writeFileSync(join(dir, 'l2', 'foo.ts'), 'new\n');
    commit(dir, 'second');

    const history = readHistory(PROJECT_ID, 'l2/foo.ts');
    assert.equal(readHistoryContent(PROJECT_ID, 'l2/foo.ts', history[0].ref), 'new\n');
    assert.equal(readHistoryContent(PROJECT_ID, 'l2/foo.ts', history[1].ref), 'old\n');
  });
});

test('content from before a rename resolves under the old name', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, 'l2', 'old.ts'), 'before the rename\n');
    commit(dir, 'first');
    git(dir, ['mv', 'l2/old.ts', 'l2/new.ts']);
    commit(dir, 'rename');
    writeFileSync(join(dir, 'l2', 'new.ts'), 'after the rename\n');
    commit(dir, 'edit');

    const history = readHistory(PROJECT_ID, 'l2/new.ts');
    assert.equal(history.length, 3, '--follow must cross the rename');

    // The oldest commit knows nothing about l2/new.ts: without the path
    // fallback this is the entry that opens an empty diff.
    const oldest = history[history.length - 1];
    assert.equal(readHistoryContent(PROJECT_ID, 'l2/new.ts', oldest.ref), 'before the rename\n');
  });
});

test('an unknown or untracked path has no history, and is not an error', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, 'l2', 'foo.ts'), 'a\n');
    commit(dir, 'first');
    writeFileSync(join(dir, 'l2', 'untracked.ts'), 'b\n');

    assert.deepEqual(readHistory(PROJECT_ID, 'l2/absent.ts'), []);
    assert.deepEqual(readHistory(PROJECT_ID, 'l2/untracked.ts'), []);
    assert.equal(readHistoryContent(PROJECT_ID, 'l2/absent.ts', 'a'.repeat(40)), null);
  });
});

test('a project folder without .git answers empty instead of throwing', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, 'l2', 'foo.ts'), 'a\n');
    assert.equal(isGitRepo(PROJECT_ID), false);
    assert.deepEqual(readHistory(PROJECT_ID, 'l2/foo.ts'), []);
    assert.equal(readHistoryContent(PROJECT_ID, 'l2/foo.ts', 'a'.repeat(40)), null);
  }, { init: false });
});

// ── Negative control: shortPath and ref both arrive from the browser ─────────

test('a shortPath that escapes the project is refused, and nothing is read', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, 'l2', 'foo.ts'), 'a\n');
    commit(dir, 'first');
    const outside = join(dir, '..', 'secret.txt');
    writeFileSync(outside, 'SECRET\n');

    for (const shortPath of [
      '../secret.txt',
      'l2/../../secret.txt',
      '/etc/passwd',
      'C:/Windows/win.ini',
      'l2\\foo.ts',
      'l9/foo.ts',
      'l2/foo\0.ts',
    ]) {
      assert.deepEqual(readHistory(PROJECT_ID, shortPath), [], shortPath);
      assert.equal(readHistoryContent(PROJECT_ID, shortPath, 'a'.repeat(40)), null, shortPath);
    }
    assert.ok(existsSync(outside), 'the negative control file must still be there');
  });
});

test('a ref that is not a plain object name is refused', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, 'l2', 'foo.ts'), 'a\n');
    commit(dir, 'first');

    for (const ref of [
      'local',                       // the history panel's sentinel row
      'HEAD',                        // valid to git, but not an object name we accept
      'HEAD; rm -rf /',
      '--output=/tmp/pwned',
      '-x',
      '$(id)',
      'a'.repeat(41),                // too long to be a sha
      'abc',                         // too short
      'zzzzzzz',                     // not hex
      '',
    ]) {
      assert.equal(readHistoryContent(PROJECT_ID, 'l2/foo.ts', ref), null, ref);
    }
    assert.ok(!existsSync('/tmp/pwned'));
  });
});

test('a valid-looking but unknown sha returns null, not a throw', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, 'l2', 'foo.ts'), 'a\n');
    commit(dir, 'first');
    assert.equal(readHistoryContent(PROJECT_ID, 'l2/foo.ts', '0'.repeat(40)), null);
  });
});
