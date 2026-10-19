/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeGitPromote.ts" enhancement="_blank" />
// Promote a studio draft onto the main worktree, discard / list / diff it,
// or bring main into the draft (fast-forward when the draft has no own commits).
//
// The injected git returns the exit code and never throws: a conflicted merge
// exits 1, and that is a 409, not an exception. captureGit is the real
// executor (execFile, argument array). Callers prefix `-c safe.directory=<cwd>`
// — the same boundary as cbeDraft — because a pm2 worker may not own the repo.
// The branch always comes from parseDraftSlug; a browser ref never reaches git.

import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { draftSourceRoot, parseDraftSlug } from '/_102034_/l1/server/layer_1_external/cbe/cbeDraft.js';
import type { GitCommitAuthor } from '/_102034_/l1/server/layer_1_external/cbe/cbeGitCommit.js';
import { resolveSourcePath } from '/_102034_/l1/server/layer_1_external/cbe/cbeSources.js';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 32 * 1024 * 1024;
const LOCK_RETRIES = 3;
const LOCK_RETRY_MS = 200;
const FIELD_SEP = '\x1f';

export interface GitCapture {
  stdout: string;
  code: number;
  stderr?: string;
}

/** Args are an array (no shell). Resolves on every exit code, including 1. */
export type PromoteGit = (args: string[], cwd: string) => Promise<GitCapture>;

export type PromoteDraftResult =
  | { status: 400; code: 'BAD_DRAFT' }
  | { status: 404; code: 'DRAFT_NOT_FOUND' }
  | { status: 409; code: 'MAIN_NOT_ON_MAIN' }
  | { status: 409; code: 'MAIN_DIRTY' }
  | { status: 'nothing_to_promote' }
  | { status: 409; code: 'DRAFT_CONFLICT'; files: string[] }
  | { status: 'merged'; ref: string }
  | { status: 500; code: 'GIT_ERROR' };

export type DiscardDraftResult =
  | { status: 400; code: 'BAD_DRAFT' }
  | { status: 'discarded' }
  | { status: 500; code: 'GIT_ERROR' };

export interface ListedDraft {
  branch: string;
  ahead: number;
  behind: number;
  author: string;
  email: string;
  date: string;
  message: string;
  files: string[];
}

export type ListDraftsResult =
  | { status: 'listed'; drafts: ListedDraft[] }
  | { status: 500; code: 'GIT_ERROR' };

export interface DraftDiffFile {
  status: 'A' | 'M' | 'D' | 'R';
  path: string;
  /** Blob on the draft. Null when the draft deleted the file. */
  sha: string | null;
  /** Previous path. Present only on a rename. */
  from?: string;
}

export type DraftDiffResult =
  | { status: 400; code: 'BAD_DRAFT' }
  | { status: 400; code: 'BAD_PATH' }
  | { status: 'diff'; text: string }
  | { status: 'files'; head: string; files: DraftDiffFile[] }
  | { status: 500; code: 'GIT_ERROR' };

export type SyncDraftResult =
  | { status: 400; code: 'BAD_DRAFT' }
  | { status: 409; code: 'DRAFT_DIRTY' }
  | { status: 'up_to_date' }
  | { status: 'fast_forwarded'; ref: string }
  | { status: 'diverged'; ahead: number; behind: number }
  | { status: 'merged'; ref: string }
  | { status: 409; code: 'DRAFT_CONFLICT'; files: string[] }
  | { status: 500; code: 'GIT_ERROR' };

interface ExecFailure {
  code?: number | string | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  message?: string;
}

function asText(value: string | Buffer | undefined): string {
  if (value === undefined) return '';
  return typeof value === 'string' ? value : value.toString('utf8');
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function mainWorktree(base: string, projectId: number): string {
  return resolve(join(base, `mls-${projectId}`));
}

function withSafeDirectory(git: PromoteGit, cwd: string): (args: string[]) => Promise<GitCapture> {
  return (args) => git(['-c', `safe.directory=${cwd}`, ...args], cwd);
}

function logGitFailure(where: string, result: GitCapture): void {
  const detail = (result.stderr ?? result.stdout).trim().slice(0, 500);
  console.error(`[cbe] ${where}: git exited ${result.code}${detail ? `: ${detail}` : ''}`);
}

function linesOf(stdout: string): string[] {
  return stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
}

function stripEmailBrackets(email: string): string {
  if (email.startsWith('<') && email.endsWith('>') && email.length > 2) return email.slice(1, -1);
  return email;
}

async function captureGitOnce(args: string[], cwd: string): Promise<GitCapture> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      encoding: 'utf8',
    });
    return { stdout: asText(stdout), stderr: asText(stderr), code: 0 };
  } catch (err) {
    const failure = err as ExecFailure;
    const code = typeof failure.code === 'number' ? failure.code : 1;
    return { stdout: asText(failure.stdout), stderr: asText(failure.stderr ?? failure.message), code };
  }
}

