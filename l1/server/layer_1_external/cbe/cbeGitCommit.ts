/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeGitCommit.ts" enhancement="_blank" />
// Commits what a studio save just wrote, on the project's CURRENT branch, right
// before the rebuild is scheduled.
//
// WHY THIS EXISTS
// The file index the browser trusts (fileinfos.json, inside obj/compiled.zip)
// takes each file's versionRef from `git ls-tree -r HEAD` — see
// scripts/buildCI/fileInfo.mjs, whose content-sha1 fallback only applies to
// files absent from HEAD. A file written by writeSources() and never committed
// therefore keeps the OID of the LAST COMMIT: the rebuild regenerates the zip
// with the same versionRef, the login reports nothing new, and the browser goes
// on serving the pre-edit .ts from its cache. The save looks applied — the
// compiled js does update — while opening the source shows the old content.
// Committing here is what makes that versionRef move.
//
// ORDER MATTERS: this runs BEFORE scheduleRebuildOnSave() so the build that
// follows already reads the new HEAD. It is synchronous with the request for
// the same reason — a commit that landed after the build would only take effect
// on the NEXT save.
//
// BEST-EFFORT BY CONTRACT: the files are already durable on disk (writeFileSync
// completed synchronously inside writeSources) before this module is called, so
// a commit that fails must never fail the save. The outcome is reported back to
// the caller and logged, never thrown.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { resolveProjectSourcePath } from '/_102034_/l1/server/layer_1_external/cbe/cbeCompiledLocal.js';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 30000;
/** Two pm2 cluster workers share one repo: a concurrent save loses the index.lock race. */
const LOCK_RETRIES = 3;
const LOCK_RETRY_MS = 200;

const FALLBACK_AUTHOR = { name: 'collab studio', email: 'studio@localhost' };

export interface GitCommitAuthor {
  name: string;
  email: string;
}

export interface GitCommitOutcome {
  /** committed: HEAD moved. nothing: the write produced no diff (same bytes). */
  status: 'committed' | 'nothing' | 'disabled' | 'not-a-repo' | 'failed';
  /** Commit sha, when one was created. */
  ref?: string;
  msg?: string;
}

/**
 * CBE_COMMIT_ON_SAVE=always|never overrides; default is production-only — same
 * rule as cbeRebuildOnSave, and for the same reason: a dev checkout must not
 * grow a commit every time someone saves a file from a local studio.
 */
export function isCommitOnSaveEnabled(): boolean {
  const override = process.env.CBE_COMMIT_ON_SAVE;
  if (override === 'always') return true;
  if (override === 'never') return false;
  return process.env.NODE_ENV === 'production';
}

/** Identity for the commit, derived from the caller's collab-auth session. */
export function authorFromSession(email: string | undefined): GitCommitAuthor {
  const trimmed = (email ?? '').trim();
  if (!trimmed.includes('@')) return FALLBACK_AUTHOR;
  return { name: trimmed.split('@')[0] || trimmed, email: trimmed };
}

/** First line of the save's comment, or a description of what was written. */
export function commitMessage(comments: string | undefined, fileCount: number): string {
  const firstLine = (comments ?? '').split('\n')[0].trim().slice(0, 200);
  if (firstLine) return firstLine;
  return `studio save: ${fileCount} file(s)`;
}

function isLockError(err: unknown): boolean {
  return String((err as { stderr?: string; message?: string }).stderr ?? (err as Error).message ?? '').includes('index.lock');
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * Runs git in the project tree. `safe.directory` is set per call (never written
 * to any config): the pm2 worker may not own the checkout, and git refuses to
 * operate on a "dubious ownership" repo otherwise. Args are passed as an array —
 * no shell, so a path can never be interpreted as a command.
 */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-c', `safe.directory=${cwd}`, ...args], {
    cwd,
    timeout: GIT_TIMEOUT_MS,
  });
  return stdout.trim();
}

/** true when the staged tree differs from HEAD for these paths. */
async function hasStagedChanges(projectRoot: string, pathspecs: string[]): Promise<boolean> {
  try {
    await git(projectRoot, ['diff', '--cached', '--quiet', '--', ...pathspecs]);
    return false; // exit 0 = no difference
  } catch (err) {
    if ((err as { code?: number }).code === 1) return true; // exit 1 = differences staged
    throw err;
  }
}

/**
 * Commits `shortPaths` (relative to the project root, exactly as the driver
 * addresses them) on the current branch.
 *
 * `git add` comes first because `git commit -- <path>` alone cannot pick up a
 * file that is not yet tracked — a brand new file created by the studio. The
 * pathspecs are prefixed with `:(literal)` so a name carrying a glob character
 * is matched as itself and can never widen the commit beyond what was saved.
 */
export async function commitSavedSources(
  projectId: number,
  shortPaths: string[],
  options: { comments?: string; author?: GitCommitAuthor } = {},
): Promise<GitCommitOutcome> {
  if (!isCommitOnSaveEnabled()) return { status: 'disabled' };
  if (shortPaths.length === 0) return { status: 'nothing' };

  const projectRoot = resolve(resolveProjectSourcePath(projectId, '.'));
  if (!existsSync(join(projectRoot, '.git'))) {
    return { status: 'not-a-repo', msg: `${projectRoot} is not a git checkout` };
  }

  const pathspecs = shortPaths.map((shortPath) => `:(literal)${shortPath}`);
  const author = options.author ?? FALLBACK_AUTHOR;
  const message = commitMessage(options.comments, shortPaths.length);

  for (let attempt = 1; ; attempt += 1) {
    try {
      // -A so a deleted file is staged as a deletion, not left behind.
      await git(projectRoot, ['add', '-A', '--', ...pathspecs]);
      if (!await hasStagedChanges(projectRoot, pathspecs)) return { status: 'nothing' };
      await git(projectRoot, [
        '-c', `user.name=${author.name}`,
        '-c', `user.email=${author.email}`,
        'commit',
        // The studio is not the place to run a repo's commit hooks: a hook that
        // fails (or prompts) would turn a save into an error for the user.
        '--no-verify',
        '-m', message,
        '--', ...pathspecs,
      ]);
      const ref = await git(projectRoot, ['rev-parse', 'HEAD']);
      return { status: 'committed', ref };
    } catch (err) {
      if (isLockError(err) && attempt < LOCK_RETRIES) {
        await sleep(LOCK_RETRY_MS * attempt);
        continue;
      }
      return { status: 'failed', msg: (err as Error).message };
    }
  }
}
