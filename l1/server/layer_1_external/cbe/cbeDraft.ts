/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeDraft.ts" enhancement="_blank" />
// Resolves the studio draft named by cookie `collab-draft` and ensures its git
// worktree. Invalid slugs are "no draft" (null), never an error.

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { parseCookies } from '/_102034_/l1/server/layer_1_external/cbe/cbeAuthJwt.js';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 30000;
const LOCK_RETRY_MS = 200;
const TEAM_SLUG_RE = /^team-([a-z0-9_.-]{1,64})$/;
const USER_SLUG_RE = /^user-([a-f0-9]{16})$/;

export interface DraftSlug {
  slug: string;
  branch: string;
}

export interface RequestDraft {
  slug: string;
  branch: string;
  sourceRoot: string;
}

export type DraftGit = (args: string[], cwd: string) => Promise<string>;

/** First 16 hex of sha256(email, lowercase). Same person, same code. */
export function personCodeForEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex').slice(0, 16);
}

export function draftSlugForUser(email: string): DraftSlug {
  const h = personCodeForEmail(email);
  return { slug: `user-${h}`, branch: `user/${h}` };
}

export function parseDraftSlug(cookieValue: string | undefined): DraftSlug | null {
  if (cookieValue === undefined) return null;
  const team = TEAM_SLUG_RE.exec(cookieValue);
  if (team) return { slug: cookieValue, branch: `team/${team[1]}` };
  const user = USER_SLUG_RE.exec(cookieValue);
  if (user) return { slug: cookieValue, branch: `user/${user[1]}` };
  return null;
}

export function draftOwnerPath(base: string, slug: string): string {
  return join(base, 'drafts', slug, 'owner.json');
}

export async function writeDraftOwner(base: string, slug: string, email: string): Promise<void> {
  const dir = join(base, 'drafts', slug);
  await mkdir(dir, { recursive: true });
  const body = `${JSON.stringify({ email: email.trim().toLowerCase() })}\n`;
  await writeFile(draftOwnerPath(base, slug), body, 'utf8');
}

export async function readDraftOwner(base: string, slug: string): Promise<string | null> {
  try {
    const raw = await readFile(draftOwnerPath(base, slug), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      console.error(`[cbe] draft ${slug}: owner.json is not an object`);
      return null;
    }
    const email = (parsed as { email?: unknown }).email;
    if (typeof email !== 'string' || email.trim() === '') {
      console.error(`[cbe] draft ${slug}: owner.json has no email`);
      return null;
    }
    return email;
  } catch (err) {
    if (isEnoent(err)) return null;
    console.error(`[cbe] draft ${slug}: owner.json read failed:`, err);
    return null;
  }
}

export function draftSourceRoot(base: string, slug: string, projectId: number): string {
  return join(base, 'drafts', slug, `mls-${projectId}`);
}

async function execGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: GIT_TIMEOUT_MS });
  return stdout.trim();
}

function errorText(err: unknown): string {
  const e = err as { stderr?: string; message?: string };
  return String(e.stderr ?? e.message ?? '');
}

