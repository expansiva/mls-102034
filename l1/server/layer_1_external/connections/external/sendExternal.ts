/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/sendExternal.ts" enhancement="_blank"/>
/**
 * The only way out to an outside system. The caller names a system and an operation;
 * the declaration is loaded for the active release and everything it does not list is refused.
 * A secret is cited as `{{secret:<id>}}` and filled here. It never comes back in a log, a record, an error or the output.
 */

import type { ConnectionContext, ConnectionResult } from '/_102034_/l1/server/layer_1_external/connections/catalogs/types.js';
import {
  validateExternalSystemDeclaration,
  type ExternalCallOperation,
  type ExternalRequest,
  type ExternalResponse,
  type ExternalSystemDeclaration,
} from '/_102034_/l1/server/layer_1_external/connections/external/types.js';

export type { ExternalRequest } from '/_102034_/l1/server/layer_1_external/connections/external/types.js';

export const EXTERNAL_DEFAULT_TIMEOUT_MS = 10_000;
export const EXTERNAL_MAX_TIMEOUT_MS = 60_000;
export const EXTERNAL_MAX_REQUEST_BYTES = 1_048_576;
export const EXTERNAL_DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
export const EXTERNAL_MAX_RESPONSE_BYTES = 4_194_304;

const HOST_NAME = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/;
const PLACEHOLDER = /\{\{(secret|setting):([A-Za-z0-9]+)\}\}/g;

export interface ExternalRef {
  projectId: string;
  moduleId: string;
  systemId: string;
}

export type ExternalResponseOutput = ExternalResponse;

export interface ExternalRecordEvent {
  projectId: string;
  moduleId: string;
  systemId: string;
  operationId: string;
  outcome: 'ok' | 'not_found' | 'disabled' | 'unavailable' | 'conflict' | 'refused' | 'forbidden' | 'invalid';
  status?: number;
}

/** What the transport receives. `address` is the IP already checked; connect to that IP and keep the name on the URL. */
export interface ExternalTransportCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxResponseBytes: number;
  address: string;
  redirect: 'manual';
}

export interface ExternalTransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** The body stopped at the ceiling. The bytes past it were not read. */
  truncated?: boolean;
}

export interface ExternalSenderDeps {
  /** The declaration of the module in the active release. Never the caller's copy. */
  declarationOf(ref: ExternalRef): Promise<ExternalSystemDeclaration | null> | ExternalSystemDeclaration | null;
  settingOf(ref: ExternalRef, settingId: string): Promise<string | null> | string | null;
  secretOf(ref: ExternalRef, settingId: string): Promise<string | null> | string | null;
  record(event: ExternalRecordEvent): Promise<void> | void;
  transport(call: ExternalTransportCall): Promise<ExternalTransportResponse>;
  resolveHost(host: string): Promise<string[]>;
}

export interface ExternalSender {
  sendExternal(
    ref: ExternalRef,
    operationId: string,
    request: ExternalRequest,
    context: ConnectionContext,
  ): Promise<ConnectionResult<ExternalResponseOutput>>;
}

type Maybe<T> = Promise<T> | T;

async function read<T>(value: Maybe<T>): Promise<T> {
  return await value;
}

function denied(code: 'not_found' | 'disabled' | 'unavailable' | 'conflict' | 'refused' | 'forbidden' | 'invalid', message: string): ConnectionResult<ExternalResponseOutput> {
  return { ok: false, code, message };
}

function logLine(systemId: string, operationId: string, outcome: string): void {
  console.log(`[external] ${systemId}.${operationId} ${outcome}`);
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function clamp(value: number | undefined, fallback: number, ceiling: number): number {
  const picked = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  return Math.min(picked, ceiling);
}

function isExactHost(host: string): boolean {
  if (!host || host.includes('*') || /https?:/i.test(host) || host.includes(':')) return false;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return false;
  return HOST_NAME.test(host);
}

function ipv4ToParts(text: string): number[] | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return numbers;
}

