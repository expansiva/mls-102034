/// <mls fileReference="_102034_/l2/shared/contracts/connections/externalSystem.ts" enhancement="_blank"/>
/**
 * Declaration of one outside system a generated module may reach.
 * The generated file is `l1/<module>/layer_1_external/connections/<systemId>.ts` (no dot in the name) and default-exports
 * this value; `<systemId>Adapter.ts` beside it default-exports the `ExternalSystemAdapter`. The platform reads them by
 * the L4 systemId, never by scanning the folder.
 * Secrets stay out of that file: settings are ids, and the sender fills them.
 */

import type { ConnectionContext, ConnectionErrorCode, ConnectionResult } from '/_102034_/l2/shared/contracts/connections/types.js';

export type { ConnectionContext, ConnectionErrorCode, ConnectionResult } from '/_102034_/l2/shared/contracts/connections/types.js';

export const EXTERNAL_SYSTEM_SCHEMA = 'external-system-v1' as const;

const LOWER_CAMEL = /^[a-z][A-Za-z0-9]*$/;
const HOST_NAME = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export interface ExternalSettingRef {
  id: string;
  secret: boolean;
  /**
   * Only with `secret: true`. The platform makes the value (32 random bytes, base64url) the first time it is needed and keeps it; nobody types it.
   * A value already stored by hand stays as it is. The inbound hook never generates: it reads what the outbound call made.
   */
  generated?: true;
  /** Text for the configuration page. Optional; when present, not empty. */
  title?: string;
  description?: string;
}

export type ExternalHost = { host: string } | { fromSetting: string };

export interface ExternalCallUses {
  settings: string[];
  secrets: string[];
  /**
   * Fields of the operation input whose value is a secret of the module (a credential kept per record).
   * Their values never appear in a record, an error, a log or the output; they are hidden like the secrets of the settings.
   */
  inputSecrets?: string[];
}

/** One piece of what an HMAC signs: the raw body, a request header value, or a fixed text. */
export type ExternalSignedPart = 'body' | { header: string } | { literal: string };

/**
 * How a `serve` operation proves a message came from the outside system. A union discriminated by `scheme`,
 * open to new members: the platform names no service, the declaration describes how to check one.
 * The check primitive arrives with the inbound path.
 */
export interface ExternalVerifyHmac {
  scheme: 'hmac';
  algorithm: 'sha256' | 'sha512';
  /** Setting id. The setting is a secret. */
  secret: string;
  signature: { header: string; prefix?: string; encoding: 'hex' | 'base64' };
  /** The pieces that are signed, in order, joined by `separator` (default: nothing). */
  signed: ExternalSignedPart[];
  separator?: string;
  timestamp?: { header: string; toleranceSeconds: number };
}

/** A fixed token in a header, compared with the secret in constant time. */
export interface ExternalVerifyToken {
  scheme: 'token';
  /** Setting id. The setting is a secret. */
  secret: string;
  header: string;
  prefix?: string;
}

export type ExternalVerify = ExternalVerifyHmac | ExternalVerifyToken;

export const EXTERNAL_VERIFY_SCHEMES = ['hmac', 'token'] as const;

