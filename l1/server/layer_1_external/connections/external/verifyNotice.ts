/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/verifyNotice.ts" enhancement="_blank"/>
/**
 * Checks that a notice from outside was signed with the declaration's secret.
 * Generated route code imports `verifyExternalNotice` from this file.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ExternalSignedPart, ExternalVerify, ExternalVerifyHmac } from '/_102034_/l2/shared/contracts/connections/externalSystem.js';

export interface ExternalNotice {
  rawBody: Buffer;
  headers: Record<string, string>;
  receivedAt: Date;
}

export type VerifyNoticeFailure = 'signature' | 'timestamp' | 'missing';

export type VerifyNoticeResult = { ok: true } | { ok: false; reason: VerifyNoticeFailure };

function headerOf(headers: Record<string, string>, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return headers[key];
  }
  return undefined;
}

function sameBytes(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Header text after `prefix`, or `undefined` when the prefix is required and absent. */
function withoutPrefix(value: string, prefix: string | undefined): string | undefined {
  if (prefix === undefined || prefix === '') return value;
  if (!value.startsWith(prefix)) return undefined;
  return value.slice(prefix.length);
}

function partBytes(part: ExternalSignedPart, notice: ExternalNotice): Buffer | undefined {
  if (part === 'body') return notice.rawBody;
  if ('literal' in part) return Buffer.from(part.literal, 'utf8');
  const value = headerOf(notice.headers, part.header);
  if (value === undefined) return undefined;
  return Buffer.from(value, 'utf8');
}

function signedBytes(verify: ExternalVerifyHmac, notice: ExternalNotice): Buffer | undefined {
  const pieces: Buffer[] = [];
  for (const part of verify.signed) {
    const bytes = partBytes(part, notice);
    if (bytes === undefined) return undefined;
    pieces.push(bytes);
  }
  const separator = Buffer.from(verify.separator ?? '', 'utf8');
  const chunks: Buffer[] = [];
  pieces.forEach((piece, index) => {
    if (index > 0) chunks.push(separator);
    chunks.push(piece);
  });
  return Buffer.concat(chunks);
}

function decodePresented(text: string, encoding: 'hex' | 'base64'): Buffer | undefined {
  if (encoding === 'hex') {
    if (text.length === 0 || text.length % 2 !== 0 || !/^[0-9a-fA-F]+$/u.test(text)) return undefined;
    return Buffer.from(text, 'hex');
  }
  if (text.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(text)) return undefined;
  const decoded = Buffer.from(text, 'base64');
  if (decoded.toString('base64').replace(/=+$/u, '') !== text.replace(/=+$/u, '')) return undefined;
  return decoded;
}

/** Unix seconds in the timestamp header, when that header is part of the declaration. */
function timestampSeconds(verify: ExternalVerifyHmac, notice: ExternalNotice): number | 'missing' | 'timestamp' {
  if (verify.timestamp === undefined) return 0;
  const raw = headerOf(notice.headers, verify.timestamp.header);
  if (raw === undefined || raw === '') return 'missing';
  if (!/^-?\d+$/u.test(raw)) return 'timestamp';
  return Number(raw);
}

export function verifyExternalNotice(verify: ExternalVerify, notice: ExternalNotice, secret: string): VerifyNoticeResult {
  // An empty secret would let anyone sign with an empty key (hmac) or send an empty token. The caller answers `disabled`
  // before it gets here; this keeps the primitive safe on its own.
  if (typeof secret !== 'string' || secret.length === 0) return { ok: false, reason: 'signature' };
  if (verify.scheme === 'token') {
    const raw = headerOf(notice.headers, verify.header);
    if (raw === undefined) return { ok: false, reason: 'missing' };
    const token = withoutPrefix(raw, verify.prefix);
    if (token === undefined) return { ok: false, reason: 'signature' };
    const matches = sameBytes(Buffer.from(token, 'utf8'), Buffer.from(secret, 'utf8'));
    return matches ? { ok: true } : { ok: false, reason: 'signature' };
  }

  const stamped = timestampSeconds(verify, notice);
  if (stamped === 'missing' || stamped === 'timestamp') return { ok: false, reason: stamped };

  const message = signedBytes(verify, notice);
  if (message === undefined) return { ok: false, reason: 'missing' };

  const rawSignature = headerOf(notice.headers, verify.signature.header);
  if (rawSignature === undefined || rawSignature === '') return { ok: false, reason: 'missing' };
  const signatureText = withoutPrefix(rawSignature, verify.signature.prefix);
  if (signatureText === undefined) return { ok: false, reason: 'signature' };
  const presented = decodePresented(signatureText, verify.signature.encoding);
  if (presented === undefined) return { ok: false, reason: 'signature' };

  const digest = createHmac(verify.algorithm, secret).update(message).digest();
  if (!sameBytes(presented, digest)) return { ok: false, reason: 'signature' };

  if (verify.timestamp !== undefined) {
    const delta = Math.abs(notice.receivedAt.getTime() / 1000 - stamped);
    if (delta > verify.timestamp.toleranceSeconds) return { ok: false, reason: 'timestamp' };
  }
  return { ok: true };
}
