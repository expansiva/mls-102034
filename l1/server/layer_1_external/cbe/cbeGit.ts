/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeGit.ts" enhancement="_blank" />
// Read-only git history for the VM storage driver (mls-102033 l2/cbe/driverVm.ts).
//
// The driver used to declare history "not supported on the VM" — true for pull
// requests and forks, but not for history: gitReposSetup.mjs arms every
// <base>/mls-<id> as a real git repo (main, vm-baseline, post-receive). The
// history is already on disk; only an /exec action to read it was missing.
//
// SCOPE: reads only — the writing half is cbeGitCommit.ts, which commits what a
// studio save wrote (author from the caller's session, message from the save
// comment). So what this returns is both the PUBLISH history and the studio's
// own edits, newest first.
//
// SECURITY: shortPath and ref both come from the browser and both become git
// arguments. Every call goes through execFileSync with an ARGUMENT ARRAY and
// never a shell, the path is validated by cbeSources.resolveSourcePath (the
// same boundary the read/write actions use) and passed after `--`, and the ref
// must be a plain hex object name.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolveProjectSourcePath } from '/_102034_/l1/server/layer_1_external/cbe/cbeCompiledLocal.js';
import { resolveSourcePath } from '/_102034_/l1/server/layer_1_external/cbe/cbeSources.js';
import type { CbeHistoryEntry } from '/_102034_/l1/server/layer_1_external/cbe/cbeTypes.js';

/** Object names only: 7..40 hex chars. Refuses 'local' (the UI's sentinel row),
 * option-looking values ('--output=…') and anything a shell would find useful. */
const REF_PATTERN = /^[0-9a-f]{7,40}$/u;

/** Field/record separators for `git log --format`: \x1f and \x01 cannot appear
 * in a commit message, so a subject with newlines or pipes still parses. */
const FIELD_SEP = '\u001f';
const RECORD_SEP = '\u0001';
const LOG_FORMAT = `${RECORD_SEP}%H${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s`;

/** Enough for any real file; also the ceiling on what one /exec answer can cost. */
const MAX_HISTORY = 100;
const MAX_BUFFER = 32 * 1024 * 1024;

function git(projectId: number, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', resolveProjectSourcePath(projectId, '.'), ...args], {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    // A non-zero exit is an ordinary answer here ("no such path in that commit",
    // "not a repository") — the callers turn it into empty/null, never a 500.
    return null;
  }
}

/** True when the project folder is a git repository (a dev workspace or a dep
 * cloned outside the standard layout may not be). */
export function isGitRepo(projectId: number): boolean {
  if (!Number.isInteger(projectId) || projectId <= 0) return false;
  if (!existsSync(resolveProjectSourcePath(projectId, '.git'))) return false;
  return git(projectId, ['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';
}

/** Splits `git log --numstat` output into the history entries the cfe expects. */
function parseLog(out: string): CbeHistoryEntry[] {
  const rc: CbeHistoryEntry[] = [];
  for (const record of out.split(RECORD_SEP)) {
    if (!record.trim()) continue;
    const [header, ...statLines] = record.split('\n');
    const [ref, authorName, date, ...messageParts] = header.split(FIELD_SEP);
    if (!ref) continue;
    let additions = 0;
    let deletions = 0;
    for (const line of statLines) {
      const [add, del] = line.split('\t');
      // A binary file reports '-'/'-'; Number('-') is NaN, so guard both.
      additions += Number.parseInt(add, 10) || 0;
      deletions += Number.parseInt(del, 10) || 0;
    }
    rc.push({
      ref,
      authorName: authorName ?? '',
      date: date ?? '',
      // The subject cannot contain FIELD_SEP, but rejoining is free insurance.
      message: messageParts.join(FIELD_SEP),
      additions,
      deletions,
    });
  }
  return rc;
}

/**
 * Commits that touched the file, newest first. `--follow` crosses renames, so
 * the list does not stop at the file's current name.
 *
 * Returns [] for an unknown path, an untracked file or a non-repo — all of
 * which mean "no history", not "failed".
 */
export function readHistory(projectId: number, shortPath: string): CbeHistoryEntry[] {
  const path = resolveSourcePath(projectId, shortPath);
  if (!path || !isGitRepo(projectId)) return [];
  const out = git(projectId, [
    'log', `--max-count=${MAX_HISTORY}`, '--follow', '--numstat', `--format=${LOG_FORMAT}`, '--', shortPath,
  ]);
  return out ? parseLog(out) : [];
}

/**
 * The path the file had at a given commit. Needed because `--follow` reports
 * commits from BEFORE a rename, where the current shortPath does not exist:
 * without this, every entry older than a rename would open an empty diff.
 *
 * `--name-status` marks a rename as `R<score>\t<old>\t<new>`; walking the log
 * from newest to oldest and keeping the old name of each rename gives the name
 * in force at each commit.
 */
function pathAtCommit(projectId: number, shortPath: string, ref: string): string | null {
  const out = git(projectId, [
    'log', `--max-count=${MAX_HISTORY}`, '--follow', '--name-status', `--format=${RECORD_SEP}%H`, '--', shortPath,
  ]);
  if (!out) return null;

  let current = shortPath;
  for (const record of out.split(RECORD_SEP)) {
    if (!record.trim()) continue;
    const [commit, ...statusLines] = record.split('\n');
    if (commit.trim() === ref) return current;
    for (const line of statusLines) {
      const parts = line.split('\t');
      if (parts[0]?.startsWith('R') && parts[1]) current = parts[1];
    }
  }
  return null;
}

/**
 * The file's content at a commit, or null when the ref is not acceptable, the
 * commit is unknown, or the file did not exist there.
 */
export function readHistoryContent(projectId: number, shortPath: string, ref: string): string | null {
  if (typeof ref !== 'string' || !REF_PATTERN.test(ref)) return null;
  const path = resolveSourcePath(projectId, shortPath);
  if (!path || !isGitRepo(projectId)) return null;

  const direct = git(projectId, ['show', `${ref}:${shortPath}`]);
  if (direct !== null) return direct;

  // Older than a rename: retry under the name the file had at that commit.
  const historicalPath = pathAtCommit(projectId, shortPath, ref);
  if (!historicalPath || historicalPath === shortPath) return null;
  // The historical name comes from git itself, not from the browser — but it
  // still has to land inside the project, so it goes through the same gate.
  if (!resolveSourcePath(projectId, historicalPath)) return null;
  return git(projectId, ['show', `${ref}:${historicalPath}`]);
}

