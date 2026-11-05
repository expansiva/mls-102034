/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeDesenv.ts" enhancement="_blank" />
// GET /desenv turns the draft on; GET /desenv/sair turns it off.
// The path is only the entrance. Routing after that is the cookie.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseDraftSlug, draftSlugForUser, ensureDraftWorktree, requestDraftValue, type DraftRequestHeaders } from '/_102034_/l1/server/layer_1_external/cbe/cbeDraft.js';
import { readDevLogTail, writeDevLogTail } from '/_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.js';
import { AncestorDenoConfigError, DenoMissingError, DraftDatabaseError, DraftWorktreeMissingError, ensureDevProcess, stopDevProcess, waitForDevReady } from '/_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.js';
import { fastForwardDraft } from '/_102034_/l1/server/layer_1_external/cbe/cbeGitPromote.js';
import { getProjectsBaseDir } from '/_102034_/l1/server/layer_1_external/cbe/cbeCompiledLocal.js';
import { readProjectsConfig } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import {
  CBE_HTTP_BAD_REQUEST,
  CBE_HTTP_OK,
  CBE_HTTP_SERVER_ERROR,
  CBE_HTTP_UNAUTHORIZED,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeTypes.js';

const HTTP_FOUND = 302;
const DRAFT_COOKIE = 'collab-draft';

export interface DesenvResult {
  status: number;
  location?: string;
  setCookie?: string;
  body?: { statusCode: number; msg: string } | { statusCode: number; ok: true; slug: string; head?: string };
}

type DraftRefusal = { ok: false; status: number; msg: string };

interface OpenedDraft {
  ok: true;
  slug: string;
  head?: string;
}

/**
 * The workspace's single `type: "client"` project (fallback: `defaultProjectId`). Used by
 * startServer.ts for the boot config and for the draft proxy.
 */
export function resolveClientProjectId(): string {
  const config = readProjectsConfig();
  const client = Object.entries(config.projects).find(([, project]) => project.type === 'client');
  return client?.[0] ?? config.defaultProjectId;
}

/** Tests replace these calls so /desenv does not create a worktree, sync git, or spawn Deno. */
export const desenvIo = {
  resolveClientProjectId,
  getProjectsBaseDir,
  ensureDraftWorktree,
  fastForwardDraft,
  stopDevProcess,
  ensureDevProcess,
  waitForDevReady,
  isAllowed: async (_request: FastifyRequest): Promise<boolean> => {
    console.error('[cbe] /desenv: session gate was not registered');
    return false;
  },
};

export function draftCookie(slug: string): string {
  return `${DRAFT_COOKIE}=${encodeURIComponent(slug)}; Path=/; SameSite=Lax`;
}

export function clearDraftCookie(): string {
  return `${DRAFT_COOKIE}=; Path=/; SameSite=Lax; Expires=${new Date(0).toUTCString()}`;
}

/** A path on this host. `null` is not a safe redirect target. */
export function draftReturnPath(to: string | undefined): string | null {
  if (to === undefined || to === '') return '/';
  if (!to.startsWith('/') || to.startsWith('//')) return null;
  if (/[\r\n\\]/.test(to) || to.includes('://')) return null;
  return to;
}

function queryValue(query: unknown, key: string): string | undefined {
  if (typeof query !== 'object' || query === null) return undefined;
  const value = (query as Record<string, unknown>)[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

interface PreparedDraft {
  port: number;
  head?: string;
}

/** One in-flight prepare per slug. Login warmup and draftEnter share it. */
const draftPrepareInflight = new Map<string, Promise<PreparedDraft>>();

/**
 * Worktree, fast-forward (stop the child only when the branch moved) and one dev process.
 * A second caller for the same slug waits on the promise already running.
 */
export function prepareDraft(opts: {
  base: string;
  projectId: number;
  slug: string;
  branch: string;
  stages?: DraftStageMs;
}): Promise<PreparedDraft> {
  const current = draftPrepareInflight.get(opts.slug);
  if (current) return current;
  const run = runPrepareDraft(opts).finally(() => {
    if (draftPrepareInflight.get(opts.slug) === run) draftPrepareInflight.delete(opts.slug);
  });
  draftPrepareInflight.set(opts.slug, run);
  return run;
}

/** Waits out a prepare already running for this slug. A prepare error is logged and does not fail the waiter. */
export async function awaitDraftPrepare(slug: string): Promise<void> {
  const current = draftPrepareInflight.get(slug);
  if (!current) return;
  try {
    await current;
  } catch (err) {
    console.error(`[cbe] draft ${slug}: prepare failed before the next draft action: ${(err as Error).message}`);
  }
}

async function runPrepareDraft(opts: {
  base: string;
  projectId: number;
  slug: string;
  branch: string;
  stages?: DraftStageMs;
}): Promise<PreparedDraft> {
  const { base, projectId, slug, branch, stages } = opts;
  let head: string | undefined;
  let mark = Date.now();
  try {
    await desenvIo.ensureDraftWorktree({ base, projectId, slug, branch });
  } finally {
    if (stages) stages.worktree = stageMs(mark);
  }
  try {
    mark = Date.now();
    const sync = await desenvIo.fastForwardDraft({ base, projectId, slug });
    if (sync.status === 'fast_forwarded') {
      head = sync.ref;
      desenvIo.stopDevProcess(base, slug);
      console.info(`[cbe] /desenv: draft ${slug} fast-forwarded to ${sync.ref}`);
    } else if (sync.status !== 'up_to_date' && sync.status !== 'diverged') {
      const code = typeof sync.status === 'number' ? sync.code : sync.status;
      console.warn(`[cbe] /desenv: draft ${slug} not synced: ${code}`);
    }
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err);
    console.warn(`[cbe] /desenv: draft ${slug} not synced: ${code}`);
  } finally {
    if (stages) stages.fastForward = stageMs(mark);
  }
  mark = Date.now();
  let port: number;
  try {
    port = desenvIo.ensureDevProcess({ base, slug, clientProjectId: projectId }).port;
  } finally {
    if (stages) stages.ensureDevProcess = stageMs(mark);
  }
  return head === undefined ? { port } : { port, head };
}

/**
 * Studio login (draft mark present: `x-collab-draft` header, else the `collab-draft` cookie, as `requestDraftValue` reads it) prepares that person's draft
 * without waiting. A later draftEnter reuses the same prepare. No cookie, no child.
 * A throw is one log line and never the login result.
 */
export function warmPersonDraftOnLogin(headers: DraftRequestHeaders | undefined, email: string | undefined): void {
  try {
    const mark = requestDraftValue(headers);
    if (mark === undefined || mark === '' || !email) return;
    const slug = draftSlugForUser(email).slug;
    const parsed = parseDraftSlug(slug);
    if (!parsed) {
      console.error(`[cbe] login draft ${slug}: slug is not a draft`);
      return;
    }
    const projectId = clientProjectNumber(desenvIo.resolveClientProjectId());
    if (projectId === null) {
      console.error(`[cbe] login: client project id is not an integer: ${desenvIo.resolveClientProjectId()}`);
      return;
    }
    const base = desenvIo.getProjectsBaseDir();
    setImmediate(() => {
      prepareDraft({ base, projectId, slug: parsed.slug, branch: parsed.branch }).catch((err) => {
        console.error(`[cbe] login draft ${slug}: ${(err as Error).message}`);
      });
    });
  } catch (err) {
    console.error(`[cbe] login draft warmup: ${(err as Error).message}`);
  }
}

function clientProjectNumber(raw: string): number | null {
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const projectId = Number(raw);
  return Number.isSafeInteger(projectId) ? projectId : null;
}

function jsonResult(status: number, msg: string): DesenvResult {
  return { status, body: { statusCode: status, msg } };
}

function sameClientProject(project: unknown): boolean {
  const client = desenvIo.resolveClientProjectId();
  if (typeof project === 'string') return project === client;
  if (typeof project === 'number' && Number.isSafeInteger(project)) return String(project) === client;
  return false;
}

interface DraftStageMs {
  worktree: number;
  fastForward: number;
  ensureDevProcess: number;
  waitForDevReady: number;
}

function stageMs(start: number): number {
  return Date.now() - start;
}

function logDraftEnterTiming(started: number, stages: DraftStageMs): void {
  const total = Date.now() - started;
  console.info(
    `[cbe:timing] draftEnter total=${total}ms worktree=${stages.worktree}ms fastForward=${stages.fastForward}ms ensureDevProcess=${stages.ensureDevProcess}ms waitForDevReady=${stages.waitForDevReady}ms`,
  );
}

/** Session, slug, worktree, fast-forward and a ready dev process. Both doors call this. */
async function enterDraft(input: {
  allowed: boolean;
  draft: string | undefined;
  gate?: () => DraftRefusal | undefined;
  stages?: DraftStageMs;
}): Promise<DraftRefusal | OpenedDraft> {
  if (!input.allowed) return { ok: false, status: CBE_HTTP_UNAUTHORIZED, msg: 'login required' };

  const parsed = parseDraftSlug(input.draft);
  if (!parsed) return { ok: false, status: CBE_HTTP_BAD_REQUEST, msg: 'invalid draft' };

  const gated = input.gate?.();
  if (gated) return gated;

  const projectId = clientProjectNumber(desenvIo.resolveClientProjectId());
  if (projectId === null) {
    console.error(`[cbe] /desenv: client project id is not an integer: ${desenvIo.resolveClientProjectId()}`);
    return { ok: false, status: CBE_HTTP_SERVER_ERROR, msg: 'draft unavailable' };
  }

  const base = desenvIo.getProjectsBaseDir();
  let port: number;
  let head: string | undefined;
  try {
    const prepared = await prepareDraft({
      base,
      projectId,
      slug: parsed.slug,
      branch: parsed.branch,
      stages: input.stages,
    });
    port = prepared.port;
    head = prepared.head;
  } catch (err) {
    console.error(`[cbe] /desenv: draft ${parsed.slug} failed: ${(err as Error).message}`);
    if (err instanceof AncestorDenoConfigError || err instanceof DraftDatabaseError || err instanceof DraftWorktreeMissingError || err instanceof DenoMissingError) {
      return { ok: false, status: 503, msg: 'draft unavailable: ' + err.message };
    }
    return { ok: false, status: CBE_HTTP_SERVER_ERROR, msg: 'draft unavailable' };
  }

  const readyMark = Date.now();
  let ready = false;
  try {
    ready = await desenvIo.waitForDevReady(port);
  } finally {
    if (input.stages) input.stages.waitForDevReady = stageMs(readyMark);
  }
  if (!ready) {
    const tailFile = writeDevLogTail(base, parsed.slug, port);
    console.error(`[cbe] /desenv: draft ${parsed.slug} dev not ready on port ${port}; child log tail (also in ${tailFile}):\n${readDevLogTail(base, parsed.slug)}`);
    return { ok: false, status: 503, msg: 'draft unavailable: dev not ready' };
  }

  return { ok: true, slug: parsed.slug, head };
}

export async function runDesenvEnter(input: {
  allowed: boolean;
  draft: string | undefined;
  to: string | undefined;
}): Promise<DesenvResult> {
  const entered = await enterDraft({
    allowed: input.allowed,
    draft: input.draft,
    gate: () => {
      const location = draftReturnPath(input.to);
      if (!location) return { ok: false, status: CBE_HTTP_BAD_REQUEST, msg: 'invalid redirect' };
      return undefined;
    },
  });
  if (!entered.ok) return jsonResult(entered.status, entered.msg);
  return { status: HTTP_FOUND, location: draftReturnPath(input.to) ?? '/', setCookie: draftCookie(entered.slug) };
}

export async function runDraftEnter(input: {
  allowed: boolean;
  draft: string | undefined;
  project: unknown;
}): Promise<DesenvResult> {
  const started = Date.now();
  const stages: DraftStageMs = { worktree: 0, fastForward: 0, ensureDevProcess: 0, waitForDevReady: 0 };
  try {
    const entered = await enterDraft({
      allowed: input.allowed,
      draft: input.draft,
      stages,
      gate: () => {
        if (!sameClientProject(input.project)) return { ok: false, status: CBE_HTTP_BAD_REQUEST, msg: 'invalid project' };
        return undefined;
      },
    });
    if (!entered.ok) return jsonResult(entered.status, entered.msg);
    const body: { statusCode: number; ok: true; slug: string; head?: string } = {
      statusCode: CBE_HTTP_OK,
      ok: true,
      slug: entered.slug,
    };
    if (entered.head !== undefined) body.head = entered.head;
    return { status: CBE_HTTP_OK, body };
  } finally {
    logDraftEnterTiming(started, stages);
  }
}

export function runDesenvExit(input: { to: string | undefined }): DesenvResult {
  const location = draftReturnPath(input.to);
  if (!location) return jsonResult(CBE_HTTP_BAD_REQUEST, 'invalid redirect');
  return { status: HTTP_FOUND, location, setCookie: clearDraftCookie() };
}

function sendDesenv(reply: FastifyReply, result: DesenvResult): void {
  if (result.setCookie) reply.header('set-cookie', result.setCookie);
  if (result.location) reply.header('location', result.location);
  reply.code(result.status);
  if (result.body) {
    reply.send(result.body);
    return;
  }
  reply.send();
}

export async function handleDraftEnter(
  request: FastifyRequest,
  body: object,
  reply: FastifyReply,
): Promise<void> {
  const fields = body as { project?: unknown; draft?: unknown };
  const result = await runDraftEnter({
    allowed: await desenvIo.isAllowed(request),
    draft: typeof fields.draft === 'string' ? fields.draft : undefined,
    project: fields.project,
  });
  reply.code(result.status);
  reply.send(result.body);
}

export async function handleDesenvEnter(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const result = await runDesenvEnter({
    allowed: await desenvIo.isAllowed(request),
    draft: queryValue(request.query, 'draft'),
    to: queryValue(request.query, 'to'),
  });
  sendDesenv(reply, result);
}

export async function handleDesenvExit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  sendDesenv(reply, runDesenvExit({ to: queryValue(request.query, 'to') }));
}
