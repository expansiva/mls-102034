/// <mls fileReference="_102034_/l1/server/layer_1_external/storage/attachmentLimits.ts" enhancement="_blank" />

import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

export const DEFAULT_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
export const DEFAULT_ATTACHMENT_ALLOWED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
] as const;

export interface AttachmentLimits {
  maxBytes: number;
  allowedMime: readonly string[];
}

export function defaultAttachmentLimits(): AttachmentLimits {
  return { maxBytes: DEFAULT_ATTACHMENT_MAX_BYTES, allowedMime: DEFAULT_ATTACHMENT_ALLOWED_MIME };
}

export function parseAllowedMime(value: string | undefined): string[] {
  if (!value) return [...DEFAULT_ATTACHMENT_ALLOWED_MIME];
  const parsed = value.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
  return parsed.length ? parsed : [...DEFAULT_ATTACHMENT_ALLOWED_MIME];
}

export function validateAttachmentPayload(input: {
  mimeType: string;
  sizeBytes: number;
  limits?: AttachmentLimits;
}): void {
  const limits = input.limits ?? defaultAttachmentLimits();
  const mimeType = input.mimeType.trim().toLowerCase();
  if (!mimeType || !limits.allowedMime.includes(mimeType)) {
    throw new AppError(
      'VALIDATION_ERROR',
      `mimeType '${input.mimeType}' is not allowed (accepted: ${limits.allowedMime.join(', ')})`,
      400,
      { mimeType: input.mimeType, allowedMime: limits.allowedMime },
    );
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new AppError('VALIDATION_ERROR', 'sizeBytes must be a positive number', 400);
  }
  if (input.sizeBytes > limits.maxBytes) {
    throw new AppError(
      'VALIDATION_ERROR',
      `file is ${input.sizeBytes} bytes; maximum is ${limits.maxBytes}`,
      400,
      { sizeBytes: input.sizeBytes, maxBytes: limits.maxBytes },
    );
  }
}

/** Decode the body of a dedicated upload route. `data:` URLs are stripped; raw base64 is accepted. */
export function decodeAttachmentBase64(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) throw new AppError('VALIDATION_ERROR', 'base64 body is required', 400);
  const dataUrl = /^data:([^;]+);base64,(.+)$/u.exec(trimmed);
  const payload = dataUrl ? dataUrl[2] : trimmed;
  if (payload.startsWith('data:')) throw new AppError('VALIDATION_ERROR', 'Invalid base64 image', 400);
  const buffer = Buffer.from(payload, 'base64');
  if (!buffer.length) throw new AppError('VALIDATION_ERROR', 'base64 body is empty', 400);
  return buffer;
}
