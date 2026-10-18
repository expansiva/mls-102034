/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeDesenv.ts" enhancement="_blank" />
// GET /desenv turns the draft on; GET /desenv/sair turns it off.
// The path is only the entrance. Routing after that is the cookie.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseDraftSlug, ensureDraftWorktree } from '/_102034_/l1/server/layer_1_external/cbe/cbeDraft.js';
import { AncestorDenoConfigError, DraftDatabaseError, DraftWorktreeMissingError, ensureDevProcess, stopDevProcess, waitForDevReady } from '/_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.js';
import { fastForwardDraft } from '/_102034_/l1/server/layer_1_external/cbe/cbeGitPromote.js';
import { getProjectsBaseDir } from '/_102034_/l1/server/layer_1_external/cbe/cbeCompiledLocal.js';
import { readProjectsConfig } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import {
  CBE_HTTP_BAD_REQUEST,
  CBE_HTTP_SERVER_ERROR,
  CBE_HTTP_UNAUTHORIZED,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeTypes.js';

const HTTP_FOUND = 302;
const DRAFT_COOKIE = 'collab-draft';

export interface DesenvResult {
  status: number;
  location?: string;
  setCookie?: string;
  body?: { statusCode: number; msg: string };
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

function clientProjectNumber(raw: string): number | null {
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const projectId = Number(raw);
  return Number.isSafeInteger(projectId) ? projectId : null;
}

function jsonResult(status: number, msg: string): DesenvResult {
  return { status, body: { statusCode: status, msg } };
}

export async function runDesenvEnter(input: {
  allowed: boolean;
  draft: string | undefined;
  to: string | undefined;
}): Promise<DesenvResult> {
  if (!input.allowed) return jsonResult(CBE_HTTP_UNAUTHORIZED, 'login required');

  const parsed = parseDraftSlug(input.draft);
  if (!parsed) return jsonResult(CBE_HTTP_BAD_REQUEST, 'invalid draft');

  const location = draftReturnPath(input.to);
  if (!location) return jsonResult(CBE_HTTP_BAD_REQUEST, 'invalid redirect');

  const projectId = clientProjectNumber(desenvIo.resolveClientProjectId());
  if (projectId === null) {
    console.error(`[cbe] /desenv: client project id is not an integer: ${desenvIo.resolveClientProjectId()}`);
    return jsonResult(CBE_HTTP_SERVER_ERROR, 'draft unavailable');
  }

  const base = desenvIo.getProjectsBaseDir();
  let port: number;
  try {
    await desenvIo.ensureDraftWorktree({ base, projectId, slug: parsed.slug, branch: parsed.branch });
    try {
      const sync = await desenvIo.fastForwardDraft({ base, projectId, slug: parsed.slug });
      if (sync.status === 'fast_forwarded') {
        desenvIo.stopDevProcess(base, parsed.slug);
        console.info(`[cbe] /desenv: draft ${parsed.slug} fast-forwarded to ${sync.ref}`);
      } else if (sync.status !== 'up_to_date' && sync.status !== 'diverged') {
        const code = typeof sync.status === 'number' ? sync.code : sync.status;
        console.warn(`[cbe] /desenv: draft ${parsed.slug} not synced: ${code}`);
      }
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      console.warn(`[cbe] /desenv: draft ${parsed.slug} not synced: ${code}`);
    }
    port = desenvIo.ensureDevProcess({ base, slug: parsed.slug, clientProjectId: projectId }).port;
  } catch (err) {
    console.error(`[cbe] /desenv: draft ${parsed.slug} failed: ${(err as Error).message}`);
    if (err instanceof AncestorDenoConfigError || err instanceof DraftDatabaseError || err instanceof DraftWorktreeMissingError) {
      return jsonResult(503, 'draft unavailable: ' + err.message);
    }
    return jsonResult(CBE_HTTP_SERVER_ERROR, 'draft unavailable');
  }

  const ready = await desenvIo.waitForDevReady(port);
  if (!ready) {
    console.error(`[cbe] /desenv: draft ${parsed.slug} dev not ready on port ${port}`);
    return jsonResult(503, 'draft unavailable: dev not ready');
  }

  return { status: HTTP_FOUND, location, setCookie: draftCookie(parsed.slug) };
}

export function runDesenvExit(): DesenvResult {
  return { status: HTTP_FOUND, location: '/', setCookie: clearDraftCookie() };
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

export async function handleDesenvEnter(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const result = await runDesenvEnter({
    allowed: await desenvIo.isAllowed(request),
    draft: queryValue(request.query, 'draft'),
    to: queryValue(request.query, 'to'),
  });
  sendDesenv(reply, result);
}

export async function handleDesenvExit(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  sendDesenv(reply, runDesenvExit());
}