function ipv4Blocked(parts: number[]): boolean {
  const [a, b, c] = parts;
  if (a === undefined || b === undefined || c === undefined) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function expandIpv6(text: string): number[] | null {
  const lower = text.toLowerCase().split('%')[0] ?? '';
  if (!/^[0-9a-f:]+$/.test(lower) || lower.includes(':::')) return null;
  const halves = lower.split('::');
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (side.length === 0) return [];
    const bits = side.split(':');
    const numbers: number[] = [];
    for (const bit of bits) {
      if (!/^[0-9a-f]{1,4}$/.test(bit)) return null;
      numbers.push(Number.parseInt(bit, 16));
    }
    return numbers;
  };
  const left = parseSide(halves[0] ?? '');
  if (!left) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const right = parseSide(halves[1] ?? '');
  if (!right) return null;
  if (left.length + right.length > 7) return null;
  return [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
}

/** Private, loopback, link-local (including 169.254.169.254) or an address this platform does not send to. */
export function isBlockedAddress(address: string): boolean {
  const trimmed = address.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  const v4 = ipv4ToParts(mapped?.[1] ?? trimmed);
  if (v4) return ipv4Blocked(v4);
  const v6 = expandIpv6(trimmed);
  if (!v6) return true;
  const asV4 = trimmed.toLowerCase().startsWith('::ffff:');
  if (asV4) {
    const last = v6[7] ?? 0;
    const prev = v6[6] ?? 0;
    return ipv4Blocked([(prev >> 8) & 255, prev & 255, (last >> 8) & 255, last & 255]);
  }
  const head = v6[0] ?? 0;
  if (v6.every((part) => part === 0)) return true;
  if (v6.slice(0, 6).every((part) => part === 0)) return true; // ::/96, IPv4-compatible
  if (head === 0x64 && v6[1] === 0xff9b) return true; // 64:ff9b::/96 NAT64: embeds an IPv4
  if (head === 0x2002) return true; // 6to4: embeds an IPv4
  if (head === 0 && v6.slice(0, 7).every((part) => part === 0) && v6[7] === 1) return true;
  if ((head & 0xffc0) === 0xfe80) return true;
  if ((head & 0xfe00) === 0xfc00) return true;
  if ((head & 0xff00) === 0xff00) return true;
  return false;
}

function httpCode(status: number): ConnectionResult<ExternalResponseOutput> | null {
  if (status >= 200 && status < 400) return null;
  if (status === 400 || status === 422) return denied('invalid', `http ${status}`);
  if (status === 401 || status === 403) return denied('refused', `http ${status}`);
  if (status === 404) return denied('not_found', `http ${status}`);
  if (status === 409 || status === 412) return denied('conflict', `http ${status}`);
  if (status === 429 || status >= 500) return denied('unavailable', `http ${status}`);
  return denied('unavailable', `http ${status}`);
}

function timeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String(error.name) : '';
  return name === 'TimeoutError' || name === 'AbortError';
}

function textsOf(request: ExternalRequest): string[] {
  const texts: string[] = [];
  if (request.body !== undefined) texts.push(request.body);
  for (const value of Object.values(request.query ?? {})) texts.push(value);
  for (const [name, value] of Object.entries(request.headers ?? {})) texts.push(name, value);
  return texts;
}

function cited(request: ExternalRequest): { secrets: string[]; settings: string[]; broken: boolean } {
  const secrets = new Set<string>();
  const settings = new Set<string>();
  let broken = false;
  for (const text of textsOf(request)) {
    const seen = text.matchAll(/\{\{([^}]*)\}\}/g);
    for (const match of seen) {
      const inner = match[1] ?? '';
      const parsed = /^(secret|setting):([a-z][A-Za-z0-9]*)$/.exec(inner);
      if (!parsed || !parsed[1] || !parsed[2]) {
        broken = true;
        continue;
      }
      (parsed[1] === 'secret' ? secrets : settings).add(parsed[2]);
    }
  }
  return { secrets: [...secrets], settings: [...settings], broken };
}

