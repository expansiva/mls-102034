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
import { isAbsolute } from 'node:path';
import { resolveProjectSourcePath } from '/_102034_/l1/server/layer_1_external/cbe/cbeCompiledLocal.js';
import { resolveSourcePath, sourceFileFromBytes } from '/_102034_/l1/server/layer_1_external/cbe/cbeSources.js';
import type { CbeHistoryEntry, CbeSourceFile } from '/_102034_/l1/server/layer_1_external/cbe/cbeTypes.js';

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

/** `cwd`, when set, replaces `<base>/mls-<id>` (a draft worktree). It must be absolute. */
function git(projectId: number, args: string[], cwd?: string): string | null {
  if (cwd !== undefined && !isAbsolute(cwd)) {
    console.warn(`[cbe] git cwd is not absolute: "${cwd}" (project ${projectId})`);
    return null;
  }
  try {
    return execFileSync('git', ['-C', cwd ?? resolveProjectSourcePath(projectId, '.'), ...args], {
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
export function isGitRepo(projectId: number, sourceRoot?: string): boolean {
  if (!Number.isInteger(projectId) || projectId <= 0) return false;
  if (sourceRoot !== undefined && !isAbsolute(sourceRoot)) {
    console.warn(`[cbe] sourceRoot is not absolute: "${sourceRoot}" (project ${projectId})`);
    return false;
  }
  if (!existsSync(resolveProjectSourcePath(projectId, '.git', sourceRoot))) return false;
  return git(projectId, ['rev-parse', '--is-inside-work-tree'], sourceRoot)?.trim() === 'true';
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
export function readHistory(projectId: number, shortPath: string, sourceRoot?: string): CbeHistoryEntry[] {
  const path = resolveSourcePath(projectId, shortPath, sourceRoot);
  if (!path || !isGitRepo(projectId, sourceRoot)) return [];
  const out = git(projectId, [
    'log', `--max-count=${MAX_HISTORY}`, '--follow', '--numstat', `--format=${LOG_FORMAT}`, '--', shortPath,
  ], sourceRoot);
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
function pathAtCommit(projectId: number, shortPath: string, ref: string, sourceRoot?: string): string | null {
  const out = git(projectId, [
    'log', `--max-count=${MAX_HISTORY}`, '--follow', '--name-status', `--format=${RECORD_SEP}%H`, '--', shortPath,
  ], sourceRoot);
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
export function readHistoryContent(projectId: number, shortPath: string, ref: string, sourceRoot?: string): string | null {
  if (typeof ref !== 'string' || !REF_PATTERN.test(ref)) return null;
  const path = resolveSourcePath(projectId, shortPath, sourceRoot);
  if (!path || !isGitRepo(projectId, sourceRoot)) return null;

  const direct = git(projectId, ['show', `${ref}:${shortPath}`], sourceRoot);
  if (direct !== null) return direct;

  // Older than a rename: retry under the name the file had at that commit.
  const historicalPath = pathAtCommit(projectId, shortPath, ref, sourceRoot);
  if (!historicalPath || historicalPath === shortPath) return null;
  // The historical name comes from git itself, not from the browser — but it
  // still has to land inside the project, so it goes through the same gate.
  if (!resolveSourcePath(projectId, historicalPath, sourceRoot)) return null;
  return git(projectId, ['show', `${ref}:${historicalPath}`], sourceRoot);
}


/** Most paths one `getContents` with a `ref` may ask for; the client splits a bigger read into batches. */
export const MAX_REF_PATHS = 500;

/** True when `ref` is an acceptable object name (7..40 hex chars). */
export function isAcceptableRef(ref: unknown): ref is string {
  return typeof ref === 'string' && REF_PATTERN.test(ref);
}

/**
 * ONE `git cat-file --batch` process for every `<ref>:<path>` of `objects`: the blob bytes in the same order, null for
 * what is not a file in that commit (missing path, a folder, a submodule). `git()` above is a process per call, which
 * is what made a Studio reload cost one process per file.
 */
function catBatch(projectId: number, objects: string[], cwd?: string): Array<Buffer | null> | null {
  if (objects.length === 0) return [];
  if (cwd !== undefined && !isAbsolute(cwd)) return null;
  let out: Buffer;
  try {
    out = execFileSync('git', ['-C', cwd ?? resolveProjectSourcePath(projectId, '.'), 'cat-file', '--batch'], {
      input: `${objects.join('\n')}\n`,
      maxBuffer: MAX_BUFFER * 4,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
  const rows: Array<Buffer | null> = [];
  let at = 0;
  while (rows.length < objects.length && at < out.length) {
    const eol = out.indexOf(0x0a, at);
    if (eol < 0) return null;
    const header = out.subarray(at, eol).toString('utf8');
    at = eol + 1;
    const match = /^[0-9a-f]+ (\w+) (\d+)$/u.exec(header);
    if (!match) {
      rows.push(null); // "<object> missing" / "ambiguous": no content line follows
      continue;
    }
    const size = Number(match[2]);
    const body = out.subarray(at, at + size);
    at += size + 1; // the blob, then its newline
    rows.push(match[1] === 'blob' ? Buffer.from(body) : null);
  }
  return rows.length === objects.length ? rows : null;
}

/** `new name -> name it had at ref` for every rename between the commit and HEAD, in one process (`-z`: no quoting). */
function renamesSince(projectId: number, ref: string, sourceRoot?: string): Map<string, string> {
  const renames = new Map<string, string>();
  const out = git(projectId, ['diff', '--name-status', '-M', '-z', ref, 'HEAD'], sourceRoot);
  if (!out) return renames;
  const tokens = out.split('\0');
  for (let i = 0; i < tokens.length; i += 1) {
    const status = tokens[i];
    if (!status) continue;
    if (status.startsWith('R') || status.startsWith('C')) {
      const [from, to] = [tokens[i + 1], tokens[i + 2]];
      i += 2;
      if (status.startsWith('R') && from && to) renames.set(to, from);
    } else {
      i += 1; // one path follows
    }
  }
  return renames;
}

/**
 * The files of `shortPaths` as they were in the commit `ref`, or null when the read is not acceptable: a ref that is
 * not 7..40 hex, a commit that does not exist, a tree that is not a git repository, or too many paths.
 *
 * Same rules as `readSources` for the shape (utf8 for text, base64 otherwise) and as `readHistoryContent` for what is
 * left out: a path the project boundary rejects (one `console.warn`) and a file that did not exist in the commit.
 * A file renamed AFTER the commit is looked up under the name it had then, through the same boundary: one `git diff -M`
 * for all the files that were missing, and a second batch for the ones it explains.
 */
export function readContentsAtRef(projectId: number, shortPaths: string[], ref: string, sourceRoot?: string): CbeSourceFile[] | null {
  if (!isAcceptableRef(ref) || shortPaths.length > MAX_REF_PATHS || !isGitRepo(projectId, sourceRoot)) return null;
  if (git(projectId, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], sourceRoot) === null) return null;

  const asked: string[] = [];
  for (const shortPath of shortPaths) {
    if (typeof shortPath !== 'string' || /[\r\n\0]/u.test(shortPath) || !resolveSourcePath(projectId, shortPath, sourceRoot)) {
      console.warn(`[cbe] getContents: rejected shortPath "${String(shortPath)}" (project ${projectId})`);
      continue;
    }
    asked.push(shortPath);
  }
  const first = catBatch(projectId, asked.map((shortPath) => `${ref}:${shortPath}`), sourceRoot);
  if (first === null) return null;

  const bytes = new Map<string, Buffer>();
  const missing: string[] = [];
  asked.forEach((shortPath, index) => {
    const found = first[index];
    if (found) bytes.set(shortPath, found);
    else missing.push(shortPath);
  });
  if (missing.length > 0) {
    // Renamed AFTER the commit: ONE `git diff -M` from the commit to HEAD tells every rename at once (a log per missing
    // file would be the process-per-file cost this action exists to remove). The old name goes through the same gate.
    const renames = renamesSince(projectId, ref, sourceRoot);
    const retry = missing
      .map((shortPath) => ({ shortPath, at: renames.get(shortPath) }))
      .filter((item): item is { shortPath: string; at: string } => item.at !== undefined && item.at !== item.shortPath
        && !/[\r\n\0]/u.test(item.at) && resolveSourcePath(projectId, item.at, sourceRoot) !== null);
    const second = catBatch(projectId, retry.map((item) => `${ref}:${item.at}`), sourceRoot);
    retry.forEach((item, index) => {
      const found = second?.[index];
      if (found) bytes.set(item.shortPath, found);
    });
  }
  return asked.filter((shortPath) => bytes.has(shortPath)).map((shortPath) => sourceFileFromBytes(shortPath, bytes.get(shortPath) as Buffer));
}