interface ExternalOperationBase {
  operationId: string;
  kind: 'query' | 'command';
  description: string;
  /** Name of a type exported in the same file. */
  inputType: string;
  /** Name of a type exported in the same file. */
  outputType: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface ExternalCallOperation extends ExternalOperationBase {
  direction: 'call';
  methods: string[];
  uses: ExternalCallUses;
  reply: 'now';
}

/** Where the identifier of a notice is read from, so the same notice is not delivered twice. */
export type ExternalNoticeId = { header: string } | { jsonPointer: string };

export interface ExternalServeOperation extends ExternalOperationBase {
  direction: 'serve';
  verify?: ExternalVerify;
  /** Without it the platform cannot tell a repeated notice and does not deduplicate. */
  noticeId?: ExternalNoticeId;
}

export type ExternalOperation = ExternalCallOperation | ExternalServeOperation;

export interface ExternalSystemDeclaration {
  schemaVersion: typeof EXTERNAL_SYSTEM_SCHEMA;
  /** lowerCamel. This is the connectionId of the L4 `connections[]` row. */
  systemId: string;
  title: string;
  description: string;
  hosts: ExternalHost[];
  settings: ExternalSettingRef[];
  operations: ExternalOperation[];
}

export interface ExternalDeclarationProblem {
  message: string;
}

/** Where generated code puts one declaration. `<module>` and `<systemId>` have no dot. */
export function externalSystemDeclarationFile(moduleName: string, systemId: string): string {
  return `l1/${moduleName}/layer_1_external/connections/${systemId}.ts`;
}

/** Where generated code puts the adapter of that system. */
export function externalSystemAdapterFile(moduleName: string, systemId: string): string {
  return `l1/${moduleName}/layer_1_external/connections/${systemId}Adapter.ts`;
}

/** What a generated adapter asks the platform to send. Header, query and body values may hold `{{secret:<id>}}` or `{{setting:<id>}}`. */
export interface ExternalRequest {
  method: string;
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  /** Text. */
  body?: string;
}

/** What comes back from a 2xx. Never carries a secret. */
export interface ExternalResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * What `send` answers. The same as a `ConnectionResult` of `ExternalResponse`, with one more member on the failure: `response`,
 * the answer of the outside system when it answered with an HTTP status of 400 or more and a body inside the ceiling
 * (secrets hidden as in a success). Only the adapter sees it: `callConnection` takes it out of what the adapter returns.
 */
export type ExternalSendResult =
  | { ok: true; output: ExternalResponse }
  | { ok: false; code: ConnectionErrorCode; message: string; missing?: string[]; response?: ExternalResponse };

export interface ExternalAdapterContext {
  connection: ConnectionContext;
  /** The only way out: sendExternal bound to this project, module and system. */
  send(operationId: string, request: ExternalRequest): Promise<ExternalSendResult>;
  /** A non-secret setting of this system; secrets are never readable here. */
  setting(settingId: string): string | undefined;
  /**
   * The public address, complete, of a `serve` operation of the SAME system (`<origin>/hook/<project>/<module>/<system>/<operation>`),
   * the one a person registers in the outside system (e.g. the `setWebhook` of a bot). `undefined` when the operation does not
   * exist, is not a `serve`, or the app has no public domain (a relative path cannot be registered anywhere).
   */
  hookUrl(operationId: string): string | undefined;
}

/** One function per `call` operation of the declaration, by operationId. `serve` stays a route with `serves`. */
export type ExternalSystemAdapter = Record<string, (input: unknown, ctx: ExternalAdapterContext) => Promise<ConnectionResult<unknown>>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function problem(message: string): ExternalDeclarationProblem {
  return { message };
}

function hostProblems(entry: unknown, index: number): ExternalDeclarationProblem[] {
  if (!isRecord(entry)) return [problem(`hosts[${index}] is not an object`)];
  if (typeof entry.fromSetting === 'string') {
    if ('host' in entry) return [problem(`hosts[${index}] has both host and fromSetting`)];
    if (!LOWER_CAMEL.test(entry.fromSetting)) return [problem(`hosts[${index}].fromSetting is not lowerCamel`)];
    return [];
  }
  if (typeof entry.host !== 'string' || entry.host.length === 0) return [problem(`hosts[${index}].host is missing`)];
  const host = entry.host;
  if (host.includes('*')) return [problem(`hosts[${index}] host has a wildcard`)];
  if (/http:/i.test(host)) return [problem(`hosts[${index}] host uses http`)];
  if (IPV4.test(host) || host.includes(':')) {
    if (IPV4.test(host) || /^[0-9a-fA-F:]+$/.test(host)) return [problem(`hosts[${index}] host is an ip`)];
    return [problem(`hosts[${index}] host has a port`)];
  }
  if (!HOST_NAME.test(host)) return [problem(`hosts[${index}] host is not an exact name`)];
  return [];
}

function settingIndex(settings: ExternalSettingRef[]): Map<string, ExternalSettingRef> {
  const index = new Map<string, ExternalSettingRef>();
  for (const setting of settings) index.set(setting.id, setting);
  return index;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function verifyProblems(verify: unknown, index: number, byId: Map<string, ExternalSettingRef>): ExternalDeclarationProblem[] {
  const where = `operations[${index}] verify`;
  if (!isRecord(verify)) return [problem(`${where} is not an object`)];
  const scheme = verify.scheme;
  if (scheme !== 'hmac' && scheme !== 'token') {
    return [problem(`${where} scheme ${String(scheme)} is unknown (known: ${EXTERNAL_VERIFY_SCHEMES.join(', ')})`)];
  }
  const found: ExternalDeclarationProblem[] = [];
  if (!nonEmptyString(verify.secret)) {
    found.push(problem(`${where} secret is missing`));
  } else {
    const setting = byId.get(verify.secret);
    if (!setting || !setting.secret) found.push(problem(`${where} secret ${verify.secret} is not a secret setting`));
  }
  if (scheme === 'token') {
    if (!nonEmptyString(verify.header)) found.push(problem(`${where} token has no header`));
    if (verify.prefix !== undefined && typeof verify.prefix !== 'string') found.push(problem(`${where} prefix is not text`));
    return found;
  }
  if (verify.algorithm !== 'sha256' && verify.algorithm !== 'sha512') found.push(problem(`${where} hmac algorithm is not sha256 or sha512`));
  const signature = verify.signature;
  if (!isRecord(signature) || !nonEmptyString(signature.header) || (signature.encoding !== 'hex' && signature.encoding !== 'base64')) {
    found.push(problem(`${where} hmac signature needs a header and an encoding (hex or base64)`));
  } else if (signature.prefix !== undefined && typeof signature.prefix !== 'string') {
    found.push(problem(`${where} signature prefix is not text`));
  }
  if (!Array.isArray(verify.signed) || verify.signed.length === 0) {
    found.push(problem(`${where} hmac signs nothing (signed is empty)`));
  } else {
    verify.signed.forEach((part, partIndex) => {
      const ok = part === 'body'
        || (isRecord(part) && Object.keys(part).length === 1 && (nonEmptyString(part.header) || typeof part.literal === 'string'));
      if (!ok) found.push(problem(`${where} signed[${partIndex}] is not body, { header } or { literal }`));
    });
  }
  if (verify.separator !== undefined && typeof verify.separator !== 'string') found.push(problem(`${where} separator is not text`));
  if (verify.timestamp !== undefined) {
    const stamp = verify.timestamp;
    if (!isRecord(stamp) || !nonEmptyString(stamp.header) || typeof stamp.toleranceSeconds !== 'number' || !(stamp.toleranceSeconds > 0)) {
      found.push(problem(`${where} timestamp needs a header and a positive toleranceSeconds`));
    }
  }
  return found;
}

function noticeIdProblems(noticeId: unknown, index: number): ExternalDeclarationProblem[] {
  const where = `operations[${index}] noticeId`;
  if (!isRecord(noticeId)) return [problem(`${where} is not an object`)];
  const keys = Object.keys(noticeId);
  if (keys.length !== 1 || (keys[0] !== 'header' && keys[0] !== 'jsonPointer')) {
    return [problem(`${where} must be { header } or { jsonPointer }`)];
  }
  const value = noticeId[keys[0] as 'header' | 'jsonPointer'];
  if (typeof value !== 'string' || value.length === 0) return [problem(`${where}.${keys[0]} is not a non-empty text`)];
  if (keys[0] === 'jsonPointer' && !value.startsWith('/')) return [problem(`${where}.jsonPointer must start with /`)];
  return [];
}

/**
 * Lists every problem in a declaration. Never throws.
 */
export function validateExternalSystemDeclaration(value: unknown): ExternalDeclarationProblem[] {
  if (!isRecord(value)) return [problem('declaration is not an object')];
  const found: ExternalDeclarationProblem[] = [];
  if (value.schemaVersion !== EXTERNAL_SYSTEM_SCHEMA) found.push(problem('schemaVersion is not external-system-v1'));
  if (typeof value.systemId !== 'string' || !LOWER_CAMEL.test(value.systemId)) found.push(problem('systemId is not lowerCamel'));
  if (typeof value.title !== 'string' || value.title.length === 0) found.push(problem('title is missing'));
  if (typeof value.description !== 'string' || value.description.length === 0) found.push(problem('description is missing'));

  const settings: ExternalSettingRef[] = [];
  if (!Array.isArray(value.settings)) {
    found.push(problem('settings is not a list'));
  } else {
    value.settings.forEach((item, index) => {
      if (!isRecord(item) || typeof item.id !== 'string' || !LOWER_CAMEL.test(item.id) || typeof item.secret !== 'boolean') {
        found.push(problem(`settings[${index}] is not { id, secret }`));
        return;
      }
      for (const field of ['title', 'description'] as const) {
        const text = item[field];
        if (text !== undefined && (typeof text !== 'string' || text.trim().length === 0)) {
          found.push(problem(`settings[${index}].${field} is present but not a non-empty text`));
        }
      }
      if (item.generated !== undefined && item.generated !== true) {
        found.push(problem(`settings[${index}].generated is present but not true`));
      } else if (item.generated === true && item.secret !== true) {
        found.push(problem(`settings[${index}].generated is only valid with secret: true`));
      }
      settings.push({ id: item.id, secret: item.secret, ...(item.generated === true ? { generated: true as const } : {}) });
    });
  }
  const byId = settingIndex(settings);

  if (!Array.isArray(value.hosts)) {
    found.push(problem('hosts is not a list'));
  } else {
    value.hosts.forEach((item, index) => {
      found.push(...hostProblems(item, index));
      if (isRecord(item) && typeof item.fromSetting === 'string' && !byId.has(item.fromSetting)) {
        found.push(problem(`hosts[${index}] fromSetting ${item.fromSetting} is not in settings`));
      }
    });
  }

  if (!Array.isArray(value.operations)) {
    found.push(problem('operations is not a list'));
    return found;
  }

  const seen = new Set<string>();
  value.operations.forEach((item, index) => {
    if (!isRecord(item) || typeof item.operationId !== 'string') {
      found.push(problem(`operations[${index}] is not an object`));
      return;
    }
    if (!LOWER_CAMEL.test(item.operationId)) found.push(problem(`operations[${index}].operationId is not lowerCamel`));
    if (seen.has(item.operationId)) found.push(problem(`operations[${index}] operation ${item.operationId} is repeated`));
    seen.add(item.operationId);
    if (item.direction === 'call') {
      if (!Array.isArray(item.methods) || item.methods.length === 0 || item.methods.some((method) => typeof method !== 'string' || method.length === 0)) {
        found.push(problem(`operations[${index}] call has no methods`));
      }
      const uses = item.uses;
      if (!isRecord(uses) || !Array.isArray(uses.settings) || !Array.isArray(uses.secrets)) {
        found.push(problem(`operations[${index}] call uses is missing`));
      } else {
        for (const id of uses.settings) {
          if (typeof id !== 'string' || !byId.has(id)) found.push(problem(`operations[${index}] uses unknown setting ${String(id)}`));
        }
        for (const id of uses.secrets) {
          const setting = typeof id === 'string' ? byId.get(id) : undefined;
          if (!setting) found.push(problem(`operations[${index}] uses unknown setting ${String(id)}`));
          else if (!setting.secret) found.push(problem(`operations[${index}] uses secret ${id} but the setting is not secret`));
        }
        if (uses.inputSecrets !== undefined) found.push(...inputSecretsProblems(uses.inputSecrets, index));
      }
      if (item.reply !== 'now') found.push(problem(`operations[${index}] call reply is not now`));
    } else if (item.direction === 'serve') {
      if (item.verify !== undefined) found.push(...verifyProblems(item.verify, index, byId));
      if (item.noticeId !== undefined) found.push(...noticeIdProblems(item.noticeId, index));
    } else {
      found.push(problem(`operations[${index}] direction is not call or serve`));
    }
  });
  return found;
}

const INPUT_SECRET_FIELD = /^[a-z][A-Za-z0-9]*$/;

function inputSecretsProblems(value: unknown, index: number): ExternalDeclarationProblem[] {
  if (!Array.isArray(value)) return [problem(`operations[${index}] inputSecrets is not a list`)];
  const found: ExternalDeclarationProblem[] = [];
  const seen = new Set<string>();
  for (const field of value) {
    if (typeof field !== 'string' || !INPUT_SECRET_FIELD.test(field)) {
      found.push(problem(`operations[${index}] inputSecrets item ${String(field)} is not a top-level field name`));
    } else if (seen.has(field)) {
      found.push(problem(`operations[${index}] inputSecrets item ${field} is repeated`));
    }
    if (typeof field === 'string') seen.add(field);
  }
  return found;
}

/**
 * The adapter must have one function for each `call` of the declaration and no other key.
 * Never throws; a declaration with problems of its own is judged by `validateExternalSystemDeclaration`.
 */
export function validateExternalSystemAdapter(declaration: ExternalSystemDeclaration, adapter: unknown): ExternalDeclarationProblem[] {
  if (!isRecord(adapter)) return [problem('adapter is not an object')];
  const found: ExternalDeclarationProblem[] = [];
  const calls = new Set<string>();
  for (const operation of Array.isArray(declaration?.operations) ? declaration.operations : []) {
    if (operation?.direction === 'call') calls.add(operation.operationId);
  }
  for (const id of calls) {
    if (typeof adapter[id] !== 'function') found.push(problem(`adapter has no function for call ${id}`));
  }
  for (const key of Object.keys(adapter)) {
    if (!calls.has(key)) found.push(problem(`adapter has ${key}, which is not a call of ${declaration?.systemId ?? 'the declaration'}`));
    else if (typeof adapter[key] !== 'function') found.push(problem(`adapter.${key} is not a function`));
  }
  return found;
}