function fill(text: string, secrets: Map<string, string>, settings: Map<string, string>): string {
  return text.replace(PLACEHOLDER, (whole, kind: string, id: string) => {
    const table = kind === 'secret' ? secrets : settings;
    return table.get(id) ?? whole;
  });
}

function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length > 0) out = out.split(secret).join('***');
  }
  return out;
}

function callOperation(declaration: ExternalSystemDeclaration, operationId: string): ExternalCallOperation | 'missing' | 'serve' {
  const found = declaration.operations.find((item) => item.operationId === operationId);
  if (!found) return 'missing';
  if (found.direction !== 'call') return 'serve';
  return found;
}

async function allowedHosts(ref: ExternalRef, declaration: ExternalSystemDeclaration, deps: ExternalSenderDeps): Promise<string[] | 'empty'> {
  const hosts: string[] = [];
  for (const entry of declaration.hosts) {
    if ('host' in entry) {
      hosts.push(entry.host);
      continue;
    }
    const value = (await read(deps.settingOf(ref, entry.fromSetting)) ?? '').trim();
    if (!value || !isExactHost(value)) return 'empty';
    hosts.push(value);
  }
  return hosts;
}

function chooseHost(hosts: string[], request: ExternalRequest): string | null {
  const header = request.headers?.host ?? request.headers?.Host;
  if (header !== undefined) return hosts.includes(header) ? header : null;
  return hosts.length === 1 ? hosts[0] ?? null : null;
}

