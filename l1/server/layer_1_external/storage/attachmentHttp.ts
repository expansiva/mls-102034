/// <mls fileReference="_102034_/l1/server/layer_1_external/storage/attachmentHttp.ts" enhancement="_blank" />

/**
 * Dedicated binary door of the runtime. NOT `/execBff`: that envelope is JSON, is traced, and a
 * base64 body would blow the limits that already truncated payloads at 500 chars.
 *
 * POST /attachments     — base64 in, bytes to the project's permanent bucket (or local disk), then
 *                         `ctx.mdm.attachment.attach` with the storageKey. Never stores a URL.
 * GET  /attachments/:id/url  — short-lived signed GET (S3) or same-origin file path (local).
 * GET  /attachments/:id/file — local bytes only.
 */
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { isBffAuthEnforced, resolveBffSession } from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';
import { createDefaultRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import {
  getAttachmentReadUrl, readLocalAttachmentBytes, uploadAttachment,
} from '/_102034_/l1/mdm/layer_3_usecases/attachmentUpload.js';

export interface AttachmentHttpResult {
  statusCode: number;
  body: unknown;
  headers?: Record<string, string>;
}

const ATTACHMENT_PATH = /^\/attachments\/([^/]+)(?:\/(url|file))?$/u;

export function isAttachmentHttpPath(method: string, url: string): boolean {
  const path = pathnameOf(url);
  if (method === 'POST' && path === '/attachments') return true;
  if (method === 'GET' && ATTACHMENT_PATH.test(path)) return true;
  return false;
}

export async function handleAttachmentHttp(
  method: string,
  url: string,
  body: unknown,
  ctx: RequestContext | undefined,
  headers?: Record<string, string | string[] | undefined>,
): Promise<AttachmentHttpResult> {
  try {
    const session = await resolveBffSession(headers ?? {});
    if (isBffAuthEnforced() && !session.claims) {
      return json(401, { ok: false, data: null, error: { code: 'UNAUTHENTICATED', message: 'Sign in before attaching a file.' } });
    }
    const runtimeCtx = ctx ?? (session.claims
      ? withIdentity(createDefaultRequestContext(), session.claims.email, session.claims.sub)
      : createDefaultRequestContext());
    const path = pathnameOf(url);
    if (method === 'POST' && path === '/attachments') {
      const input = parseUploadBody(body);
      const result = await uploadAttachment(runtimeCtx, input);
      return json(200, { ok: true, data: { record: result.record, localReason: result.localReason || undefined }, error: null });
    }
    const match = ATTACHMENT_PATH.exec(path);
    if (method === 'GET' && match) {
      const id = match[1];
      const tail = match[2] ?? 'url';
      if (tail === 'file') {
        const file = await readLocalAttachmentBytes(runtimeCtx, id);
        return {
          statusCode: 200,
          body: file.body,
          headers: {
            'content-type': file.contentType,
            'content-disposition': `inline; filename="${file.fileName.replace(/"/gu, '')}"`,
            'cache-control': 'no-store',
          },
        };
      }
      const read = await getAttachmentReadUrl(runtimeCtx, id);
      return json(200, { ok: true, data: read, error: null });
    }
    return json(404, { ok: false, data: null, error: { code: 'NOT_FOUND', message: 'Unknown attachment route' } });
  } catch (error) {
    const status = error instanceof AppError ? error.statusCode : 500;
    return json(status, {
      ok: false,
      data: null,
      error: {
        code: error instanceof AppError ? error.code : 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'attachment failed',
      },
    });
  }
}

function withIdentity(ctx: RequestContext, email: string | undefined, sub: string | undefined): RequestContext {
  ctx.requestMeta = { ...(ctx.requestMeta ?? {}), userId: email, source: 'http' };
  if (sub) ctx.sessionContext.actorId = sub;
  return ctx;
}

function parseUploadBody(body: unknown): {
  entityType: string; entityId: string; fileName: string; mimeType: string; category?: string | null; base64: string;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('VALIDATION_ERROR', 'JSON body is required', 400);
  }
  const record = body as Record<string, unknown>;
  const entityType = text(record.entityType);
  const entityId = text(record.entityId);
  const fileName = text(record.fileName);
  const mimeType = text(record.mimeType);
  const base64 = text(record.base64);
  if (!entityType || !entityId || !fileName || !mimeType || !base64) {
    throw new AppError('VALIDATION_ERROR', 'entityType, entityId, fileName, mimeType and base64 are required', 400);
  }
  return {
    entityType,
    entityId,
    fileName,
    mimeType,
    category: typeof record.category === 'string' ? record.category : null,
    base64,
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pathnameOf(url: string): string {
  return new URL(url, 'http://runtime.local').pathname;
}

function json(statusCode: number, body: unknown): AttachmentHttpResult {
  return { statusCode, body, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } };
}