/**
 * Real git for these actions. A non-zero exit (merge conflict is 1) is a
 * result. index.lock is retried here so the domain still sees one answer.
 */
export async function captureGit(args: string[], cwd: string): Promise<GitCapture> {
  let last: GitCapture = { stdout: '', stderr: '', code: 1 };
  for (let attempt = 1; attempt <= LOCK_RETRIES; attempt += 1) {
    last = await captureGitOnce(args, cwd);
    const locked = (last.stderr ?? '').includes('index.lock');
    if (last.code === 0 || !locked || attempt === LOCK_RETRIES) return last;
    console.warn(`[cbe] git index.lock, retry ${attempt}/${LOCK_RETRIES}`);
    await sleep(LOCK_RETRY_MS);
  }
  return last;
}

export async function promoteDraft(opts: {
  base: string;
  projectId: number;
  slug: string;
  author: GitCommitAuthor;
  comment: string;
  git?: PromoteGit;
}): Promise<PromoteDraftResult> {
  const parsed = parseDraftSlug(opts.slug);
  if (!parsed) return { status: 400, code: 'BAD_DRAFT' };

  const branch = parsed.branch;
  const cwd = mainWorktree(opts.base, opts.projectId);
  const run = withSafeDirectory(opts.git ?? captureGit, cwd);

  const verified = await run(['rev-parse', '--verify', `refs/heads/${branch}`]);
  if (verified.code !== 0) return { status: 404, code: 'DRAFT_NOT_FOUND' };

  const head = await run(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (head.code !== 0) logGitFailure(`promoteDraft HEAD (${branch})`, head);
  if (head.code !== 0 || head.stdout.trim() !== 'main') return { status: 409, code: 'MAIN_NOT_ON_MAIN' };

  const porcelain = await run(['status', '--porcelain']);
  if (porcelain.code !== 0) {
    logGitFailure(`promoteDraft status (${branch})`, porcelain);
    return { status: 500, code: 'GIT_ERROR' };
  }
  if (porcelain.stdout.trim() !== '') return { status: 409, code: 'MAIN_DIRTY' };

  const pending = await run(['rev-list', '--count', `main..${branch}`]);
  if (pending.code !== 0) {
    logGitFailure(`promoteDraft rev-list (${branch})`, pending);
    return { status: 500, code: 'GIT_ERROR' };
  }
  if (pending.stdout.trim() === '0') return { status: 'nothing_to_promote' };

  const merged = await run([
    '-c', `user.name=${opts.author.name}`,
    '-c', `user.email=${opts.author.email}`,
    'merge', '--no-ff',
    '-m', `promote ${branch}: ${opts.comment}`,
    branch,
  ]);
  if (merged.code !== 0) {
    const listed = await run(['diff', '--name-only', '--diff-filter=U']);
    if (listed.code !== 0) logGitFailure(`promoteDraft unmerged (${branch})`, listed);
    const aborted = await run(['merge', '--abort']);
    if (aborted.code !== 0) logGitFailure(`promoteDraft merge --abort (${branch})`, aborted);
    return { status: 409, code: 'DRAFT_CONFLICT', files: linesOf(listed.stdout) };
  }

  const ref = await run(['rev-parse', 'HEAD']);
  if (ref.code !== 0) {
    logGitFailure(`promoteDraft HEAD after merge (${branch})`, ref);
    return { status: 500, code: 'GIT_ERROR' };
  }
  return { status: 'merged', ref: ref.stdout.trim() };
}

export async function discardDraft(opts: {
  base: string;
  projectId: number;
  slug: string;
  git?: PromoteGit;
}): Promise<DiscardDraftResult> {
  const parsed = parseDraftSlug(opts.slug);
  if (!parsed) return { status: 400, code: 'BAD_DRAFT' };

  const cwd = resolve(draftSourceRoot(opts.base, parsed.slug, opts.projectId));
  const run = withSafeDirectory(opts.git ?? captureGit, cwd);
  const reset = await run(['reset', '--hard', 'main']);
  if (reset.code !== 0) {
    logGitFailure(`discardDraft (${parsed.branch})`, reset);
    return { status: 500, code: 'GIT_ERROR' };
  }
  return { status: 'discarded' };
}

type SyncDraftOpts = {
  base: string;
  projectId: number;
  slug: string;
  git?: PromoteGit;
} & ({ mode: 'ff-only' } | { mode: 'merge'; author: GitCommitAuthor });

function parseAheadBehind(stdout: string): { behind: number; ahead: number } | undefined {
  const [behindText, aheadText] = stdout.trim().split(/\s+/u);
  const behind = Number(behindText);
  const ahead = Number(aheadText);
  if (!Number.isInteger(behind) || !Number.isInteger(ahead)) return undefined;
  return { behind, ahead };
}

async function syncDraft(opts: SyncDraftOpts): Promise<SyncDraftResult> {
  const parsed = parseDraftSlug(opts.slug);
  if (!parsed) return { status: 400, code: 'BAD_DRAFT' };

  const cwd = resolve(draftSourceRoot(opts.base, parsed.slug, opts.projectId));
  const run = withSafeDirectory(opts.git ?? captureGit, cwd);
  const where = opts.mode === 'ff-only'
    ? `fastForwardDraft (${parsed.branch})`
    : `mergeMainIntoDraft (${parsed.branch})`;

  const porcelain = await run(['status', '--porcelain']);
  if (porcelain.code !== 0) {
    logGitFailure(`${where} status`, porcelain);
    return { status: 500, code: 'GIT_ERROR' };
  }
  if (porcelain.stdout.trim() !== '') return { status: 409, code: 'DRAFT_DIRTY' };

  const counts = await run(['rev-list', '--left-right', '--count', 'main...HEAD']);
  if (counts.code !== 0) {
    logGitFailure(`${where} rev-list`, counts);
    return { status: 500, code: 'GIT_ERROR' };
  }
  const aheadBehind = parseAheadBehind(counts.stdout);
  if (!aheadBehind) {
    console.error(`[cbe] ${where}: unexpected ahead/behind: ${counts.stdout.trim()}`);
    return { status: 500, code: 'GIT_ERROR' };
  }
  const { behind, ahead } = aheadBehind;
  if (behind === 0) return { status: 'up_to_date' };

  if (ahead === 0) {
    const forwarded = await run(['merge', '--ff-only', 'main']);
    if (forwarded.code !== 0) {
      logGitFailure(`${where} merge --ff-only`, forwarded);
      return { status: 500, code: 'GIT_ERROR' };
    }
    const ref = await run(['rev-parse', 'HEAD']);
    if (ref.code !== 0) {
      logGitFailure(`${where} HEAD after ff`, ref);
      return { status: 500, code: 'GIT_ERROR' };
    }
    return { status: 'fast_forwarded', ref: ref.stdout.trim() };
  }

  if (opts.mode === 'ff-only') return { status: 'diverged', ahead, behind };

  const merged = await run([
    '-c', `user.name=${opts.author.name}`,
    '-c', `user.email=${opts.author.email}`,
    'merge', '--no-ff',
    '-m', `sync main into ${parsed.branch}`,
    'main',
  ]);
  if (merged.code !== 0) {
    const listed = await run(['diff', '--name-only', '--diff-filter=U']);
    if (listed.code !== 0) logGitFailure(`${where} unmerged`, listed);
    const aborted = await run(['merge', '--abort']);
    if (aborted.code !== 0) logGitFailure(`${where} merge --abort`, aborted);
    return { status: 409, code: 'DRAFT_CONFLICT', files: linesOf(listed.stdout) };
  }

  const ref = await run(['rev-parse', 'HEAD']);
  if (ref.code !== 0) {
    logGitFailure(`${where} HEAD after merge`, ref);
    return { status: 500, code: 'GIT_ERROR' };
  }
  return { status: 'merged', ref: ref.stdout.trim() };
}

export async function fastForwardDraft(opts: {
  base: string;
  projectId: number;
  slug: string;
  git?: PromoteGit;
}): Promise<SyncDraftResult> {
  return syncDraft({ ...opts, mode: 'ff-only' });
}

export async function mergeMainIntoDraft(opts: {
  base: string;
  projectId: number;
  slug: string;
  author: GitCommitAuthor;
  git?: PromoteGit;
}): Promise<SyncDraftResult> {
  return syncDraft({ ...opts, mode: 'merge' });
}

export async function listDrafts(opts: {
  base: string;
  projectId: number;
  git?: PromoteGit;
}): Promise<ListDraftsResult> {
  const cwd = mainWorktree(opts.base, opts.projectId);
  const run = withSafeDirectory(opts.git ?? captureGit, cwd);
  const listed = await run([
    'for-each-ref',
    `--format=%(refname:short)%1f%(authorname)%1f%(authoremail)%1f%(authordate:iso-strict)%1f%(subject)`,
    'refs/heads/team',
    'refs/heads/user',
  ]);
  if (listed.code !== 0) {
    logGitFailure(`listDrafts (${opts.projectId})`, listed);
    return { status: 500, code: 'GIT_ERROR' };
  }

  const drafts: ListedDraft[] = [];
  for (const line of linesOf(listed.stdout)) {
    const [branch, author, email, date, ...messageParts] = line.split(FIELD_SEP);
    if (!branch || (!branch.startsWith('team/') && !branch.startsWith('user/'))) continue;

    const counts = await run(['rev-list', '--left-right', '--count', `main...${branch}`]);
    if (counts.code !== 0) {
      logGitFailure(`listDrafts rev-list (${branch})`, counts);
      return { status: 500, code: 'GIT_ERROR' };
    }
    const [behindText, aheadText] = counts.stdout.trim().split(/\s+/u);
    const behind = Number(behindText);
    const ahead = Number(aheadText);
    if (!Number.isInteger(behind) || !Number.isInteger(ahead)) {
      console.error(`[cbe] listDrafts: unexpected ahead/behind for ${branch}: ${counts.stdout.trim()}`);
      return { status: 500, code: 'GIT_ERROR' };
    }

    const names = await run(['diff', '--name-only', `main...${branch}`]);
    if (names.code !== 0) {
      logGitFailure(`listDrafts diff (${branch})`, names);
      return { status: 500, code: 'GIT_ERROR' };
    }
    drafts.push({
      branch,
      ahead,
      behind,
      author: author ?? '',
      email: stripEmailBrackets(email ?? ''),
      date: date ?? '',
      message: messageParts.join(FIELD_SEP),
      files: linesOf(names.stdout),
    });
  }
  return { status: 'listed', drafts };
}

function parseNameStatus(stdout: string): DraftDiffFile[] {
  const files: DraftDiffFile[] = [];
  for (const line of linesOf(stdout)) {
    const parts = line.split('\t');
    // `:<mode> <mode> <old> <new> <status>\t<path>[\t<new path>]`
    const tokens = (parts[0] ?? '').split(' ');
    if (tokens.length < 5 || !tokens[3]) continue;
    const newBlob = tokens[3];
    const raw = tokens[4] ?? '';
    const letter = raw.charAt(0);
    if ((letter === 'A' || letter === 'M') && raw.length === 1 && parts[1]) {
      files.push({ status: letter, path: parts[1], sha: newBlob });
    } else if (letter === 'D' && raw.length === 1 && parts[1]) {
      files.push({ status: 'D', path: parts[1], sha: null });
    } else if (letter === 'R' && /^R\d*$/u.test(raw) && parts.length >= 3 && parts[1] && parts[parts.length - 1]) {
      files.push({ status: 'R', path: parts[parts.length - 1], sha: newBlob, from: parts[1] });
    }
  }
  return files;
}

export async function draftDiff(opts: {
  base: string;
  projectId: number;
  slug: string;
  shortPath?: string;
  names?: boolean;
  git?: PromoteGit;
}): Promise<DraftDiffResult> {
  const parsed = parseDraftSlug(opts.slug);
  if (!parsed) return { status: 400, code: 'BAD_DRAFT' };

  const cwd = mainWorktree(opts.base, opts.projectId);
  const args = opts.names === true
    ? ['diff', '--raw', '--no-abbrev', `main...${parsed.branch}`]
    : ['diff', `main...${parsed.branch}`];
  if (opts.shortPath !== undefined) {
    // Same containment as getContents: a browser path never becomes a git path
    // until it resolves inside the main worktree.
    const contained = resolveSourcePath(opts.projectId, opts.shortPath, cwd);
    if (!contained) {
      console.warn(`[cbe] draftDiff: rejected shortPath "${opts.shortPath}" (project ${opts.projectId})`);
      return { status: 400, code: 'BAD_PATH' };
    }
    args.push('--', opts.shortPath);
  }

  const run = withSafeDirectory(opts.git ?? captureGit, cwd);
  const diff = await run(args);
  if (diff.code !== 0) {
    logGitFailure(`draftDiff (${parsed.branch})`, diff);
    return { status: 500, code: 'GIT_ERROR' };
  }
  if (opts.names !== true) return { status: 'diff', text: diff.stdout };

  const head = await run(['rev-parse', parsed.branch]);
  if (head.code !== 0) {
    logGitFailure(`draftDiff rev-parse (${parsed.branch})`, head);
    return { status: 500, code: 'GIT_ERROR' };
  }
  return { status: 'files', head: head.stdout.trim(), files: parseNameStatus(diff.stdout) };
}