function isRetryableGitError(err: unknown): boolean {
  const text = errorText(err);
  return text.includes('index.lock')
    || text.includes('already exists')
    || text.includes('cannot force update the branch')
    || text.includes('is already checked out')
    || text.includes('already used by worktree');
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

/** `realpath` when the path exists; `resolve` when it does not (worktree not created yet). */
async function canonicalDraftPath(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch (err) {
    if (isEnoent(err)) return resolve(p);
    console.error(`[cbe] draft realpath failed for ${p}:`, err);
    throw err;
  }
}

/**
 * `git worktree list --porcelain` prints the real path (`/private/var/...` on macOS,
 * symlink targets on Linux). Compare both sides with `realpath`.
 */
async function porcelainHasWorktree(porcelain: string, worktreePath: string): Promise<boolean> {
  const want = await canonicalDraftPath(worktreePath);
  for (const line of porcelain.split('\n')) {
    if (!line.startsWith('worktree ')) continue;
    const listed = line.slice('worktree '.length).trim();
    if (!listed) continue;
    if (await canonicalDraftPath(listed) === want) return true;
  }
  return false;
}

export async function ensureDraftWorktree(opts: {
  base: string;
  projectId: number;
  slug: string;
  branch: string;
  git?: DraftGit;
}): Promise<string> {
  const git = opts.git ?? execGit;
  const repoPath = resolve(join(opts.base, `mls-${opts.projectId}`));
  const worktreePath = resolve(draftSourceRoot(opts.base, opts.slug, opts.projectId));

  const run: DraftGit = (args, cwd) => git(['-c', `safe.directory=${cwd}`, ...args], cwd);

  for (let attempt = 1; ; attempt += 1) {
    try {
      const list = await run(['worktree', 'list', '--porcelain'], repoPath);
      if (await porcelainHasWorktree(list, worktreePath)) return worktreePath;

      let branchExists = false;
      try {
        await run(['rev-parse', '--verify', `refs/heads/${opts.branch}`], repoPath);
        branchExists = true;
      } catch {
        branchExists = false;
      }

      if (branchExists) {
        await run(['worktree', 'add', worktreePath, opts.branch], repoPath);
      } else {
        await run(['worktree', 'add', '-B', opts.branch, worktreePath, 'main'], repoPath);
      }
      return worktreePath;
    } catch (err) {
      if (isRetryableGitError(err) && attempt < 2) {
        await sleep(LOCK_RETRY_MS);
        continue;
      }
      throw err;
    }
  }
}

export interface DraftRequestHeaders {
  cookie?: string | string[] | undefined;
  'x-collab-draft'?: string | string[] | undefined;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Raw draft mark for this call. A non-empty `x-collab-draft` wins;
 * an empty or absent header falls through to the `collab-draft` cookie.
 * The caller validates with `parseDraftSlug`: an invalid header is null and does not use the cookie.
 */
export function requestDraftValue(headers: DraftRequestHeaders | undefined): string | undefined {
  if (!headers) return undefined;
  const marked = firstHeader(headers['x-collab-draft']);
  if (marked !== undefined && marked !== '') return marked;
  return parseCookies(firstHeader(headers.cookie))['collab-draft'];
}

async function materializeDraft(base: string, projectId: number, parsed: DraftSlug): Promise<RequestDraft> {
  const sourceRoot = resolve(draftSourceRoot(base, parsed.slug, projectId));
  try {
    await mkdir(dirname(sourceRoot), { recursive: true });
    await ensureDraftWorktree({
      base,
      projectId,
      slug: parsed.slug,
      branch: parsed.branch,
    });
  } catch (err) {
    console.error(`[cbe] draft ${parsed.slug}: worktree failed: ${(err as Error).message}`);
    throw err;
  }
  return { slug: parsed.slug, branch: parsed.branch, sourceRoot };
}

/**
 * Draft named by this call (`x-collab-draft`, else the `collab-draft` cookie), with its worktree ready.
 * Missing or invalid slug is null — the caller keeps today's paths.
 */
export async function resolveRequestDraft(
  headers: DraftRequestHeaders | undefined,
  base: string,
  projectId: number,
): Promise<RequestDraft | null> {
  const parsed = parseDraftSlug(requestDraftValue(headers));
  if (!parsed) return null;
  return materializeDraft(base, projectId, parsed);
}

/**
 * Draft for a source write. A valid mark wins. Missing or invalid marks write to
 * `team-<projectId>`, creating that worktree when it does not exist.
 */
export async function resolveWriteDraft(
  headers: DraftRequestHeaders | undefined,
  base: string,
  projectId: number,
): Promise<RequestDraft> {
  const marked = requestDraftValue(headers);
  const parsed = parseDraftSlug(marked);
  if (parsed) return materializeDraft(base, projectId, parsed);
  const teamSlug = `team-${projectId}`;
  if (marked !== undefined && marked !== '') {
    console.warn(`[cbe] setContents project ${projectId}: refused draft ${marked}, using ${teamSlug}`);
  } else {
    console.info(`[cbe] setContents project ${projectId}: no draft, using ${teamSlug}`);
  }
  const team = parseDraftSlug(teamSlug);
  if (!team) {
    const msg = `[cbe] setContents project ${projectId}: team draft slug ${teamSlug} is not valid`;
    console.error(msg);
    throw new Error(msg);
  }
  return materializeDraft(base, projectId, team);
}
