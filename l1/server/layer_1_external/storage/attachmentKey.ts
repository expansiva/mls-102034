/// <mls fileReference="_102034_/l1/server/layer_1_external/storage/attachmentKey.ts" enhancement="_blank" />

import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

/**
 * S3 / disk key of a BUSINESS attachment.
 *
 * Collab-messages uses `images/tmp/…` + duration `30d` for ephemeral LLM images that a lifecycle
 * rule may delete. A record attachment (the pet photo) is business data: it MUST live under the
 * permanent prefix. If it lands in tmp, the row in `mdm_attachment` points at a dead object.
 *
 * The key is the only thing persisted. A presigned URL is derived at read time and is never stored.
 */
export const PERMANENT_ATTACHMENT_PREFIX = 'attachments';

export function buildPermanentAttachmentKey(input: {
  projectId: string;
  entityType: string;
  entityId: string;
  attachmentId: string;
  fileName: string;
}): string {
  const projectId = sanitizeSegment(input.projectId, 'project');
  const entityType = sanitizeSegment(input.entityType, 'entity');
  const entityId = sanitizeSegment(input.entityId, 'id');
  const attachmentId = sanitizeSegment(input.attachmentId, 'id');
  const fileName = sanitizeFileName(input.fileName);
  const key = `${PERMANENT_ATTACHMENT_PREFIX}/${projectId}/${entityType}/${entityId}/${attachmentId}-${fileName}`;
  assertPermanentAttachmentKey(key);
  return key;
}

export function assertPermanentAttachmentKey(key: string): void {
  const normalized = key.replace(/\\/gu, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) {
    throw new AppError('VALIDATION_ERROR', 'storageKey is not a valid object path', 400, { key });
  }
  if (/(^|\/)tmp(\/|$)/u.test(normalized) || normalized.includes('images/tmp')) {
    throw new AppError(
      'VALIDATION_ERROR',
      'A business attachment cannot use a tmp/ prefix — that path expires; persist under attachments/',
      400,
      { key },
    );
  }
  if (!normalized.startsWith(`${PERMANENT_ATTACHMENT_PREFIX}/`)) {
    throw new AppError(
      'VALIDATION_ERROR',
      `A business attachment key must start with ${PERMANENT_ATTACHMENT_PREFIX}/ (permanent prefix, never tmp)`,
      400,
      { key },
    );
  }
}

function sanitizeSegment(value: string, fallback: string): string {
  const cleaned = value.trim().replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '');
  return cleaned || fallback;
}

function sanitizeFileName(fileName: string): string {
  const base = fileName.trim().split(/[/\\]/u).pop() || 'file';
  return sanitizeSegment(base, 'file');
}