export function createExternalSender(deps: ExternalSenderDeps): ExternalSender {
  async function finish(
    ref: ExternalRef,
    operationId: string,
    outcome: ExternalRecordEvent['outcome'],
    result: ConnectionResult<ExternalResponseOutput>,
    status?: number,
  ): Promise<ConnectionResult<ExternalResponseOutput>> {
    logLine(ref.systemId, operationId, outcome);
    await read(deps.record({
      projectId: ref.projectId,
      moduleId: ref.moduleId,
      systemId: ref.systemId,
      operationId,
      outcome,
      status,
    }));
    return result;
  }

  return {
    async sendExternal(ref, operationId, request, _context) {
      let declaration: ExternalSystemDeclaration | null;
      try {
        declaration = await read(deps.declarationOf(ref));
      } catch (error) {
        console.error('[external] declaration', error instanceof Error ? error.name : 'error');
        return finish(ref, operationId, 'unavailable', denied('unavailable', 'declaration unavailable'));
      }
      if (!declaration || declaration.systemId !== ref.systemId || validateExternalSystemDeclaration(declaration).length > 0) {
        return finish(ref, operationId, 'forbidden', denied('forbidden', 'system is not declared'));
      }
      const operation = callOperation(declaration, operationId);
      if (operation === 'missing' || operation === 'serve') {
        return finish(ref, operationId, 'forbidden', denied('forbidden', operation === 'serve' ? 'serve is not a call' : 'operation is not declared'));
      }
      if (typeof request.method !== 'string' || request.method.length === 0) {
        return finish(ref, operationId, 'forbidden', denied('forbidden', 'method is not declared'));
      }
      const method = request.method.toUpperCase();
      if (!operation.methods.map((item) => item.toUpperCase()).includes(method)) {
        return finish(ref, operationId, 'forbidden', denied('forbidden', 'method is not declared'));
      }
      if (typeof request.path !== 'string' || !request.path.startsWith('/') || request.path.startsWith('//') || request.path.includes('?') || request.path.includes('\\') || /[\u0000-\u0020\u007f#]/.test(request.path)) {
        return finish(ref, operationId, 'forbidden', denied('forbidden', 'path is not a path'));
      }

      const cites = cited(request);
      if (cites.broken) return finish(ref, operationId, 'forbidden', denied('forbidden', 'reference is not declared'));
      const undeclared = [
        ...cites.secrets.filter((id) => !operation.uses.secrets.includes(id)),
        ...cites.settings.filter((id) => !operation.uses.settings.includes(id)),
      ];
      if (undeclared.length > 0) return finish(ref, operationId, 'forbidden', denied('forbidden', 'reference is not declared'));

      const hosts = await allowedHosts(ref, declaration, deps);
      if (hosts === 'empty') return finish(ref, operationId, 'forbidden', denied('forbidden', 'host is not declared'));
      const host = chooseHost(hosts, request);
      if (!host) return finish(ref, operationId, 'forbidden', denied('forbidden', 'host is not declared'));

      const secretValues = new Map<string, string>();
      const settingValues = new Map<string, string>();
      const missing: string[] = [];
      for (const id of cites.secrets) {
        const value = await read(deps.secretOf(ref, id));
        if (!value) missing.push(id);
        else secretValues.set(id, value);
      }
      for (const id of cites.settings) {
        const value = await read(deps.settingOf(ref, id));
        if (!value) missing.push(id);
        else settingValues.set(id, value);
      }
      if (missing.length > 0) {
        const ids = [...missing].sort().join(', ');
        return finish(ref, operationId, 'disabled', denied('disabled', `configuração incompleta: ${ids}`));
      }

      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers ?? {})) {
        if (name.toLowerCase() === 'host') continue;
        headers[fill(name, secretValues, settingValues)] = fill(value, secretValues, settingValues);
      }
      const query = new URLSearchParams();
      for (const [name, value] of Object.entries(request.query ?? {})) query.set(name, fill(value, secretValues, settingValues));
      const body = request.body === undefined ? undefined : fill(request.body, secretValues, settingValues);
      if (body !== undefined && byteLength(body) > EXTERNAL_MAX_REQUEST_BYTES) {
        return finish(ref, operationId, 'invalid', denied('invalid', 'request is above the size ceiling'));
      }

      let addresses: string[];
      try {
        addresses = await deps.resolveHost(host);
      } catch (error) {
        console.error('[external] resolve', error instanceof Error ? error.name : 'error');
        return finish(ref, operationId, 'unavailable', denied('unavailable', 'host did not resolve'));
      }
      const address = addresses[0];
      if (!address || addresses.some((item) => isBlockedAddress(item))) {
        return finish(ref, operationId, 'forbidden', denied('forbidden', 'host address is blocked'));
      }

      const timeoutMs = clamp(operation.timeoutMs, EXTERNAL_DEFAULT_TIMEOUT_MS, EXTERNAL_MAX_TIMEOUT_MS);
      const maxResponseBytes = clamp(operation.maxResponseBytes, EXTERNAL_DEFAULT_MAX_RESPONSE_BYTES, EXTERNAL_MAX_RESPONSE_BYTES);
      const search = query.size > 0 ? `?${query.toString()}` : '';
      const knownSecrets = [...secretValues.values()];
      let response: ExternalTransportResponse;
      try {
        // The transport is told the ceiling, and the ceiling is also enforced here: a transport that ignores it cannot hang the caller.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const ceiling = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })), timeoutMs);
        });
        try {
          response = await Promise.race([
            deps.transport({
              url: `https://${host}${request.path}${search}`,
              method,
              headers,
              body,
              timeoutMs,
              maxResponseBytes,
              address,
              redirect: 'manual',
            }),
            ceiling,
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      } catch (error) {
        console.error('[external] transport', error instanceof Error ? error.name : 'error');
        const message = timeoutError(error) ? 'timed out' : 'network';
        return finish(ref, operationId, 'unavailable', denied('unavailable', message));
      }

      if (response.truncated || byteLength(response.body) > maxResponseBytes) {
        return finish(ref, operationId, 'unavailable', denied('unavailable', 'response is above the size ceiling'), response.status);
      }
      const status = response.status;
      const mapped = httpCode(status);
      if (mapped && !mapped.ok) {
        const message = redact(mapped.message, knownSecrets);
        return finish(ref, operationId, mapped.code, denied(mapped.code, message), status);
      }
      const output: ExternalResponseOutput = {
        status,
        headers: Object.fromEntries(Object.entries(response.headers).map(([name, value]) => [name, redact(value, knownSecrets)])),
        body: redact(response.body, knownSecrets),
      };
      return finish(ref, operationId, 'ok', { ok: true, output }, status);
    },
  };
}
