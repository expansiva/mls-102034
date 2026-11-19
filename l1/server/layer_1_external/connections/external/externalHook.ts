/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/externalHook.ts" enhancement="_blank"/>
/**
 * Public arrival of a notice from outside.
 * The body stays in memory for the check and the delivery. It is never written.
 */
import { randomUUID } from 'node:crypto';
import type { ConnectionResult } from '/_102034_/l1/server/layer_1_external/connections/catalogs/types.js';
import type { ConnectionServeInput } from '/_102034_/l1/workflow/connectionServe.js';
import type { ExternalCallRow, ExternalNoticeKey } from '/_102034_/l1/server/layer_1_external/connections/external/externalCallStore.js';
import type { ExternalRef } from '/_102034_/l1/server/layer_1_external/connections/external/sendExternal.js';
import type { ExternalNoticeId, ExternalServeOperation, ExternalSystemDeclaration } from '/_102034_/l1/server/layer_1_external/connections/external/types.js';
import { verifyExternalNotice } from '/_102034_/l1/server/layer_1_external/connections/external/verifyNotice.js';

/** Exact public path. No login. */
export const EXTERNAL_HOOK_PATH = '/hook/:projectId/:moduleId/:systemId/:operationId';

export const EXTERNAL_HOOK_MAX_BYTES = 1024 * 1024;
const DELIVER_MS = 5000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;
const ID = /^[a-z][A-Za-z0-9]*$/u;
const PROJECT = /^\d+$/u;

const warnedWithoutNoticeId = new Set<string>();
const rateHits = new Map<string, number[]>();

export interface ExternalHookTarget {
  projectId: string;
  moduleId: string;
  systemId: string;
  operationId: string;
}

export interface ExternalHookDeps {
  declarationOf(ref: ExternalRef): Promise<ExternalSystemDeclaration | null>;
  secretOf(ref: ExternalRef, settingId: string): Promise<string | null>;
  seen(notice: ExternalNoticeKey): Promise<boolean>;
  /** Takes a notice back out of "already received" when its delivery failed. */
  forget(notice: Omit<ExternalNoticeKey, 'arrivedAt'>): Promise<void>;
  /** The organization of the app (the one the cm reads), or undefined when none is configured. */
  organizationOf(projectId: string): string | undefined;
  record(row: ExternalCallRow): Promise<void>;
  deliver(input: ConnectionServeInput): Promise<ConnectionResult>;
  now(): Date;
  allow(key: string, nowMs: number): boolean;
  log(line: string): void;
}

export interface ExternalHookRequest {
  target: ExternalHookTarget;
  rawBody: Buffer;
  headers: Record<string, string>;
  remoteAddress: string;
}

export interface ExternalHookResponse {
  status: number;
  body: { ok: boolean; message?: string };
}

const RATE_MAX_KEYS = 10_000;

export function allowExternalHookRate(key: string, nowMs: number): boolean {
  // The key space is partly chosen by the caller (any plain id is a key), so it is bounded: stale keys go first, and
  // past the cap a new key is refused instead of growing the map.
  if (!rateHits.has(key) && rateHits.size >= RATE_MAX_KEYS) {
    for (const [stale, hits] of rateHits) {
      if (hits.every((at) => nowMs - at >= RATE_WINDOW_MS)) rateHits.delete(stale);
    }
    if (rateHits.size >= RATE_MAX_KEYS) return false;
  }
  const kept = (rateHits.get(key) ?? []).filter((at) => nowMs - at < RATE_WINDOW_MS);
  if (kept.length >= RATE_MAX) {
    rateHits.set(key, kept);
    return false;
  }
  kept.push(nowMs);
  rateHits.set(key, kept);
  return true;
}

function plainIds(target: ExternalHookTarget): boolean {
  return PROJECT.test(target.projectId)
    && ID.test(target.moduleId)
    && ID.test(target.systemId)
    && ID.test(target.operationId);
}

function headerOf(headers: Record<string, string>, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted && headers[key] !== '') return headers[key];
  }
  return undefined;
}

