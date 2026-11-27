/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/externalHook.ts" enhancement="_blank"/>
/**
 * Public arrival of a notice from outside.
 * The body stays in memory for the check and the delivery. It is never written.
 */
import { randomUUID } from 'node:crypto';
import type { ConnectionResult } from '/_102034_/l2/shared/contracts/connections/types.js';
import type { ConnectionServeInput } from '/_102034_/l1/workflow/connectionServe.js';
import type { ExternalCallRow, ExternalNoticeKey } from '/_102034_/l1/server/layer_1_external/connections/external/externalCallStore.js';
import type { ExternalRef } from '/_102034_/l1/server/layer_1_external/connections/external/sendExternal.js';
import type { ExternalNoticeId, ExternalServeOperation, ExternalSystemDeclaration } from '/_102034_/l2/shared/contracts/connections/externalSystem.js';
import { verifyExternalNotice } from '/_102034_/l1/server/layer_1_external/connections/external/verifyNotice.js';

/** Exact public path. No login. */
export const EXTERNAL_HOOK_PATH = '/hook/:projectId/:moduleId/:systemId/:operationId';

/**
 * The public address of a `serve` operation of a system: `<origin>/hook/<project>/<module>/<system>/<operation>`. The one place
 * that builds it: the monitor screen and `ctx.hookUrl` of the adapters use it. Without an origin the answer is the path alone.
 */
export function externalHookAddress(origin: string, ref: ExternalRef, operationId: string): string {
  const path = `/hook/${ref.projectId}/${ref.moduleId}/${ref.systemId}/${operationId}`;
  const base = origin.replace(/\/+$/u, '');
  return base ? `${base}${path}` : path;
}

/** The public origin of the app, from its domain (`APP_PROJECT_DOMAIN`); empty when the app has none (a local run). */
export function publicOriginOf(projectDomain: string | undefined): string {
  const domain = projectDomain?.trim() ?? '';
  return domain === '' ? '' : `https://${domain}`;
}

export const EXTERNAL_HOOK_MAX_BYTES = 1024 * 1024;
/**
 * How long the arrival waits for the route of the module: 1 minute (Wagner, 25/11: a slow call to the cm must not turn into an error and a
 * resend). Nothing between the nginx (1900 s) and the route cuts earlier: Fastify runs with `requestTimeout` and `handlerTimeout` 0 (no
 * limit, `startServer.ts:630`).
 */
export const DELIVER_MS = 60_000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;
const ID = /^[a-z][A-Za-z0-9]*$/u;
const PROJECT = /^\d+$/u;
/** Name and value of the one query parameter an address may carry. */
const HOOK_PARAM = /^[A-Za-z0-9_-]{1,64}$/u;

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
  /** `projectId` is the project whose declaration was just read (never the organization). */
  deliver(input: ConnectionServeInput, projectId: string): Promise<ConnectionResult>;
  now(): Date;
  allow(key: string, nowMs: number): boolean;
  log(line: string): void;
}

export interface ExternalHookRequest {
  target: ExternalHookTarget;
  rawBody: Buffer;
  headers: Record<string, string>;
  remoteAddress: string;
  /** The query of the address, as the transport read it; at most one parameter, with a plain name and a plain text value. */
  query?: Record<string, unknown>;
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

/** The one allowed query parameter: `{}` when there is none, `null` when the query is not acceptable (more than one, or not plain). */
function hookParamsOf(query: Record<string, unknown> | undefined): Record<string, string> | null {
  const entries = Object.entries(query ?? {});
  if (entries.length === 0) return {};
  if (entries.length > 1) return null;
  const [name, value] = entries[0];
  if (typeof value !== 'string' || !HOOK_PARAM.test(name) || !HOOK_PARAM.test(value)) return null;
  return { [name]: value };
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
  // The Telegram names each notice by `update_id`, a number: a safe integer becomes its text. Anything else that is not a
  // plain non-empty text (a fraction, a boolean, an object, null) is still "no identifier".
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
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
  denialReason: string | null = null,
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
    denialReason,
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
  denialReason: string | null = null,
): Promise<ExternalHookResponse> {
  try {
    await deps.record(rowOf(target, now, outcome, status, bytes, requestId, denialReason));
  } catch (error) {
    const text = error instanceof Error ? error.message : 'record failed';
    deps.log(`[external] hook record failed ${target.systemId}.${target.operationId}: ${text}`);
  }
  return { status, body: message === undefined ? { ok: status >= 200 && status < 300 } : { ok: false, message } };
}

/** What a module answers when the notice is understood and refused: not worth a retry. `invalid` is not here: a notice the module cannot read may be read after a fix. */
const REFUSED_CODES: ReadonlySet<string> = new Set(['not_found', 'refused', 'forbidden']);

export async function handleExternalHook(request: ExternalHookRequest, deps: ExternalHookDeps): Promise<ExternalHookResponse> {
  const { target, rawBody, headers } = request;
  const now = deps.now();
  if (!plainIds(target)) return { status: 404, body: { ok: false, message: 'not found' } };
  if (rawBody.length > EXTERNAL_HOOK_MAX_BYTES) {
    return answer(deps, target, now, rawBody.length, 413, 'too-large', 'too large', null);
  }
  const hookParams = hookParamsOf(request.query);
  if (hookParams === null) return answer(deps, target, now, rawBody.length, 400, 'invalid', 'invalid', null);
  const [paramName] = Object.keys(hookParams);
  // The parameter tells the senders of one address apart (one bot each): it is part of the repeat key and of the rate key.
  const paramKey = paramName === undefined ? '' : `${paramName}=${hookParams[paramName]}`;
  const rateKey = `${request.remoteAddress}\0${target.projectId}/${target.moduleId}/${target.systemId}/${target.operationId}${paramKey === '' ? '' : `\0${paramKey}`}`;
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
    const sent = noticeKey(serve.noticeId, rawBody, headers);
    if (!sent) return answer(deps, target, now, rawBody.length, 401, 'missing', 'unauthorized', null);
    const noticeId = paramKey === '' ? sent : `${sent}?${paramKey}`;
    requestId = noticeId;
    const fresh = await deps.seen({
      projectId: target.projectId,
      systemId: target.systemId,
      operationId: target.operationId,
      noticeId,
      arrivedAt: now.toISOString(),
    });
    if (!fresh) {
      // The sender resends everything that is not 2xx (the Telegram does): a notice already handled answers 200, and the record
      // still says `duplicate`, so the monitor tells it from a first delivery.
      const recorded = await answer(deps, target, now, rawBody.length, 200, 'duplicate', undefined, noticeId);
      return { status: recorded.status, body: { ok: true, message: 'already received' } };
    }
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
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    delivered = await Promise.race([
      deps.deliver({
        connectionId: target.systemId,
        operationId: target.operationId,
        targetModuleId: target.moduleId,
        input: inputOf(rawBody),
        context: { organizationId, ...(paramKey === '' ? {} : { hookParams }) },
        ...(requestId !== null ? { idempotencyKey: requestId } : {}),
      }, target.projectId),
      new Promise<ConnectionResult>((resolve) => {
        deadline = setTimeout(() => resolve({ ok: false, code: 'unavailable', message: 'timeout' }), DELIVER_MS);
      }),
    ]);
    clearTimeout(deadline);
  } catch (error) {
    clearTimeout(deadline);
    const text = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : 'error';
    deps.log(`[external] hook deliver failed ${target.systemId}.${target.operationId}: ${text}`);
    await giveBack();
    return answer(deps, target, now, rawBody.length, 503, 'unavailable', 'unavailable', requestId);
  }
  if (!delivered.ok && REFUSED_CODES.has(delivered.code)) {
    // The module said no and a retry would say the same (an unknown bot, a rule, no authority): the notice stays seen and the sender is
    // answered 200, so it stops sending it. The code and the message are the module's own words; never the body of the notice.
    const reason = `${delivered.code}: ${delivered.message}`.replace(/\s+/gu, ' ').slice(0, 200);
    deps.log(`[external] hook ${target.systemId}.${target.operationId} refused by the module code=${delivered.code}`);
    const response = await answer(deps, target, now, rawBody.length, 200, 'refused', undefined, requestId, reason);
    return { status: response.status, body: { ok: true, message: 'refused' } };
  }
  if (!delivered.ok) {
    await giveBack();
    const outcome = delivered.message === 'timeout' ? 'timeout' : 'unavailable';
    return answer(deps, target, now, rawBody.length, 503, outcome, 'unavailable', requestId);
  }
  return answer(deps, target, now, rawBody.length, 200, 'accepted', undefined, requestId);
}