function jsonPointer(rawBody: Buffer, pointer: string): string | undefined {
  if (!pointer.startsWith('/')) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(rawBody.toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
  const parts = pointer.length === 1
    ? []
    : pointer.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  for (const part of parts) {
    if (Array.isArray(value)) {
      if (!/^\d+$/u.test(part)) return undefined;
      value = value[Number(part)];
      continue;
    }
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function noticeKey(noticeId: ExternalNoticeId, rawBody: Buffer, headers: Record<string, string>): string | undefined {
  if ('header' in noticeId) return headerOf(headers, noticeId.header);
  return jsonPointer(rawBody, noticeId.jsonPointer);
}

function inputOf(rawBody: Buffer): unknown {
  if (rawBody.length === 0) return {};
  try {
    return JSON.parse(rawBody.toString('utf8')) as unknown;
  } catch {
    return { bodyBase64: rawBody.toString('base64') };
  }
}

function rowOf(
  target: ExternalHookTarget,
  now: Date,
  outcome: string,
  httpStatus: number,
  bytes: number,
  requestId: string | null,
): ExternalCallRow {
  return {
    id: randomUUID(),
    occurredAt: now.toISOString(),
    direction: 'in',
    projectId: target.projectId,
    moduleId: target.moduleId,
    systemId: target.systemId,
    operationId: target.operationId,
    server: '',
    path: `/hook/${target.projectId}/${target.moduleId}/${target.systemId}/${target.operationId}`,
    outcome,
    denialReason: null,
    httpStatus,
    durationMs: null,
    bytes,
    actorKind: null,
    actorId: `connection:${target.systemId}`,
    requestId,
  };
}

async function answer(
  deps: ExternalHookDeps,
  target: ExternalHookTarget,
  now: Date,
  bytes: number,
  status: number,
  outcome: string,
  message: string | undefined,
  requestId: string | null,
): Promise<ExternalHookResponse> {
  try {
    await deps.record(rowOf(target, now, outcome, status, bytes, requestId));
  } catch (error) {
    const text = error instanceof Error ? error.message : 'record failed';
    deps.log(`[external] hook record failed ${target.systemId}.${target.operationId}: ${text}`);
  }
  return { status, body: message === undefined ? { ok: status >= 200 && status < 300 } : { ok: false, message } };
}

export async function handleExternalHook(request: ExternalHookRequest, deps: ExternalHookDeps): Promise<ExternalHookResponse> {
  const { target, rawBody, headers } = request;
  const now = deps.now();
  if (!plainIds(target)) return { status: 404, body: { ok: false, message: 'not found' } };
  if (rawBody.length > EXTERNAL_HOOK_MAX_BYTES) {
    return answer(deps, target, now, rawBody.length, 413, 'too-large', 'too large', null);
  }
  const rateKey = `${request.remoteAddress}\0${target.projectId}/${target.moduleId}/${target.systemId}/${target.operationId}`;
  if (!deps.allow(rateKey, now.getTime())) {
    return answer(deps, target, now, rawBody.length, 429, 'rate', 'too many requests', null);
  }

  const ref: ExternalRef = { projectId: target.projectId, moduleId: target.moduleId, systemId: target.systemId };
  const declaration = await deps.declarationOf(ref);
  const operation = declaration?.operations.find((item) => item.operationId === target.operationId);
  if (!declaration || !operation || operation.direction !== 'serve') {
    return answer(deps, target, now, rawBody.length, 404, 'not-found', 'not found', null);
  }
  const serve = operation as ExternalServeOperation;
  if (!serve.verify) {
    return answer(deps, target, now, rawBody.length, 401, 'verify', 'unauthorized', null);
  }

  const secret = await deps.secretOf(ref, serve.verify.secret);
  if (secret === null || secret === '') {
    return answer(deps, target, now, rawBody.length, 401, 'verify', 'unauthorized', null);
  }
  const checked = verifyExternalNotice(serve.verify, { rawBody, headers, receivedAt: now }, secret);
  if (!checked.ok) {
    return answer(deps, target, now, rawBody.length, 401, checked.reason, 'unauthorized', null);
  }

  const organizationId = deps.organizationOf(target.projectId);
  if (!organizationId) {
    deps.log(`[external] hook ${target.systemId}.${target.operationId}: the app has no organization configured`);
    return answer(deps, target, now, rawBody.length, 503, 'unavailable', 'unavailable', null);
  }

  let requestId: string | null = null;
  let firstTime: Omit<ExternalNoticeKey, 'arrivedAt'> | null = null;
  if (!serve.noticeId) {
    const warnKey = `${target.projectId}\0${target.systemId}\0${target.operationId}`;
    if (!warnedWithoutNoticeId.has(warnKey)) {
      warnedWithoutNoticeId.add(warnKey);
      deps.log(`[external] ${target.systemId}.${target.operationId} has no noticeId; repeated notices are delivered again`);
    }
  } else {
    const noticeId = noticeKey(serve.noticeId, rawBody, headers);
    if (!noticeId) return answer(deps, target, now, rawBody.length, 401, 'missing', 'unauthorized', null);
    requestId = noticeId;
    const fresh = await deps.seen({
      projectId: target.projectId,
      systemId: target.systemId,
      operationId: target.operationId,
      noticeId,
      arrivedAt: now.toISOString(),
    });
    if (!fresh) return answer(deps, target, now, rawBody.length, 409, 'duplicate', 'already received', noticeId);
    firstTime = { projectId: target.projectId, systemId: target.systemId, operationId: target.operationId, noticeId };
  }

  // A failed delivery must not burn the notice: the sender retries, and the retry has to be delivered.
  const giveBack = async (): Promise<void> => {
    if (!firstTime) return;
    try {
      await deps.forget(firstTime);
    } catch (error) {
      deps.log(`[external] hook could not release the notice ${target.systemId}.${target.operationId}: ${error instanceof Error ? error.name : 'error'}`);
    }
  };

  let delivered: ConnectionResult;
  try {
    delivered = await Promise.race([
      deps.deliver({
        connectionId: target.systemId,
        operationId: target.operationId,
        input: inputOf(rawBody),
        context: { organizationId },
        ...(requestId !== null ? { idempotencyKey: requestId } : {}),
      }),
      new Promise<ConnectionResult>((resolve) => {
        setTimeout(() => resolve({ ok: false, code: 'unavailable', message: 'timeout' }), DELIVER_MS);
      }),
    ]);
  } catch (error) {
    const text = error instanceof Error ? error.name : 'error';
    deps.log(`[external] hook deliver failed ${target.systemId}.${target.operationId}: ${text}`);
    await giveBack();
    return answer(deps, target, now, rawBody.length, 503, 'unavailable', 'unavailable', requestId);
  }
  if (!delivered.ok) {
    await giveBack();
    const outcome = delivered.message === 'timeout' ? 'timeout' : 'unavailable';
    return answer(deps, target, now, rawBody.length, 503, outcome, 'unavailable', requestId);
  }
  return answer(deps, target, now, rawBody.length, 200, 'accepted', undefined, requestId);
}
