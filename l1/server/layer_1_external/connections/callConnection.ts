import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolveClientProjectId } from '/_102034_/l1/server/layer_1_external/cbe/cbeDesenv.js';
import { createServerMessagesClient } from '/_102034_/l1/server/layer_1_external/collabMessages/client.js';
import { ensureEnvFileLoaded } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { readMessagesIntegration } from '/_102034_/l1/server/layer_1_external/config/messagesIntegration.js';
import { resolveProjectDistPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { connectionCatalogs } from '/_102034_/l1/server/layer_1_external/connections/connectionCatalogs.js';
import { moduleSystemsIndex } from '/_102034_/l1/server/layer_1_external/connections/moduleSystemsIndex.js';
import {
  createProductionExternalSender,
  productionExternalSettings,
  releaseDeclarationOf,
} from '/_102034_/l1/server/layer_1_external/connections/external/productionExternalSender.js';
import type { ExternalRef, ExternalSender } from '/_102034_/l1/server/layer_1_external/connections/external/sendExternal.js';
import {
  externalSystemAdapterFile,
  validateExternalSystemAdapter,
  type ExternalAdapterContext,
  type ExternalSystemAdapter,
  type ExternalSystemDeclaration,
} from '/_102034_/l2/shared/contracts/connections/externalSystem.js';
import { createAssistantContext } from '/_102034_/l1/workflow/assistantRuntime.js';
import { createMessagesWorkflowIdentities } from '/_102034_/l1/workflow/messagesIdentities.js';
import { moduleHeaders, postEnvelope } from '/_102034_/l1/server/layer_1_external/collabMessages/transport.js';
import { msgProxyTarget } from '/_102034_/l1/server/layer_1_external/transport/http/msgProxy.js';
import type {
  ConnectionCatalog,
  ConnectionContext,
  ConnectionErrorCode,
  ConnectionOperation,
  ConnectionResult,
} from '/_102034_/l2/shared/contracts/connections/types.js';

/**
 * `callConnection(connectionId, operationId, input, context, opts?)`: the one way a backend calls another system
 * (the connections contract (conexoes.md) §2). It checks the operation in the catalog, sends it through the one transport
 * to collab-messages (`collabMessages/transport.ts`, shared with the server client), and answers `{ ok, output }` or
 * `{ ok: false, code, message }` with one of the seven codes. The decision is by the `code` of the body, never by the
 * HTTP status; an answer outside the envelope is `unavailable`. One log line per call, never the `input` or the `context`.
 * No module name lives here.
 */
export const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;

export interface CallConnectionOptions {
  /** The same command does not run twice. Only a `command` operation takes it. */
  idempotencyKey?: string;
  /** The version the caller read; a stale one comes back as `conflict`. */
  expectVersion?: string | number;
  /**
   * The `requestId` of the request the backend is serving (`RequestContext.requestMeta.requestId`, the same one the monitor
   * execution log keeps). It only ties the call record to that request: it is never put in the body that goes to the cm.
   */
  requestId?: string;
}

/** The context of a call out of the app: the connector fills `organizationId` (the organization of the app), so the caller may leave it out. */
export type CallConnectionContext = Omit<ConnectionContext, 'organizationId'> & { organizationId?: string };

export type CallConnection = (
  connectionId: string,
  operationId: string,
  input: unknown,
  context: CallConnectionContext,
  opts?: CallConnectionOptions,
) => Promise<ConnectionResult>;

export interface ConnectionRequest {
  connectionId: string;
  operation: ConnectionOperation;
  input: unknown;
  context: ConnectionContext;
  opts: CallConnectionOptions;
  timeoutMs: number;
}

/** Sends one request to the system behind a connection and returns the body of its answer (anything else throws). */
export type ConnectionTransport = (request: ConnectionRequest) => Promise<Record<string, unknown>>;

export interface ConnectionCallerDeps {
  /** The catalog of a connection, or `undefined` when there is none. A catalog that cannot be read throws. */
  catalogOf(connectionId: string): Promise<ConnectionCatalog | undefined>;
  /** One transport per connection that has `call` operations. */
  transports: Readonly<Record<string, ConnectionTransport>>;
  /** One line per call. Default: `console.info`. */
  log?: (line: string) => void;
  now?: () => number;
  defaultTimeoutMs?: number;
  /**
   * The id in the cm of a person known by the mdm id, by the link of the login (`toCmUserId` of the workflow identities).
   * Without it a call that carries a person by the mdm id is `forbidden`. Throws when the person has no link.
   */
  toCmUserId?: (mdmId: string) => Promise<string>;
  /** The organization of the app, to fill `context.organizationId` when the caller leaves it out. `undefined`: none is configured. */
  organizationId?: () => string | undefined;
  /**
   * The app this caller serves. When `catalogOf` has no catalog, a system declared by a module of this project is
   * dispatched to that module's adapter. Absent: only the platform catalogs (tests of the cm).
   */
  projectId?: string;
  /** Systems declared by modules of the active release. Default: `moduleSystemsIndex`. */
  moduleSystemsOf?: (projectId: string) => Promise<ReadonlyMap<string, string>>;
  /** The declaration shipped for one system. Default: the file in the active release. */
  declarationOf?: (ref: ExternalRef) => Promise<ExternalSystemDeclaration | null>;
  /** `sendExternal` bound by the caller to the module that declared the system. Default: the production door. */
  sender?: ExternalSender;
  /**
   * The stored value of a non-secret setting of a system (`ctx.setting` of its adapter). Default: the store the monitor
   * writes and the sender reads in production. It never returns a secret.
   */
  settingOf?: (ref: ExternalRef, settingId: string) => Promise<string | undefined>;
}

const CODES: Record<ConnectionErrorCode, true> = {
  not_found: true,
  disabled: true,
  unavailable: true,
  conflict: true,
  refused: true,
  forbidden: true,
  invalid: true,
};

function isCode(value: unknown): value is ConnectionErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CODES, value);
}

const PLAIN_ID = /^[a-z][A-Za-z0-9]*$/u;
const adapters = new Map<string, Promise<ExternalSystemAdapter | null>>();

function isConnectionResult(value: unknown): value is ConnectionResult {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as { ok?: unknown; output?: unknown; code?: unknown; message?: unknown };
  if (body.ok === true) return Object.prototype.hasOwnProperty.call(body, 'output');
  return body.ok === false && isCode(body.code) && typeof body.message === 'string';
}

/** The catalog `callConnection` already checks: only the `call` operations, plus `serve` so a call of one is `forbidden`. */
function catalogOfDeclaration(declaration: ExternalSystemDeclaration): ConnectionCatalog {
  const operations: ConnectionOperation[] = [];
  for (const operation of declaration.operations) {
    operations.push({
      operationId: operation.operationId,
      direction: operation.direction,
      kind: operation.kind,
      description: operation.description,
      inputType: operation.inputType,
      outputType: operation.outputType,
      reply: 'now',
      ...(operation.timeoutMs !== undefined ? { timeoutMs: operation.timeoutMs } : {}),
    });
  }
  return {
    schemaVersion: 'connection-catalog-v1',
    connectionId: declaration.systemId,
    title: declaration.title,
    description: declaration.description,
    operations,
  };
}

/** The adapter file of the active release, validated against the declaration. Cached for this process. */
function releaseAdapterOf(projectId: string, moduleId: string, systemId: string, declaration: ExternalSystemDeclaration): Promise<ExternalSystemAdapter | null> {
  if (declaration.systemId !== systemId) {
    console.warn(`[external] adapter refused: declaration is ${declaration.systemId}, asked ${systemId}`);
    return Promise.resolve(null);
  }
  if (!/^\d+$/u.test(projectId) || !PLAIN_ID.test(moduleId) || !PLAIN_ID.test(systemId)) {
    console.warn(`[external] adapter refused: ref is not made of plain ids (${systemId.slice(0, 40)})`);
    return Promise.resolve(null);
  }
  const key = `${projectId}\0${moduleId}\0${systemId}`;
  const cached = adapters.get(key);
  if (cached) return cached;
  const loading = loadAdapter(projectId, moduleId, systemId, declaration);
  adapters.set(key, loading);
  return loading;
}

async function loadAdapter(projectId: string, moduleId: string, systemId: string, declaration: ExternalSystemDeclaration): Promise<ExternalSystemAdapter | null> {
  const relative = externalSystemAdapterFile(moduleId, systemId).replace(/\.ts$/u, '.js');
  const filePath = resolveProjectDistPath(`_${projectId}_/${relative}`);
  if (!existsSync(filePath)) {
    console.warn(`[external] adapter missing ${systemId}`);
    return null;
  }
  let loaded: unknown;
  try {
    const imported = await import(pathToFileURL(filePath).href) as { default?: unknown };
    loaded = imported.default;
  } catch (error) {
    const name = error instanceof Error ? error.name : 'error';
    console.warn(`[external] adapter unreadable ${systemId}: ${name}`);
    return null;
  }
  const problems = validateExternalSystemAdapter(declaration, loaded);
  if (problems.length > 0) {
    console.warn(`[external] adapter invalid ${systemId}: ${problems.map((item) => item.message).join('; ')}`);
    return null;
  }
  return loaded as ExternalSystemAdapter;
}

/** The cm: one action, `connectionCall`, as the app (`x-app-id` and the project token), never as a person (the person is in `context`). */
export function createCmTransport(options: { projectId: string; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch }): ConnectionTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (options.env === undefined) ensureEnvFileLoaded();
  const source = options.env ?? process.env;
  const target = msgProxyTarget({ MSG_PROXY_TARGET: source.MSG_PROXY_TARGET });
  return async (request) => {
    const body: Record<string, unknown> = {
      action: 'connectionCall',
      connectionId: request.connectionId,
      operationId: request.operation.operationId,
      input: request.input,
      context: request.context,
    };
    if (request.operation.kind === 'command' && request.opts.idempotencyKey !== undefined) body.idempotencyKey = request.opts.idempotencyKey;
    if (request.opts.expectVersion !== undefined) body.expectVersion = request.opts.expectVersion;
    const response = await postEnvelope({
      fetchImpl,
      url: `${target}/msg`,
      headers: moduleHeaders(options.projectId, options.projectId),
      body: JSON.stringify(body),
      timeoutMs: request.timeoutMs,
      label: `connectionCall ${request.connectionId}.${request.operation.operationId}`,
    });
    return response.body;
  };
}

export function createConnectionCaller(deps: ConnectionCallerDeps): CallConnection {
  const log = deps.log ?? ((line: string): void => console.info(line));
  const now = deps.now ?? Date.now;
  const defaultTimeoutMs = deps.defaultTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS;
  const sender = deps.sender ?? (deps.projectId ? createProductionExternalSender() : undefined);

  return async (connectionId, operationId, input, context, opts = {}) => {
    const started = now();
    const done = (result: ConnectionResult, reason?: string): ConnectionResult => {
      const outcome = result.ok ? 'ok=true' : `ok=false code=${result.code}`;
      log(`[connection] ${connectionId}.${operationId} ${outcome}${reason ? ` reason=${reason}` : ''} ms=${now() - started}`);
      return result;
    };
    const fail = (code: ConnectionErrorCode, message: string, reason?: string): ConnectionResult => done({ ok: false, code, message }, reason);

    if (typeof connectionId !== 'string' || connectionId === '' || typeof operationId !== 'string' || operationId === '') {
      return fail('invalid', 'connectionId and operationId are required', 'ids');
    }
    if (context === null || typeof context !== 'object') return fail('invalid', 'context is required', 'context');
    const organizationId = typeof context.organizationId === 'string' && context.organizationId !== '' ? context.organizationId : deps.organizationId?.();
    if (typeof organizationId !== 'string' || organizationId === '') {
      return fail('invalid', 'context.organizationId is missing and the app has no organization configured', 'organization');
    }

    let catalog: ConnectionCatalog | undefined;
    let moduleId: string | undefined;
    try {
      catalog = await deps.catalogOf(connectionId);
      if (!catalog && deps.projectId) {
        const index = await (deps.moduleSystemsOf ?? moduleSystemsIndex)(deps.projectId);
        moduleId = index.get(connectionId);
        if (moduleId) {
          const ref: ExternalRef = { projectId: deps.projectId, moduleId, systemId: connectionId };
          const declaration = await (deps.declarationOf ?? releaseDeclarationOf)(ref);
          if (!declaration) return fail('unavailable', `the declaration of ${connectionId} cannot be read`, 'declaration');
          catalog = catalogOfDeclaration(declaration);
        }
      }
    } catch (error) {
      return fail('unavailable', `the catalog of the connection ${connectionId} cannot be read`, `catalog-unreadable:${error instanceof Error ? error.name : 'error'}`);
    }
    if (!catalog) return fail('invalid', `unknown connection ${connectionId}`, 'unknown-connection');
    const operation = catalog.operations.find((item) => item.operationId === operationId);
    if (!operation) return fail('invalid', `unknown operation ${connectionId}.${operationId}`, 'unknown-operation');
    if (operation.direction !== 'call') {
      const code: ConnectionErrorCode = moduleId ? 'forbidden' : 'invalid';
      return fail(code, `${connectionId}.${operationId} is not a call operation`, 'direction');
    }
    if (moduleId && deps.projectId) {
      const ref: ExternalRef = { projectId: deps.projectId, moduleId, systemId: connectionId };
      const declaration = await (deps.declarationOf ?? releaseDeclarationOf)(ref);
      if (!declaration) return fail('unavailable', `the declaration of ${connectionId} cannot be read`, 'declaration');
      const adapter = await releaseAdapterOf(deps.projectId, moduleId, connectionId, declaration);
      const call = adapter?.[operationId];
      if (!call) return fail('unavailable', `no adapter for ${connectionId}.${operationId}`, 'no-adapter');
      if (!sender) return fail('unavailable', `no adapter for ${connectionId}.${operationId}`, 'no-adapter');
      // The non-secret settings the declaration names, read before the adapter runs. An empty value counts as missing.
      const settingValues = new Map<string, string>();
      try {
        const settingOf = deps.settingOf ?? ((settingRef, id) => productionExternalSettings().settingOf(settingRef, id));
        for (const item of declaration.settings) {
          if (item.secret) continue;
          const value = await settingOf(ref, item.id);
          if (typeof value === 'string' && value !== '') settingValues.set(item.id, value);
        }
      } catch {
        return fail('unavailable', `the settings of ${connectionId} cannot be read`, 'settings');
      }
      const sentContext: ConnectionContext = { ...context, organizationId };
      const ctx: ExternalAdapterContext = {
        connection: sentContext,
        send: (id, request) => sender.sendExternal(ref, id, request, sentContext, { requestId: opts.requestId }),
        setting: (id) => settingValues.get(id),
      };
      // The platform transport enforces the time itself; an adapter is module code, so the caller enforces it here.
      const limitMs = operation.timeoutMs ?? defaultTimeoutMs;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const ceiling = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })), limitMs);
        });
        const answered = await Promise.race([call(input, ctx), ceiling]);
        if (!isConnectionResult(answered)) return fail('invalid', `${connectionId}.${operationId} answered outside the envelope`, 'outside-envelope');
        return done(answered);
      } catch (error) {
        const name = error instanceof Error ? error.name : 'error';
        return fail('unavailable', `${connectionId}.${operationId} did not answer`, name);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    const transport = deps.transports[connectionId];
    if (!transport) return fail('unavailable', `no transport for the connection ${connectionId}`, 'no-transport');

    // The people travel as the mdm id inside the app; the system outside only knows its own id. No link: nothing is sent.
    const toCm = async (mdmId: string): Promise<string | undefined> => {
      if (!deps.toCmUserId) return undefined;
      try {
        const cmUserId = await deps.toCmUserId(mdmId);
        return typeof cmUserId === 'string' && cmUserId !== '' ? cmUserId : undefined;
      } catch {
        return undefined;
      }
    };
    const { actorMdmId, ...sent } = { ...context, organizationId };
    let sentContext: ConnectionContext = sent;
    if (actorMdmId !== undefined && !context.actorUserId) {
      const actorUserId = await toCm(actorMdmId);
      if (actorUserId === undefined) return fail('forbidden', 'the person has no link with the system outside', 'no-link');
      sentContext = { ...sent, actorUserId };
    }
    let sentInput = input;
    const personInputs = operation.personInputs ?? [];
    if (personInputs.length > 0 && typeof input === 'object' && input !== null && !Array.isArray(input)) {
      const copy: Record<string, unknown> = { ...(input as Record<string, unknown>) };
      for (const { from, to } of personInputs) {
        if (!Object.prototype.hasOwnProperty.call(copy, from)) continue;
        const mdmId = copy[from];
        delete copy[from];
        const cmUserId = typeof mdmId === 'string' && mdmId !== '' ? await toCm(mdmId) : undefined;
        if (cmUserId === undefined) return fail('forbidden', `the person of ${from} has no link with the system outside`, 'no-link');
        copy[to] = cmUserId;
      }
      sentInput = copy;
    }

    let body: Record<string, unknown>;
    try {
      body = await transport({ connectionId, operation, input: sentInput, context: sentContext, opts, timeoutMs: operation.timeoutMs ?? defaultTimeoutMs });
    } catch (error) {
      const code = typeof (error as { code?: unknown } | null)?.code === 'string' ? (error as { code: string }).code : 'error';
      return fail('unavailable', `${connectionId}.${operationId} did not answer`, code);
    }

    if (body.ok === true && Object.prototype.hasOwnProperty.call(body, 'output')) return done({ ok: true, output: body.output });
    if (body.ok === false && isCode(body.code) && typeof body.message === 'string') return fail(body.code, body.message);
    return fail('unavailable', `${connectionId}.${operationId} answered outside the envelope`, 'outside-envelope');
  };
}

export interface ProductionConnectionCallerOptions {
  projectId: string;
  catalogOf?: ConnectionCallerDeps['catalogOf'];
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  toCmUserId?: (mdmId: string) => Promise<string>;
  log?: (line: string) => void;
}

/**
 * The connector of the app: the catalogs the release carries, the transport to the cm as this application, the real link of the
 * login (`toCmUserId` of the workflow identities, run in a context of its own, as the assistant's requests are), and the
 * organization of the app. The organization is the one the app already sends the cm as `x-org-id`
 * (`readMessagesIntegration(projectId).organizationId`, the `org.orgId` of the project file): it is what the cm reads on a call
 * of a module app (`fastifyServer.ts`, `organizationId` of the perfil from `x-org-id`).
 */
export function createProductionConnectionCaller(options: ProductionConnectionCallerOptions): CallConnection {
  const { projectId } = options;
  const identities = options.toCmUserId
    ? undefined
    : createMessagesWorkflowIdentities({ projectId, client: createServerMessagesClient({ projectId }) });
  return createConnectionCaller({
    projectId,
    catalogOf: options.catalogOf ?? connectionCatalogs(),
    transports: { cm: createCmTransport({ projectId, env: options.env, fetchImpl: options.fetchImpl }) },
    toCmUserId: options.toCmUserId ?? ((mdmId) => (identities as NonNullable<typeof identities>).toCmUserId(createAssistantContext(projectId), mdmId)),
    organizationId: () => {
      try {
        return readMessagesIntegration(projectId).organizationId;
      } catch {
        return undefined;
      }
    },
    ...(options.log ? { log: options.log } : {}),
  });
}

let production: { projectId: string; call: CallConnection } | undefined;

/**
 * `callConnection(connectionId, operationId, input, context, opts?)`: the name and the signature of `conexoes.md` §2, with no
 * request context. The connector of the app is built once per process, with the application of this server.
 */
export const callConnection: CallConnection = (connectionId, operationId, input, context, opts) => {
  const projectId = resolveClientProjectId();
  if (!production || production.projectId !== projectId) production = { projectId, call: createProductionConnectionCaller({ projectId }) };
  return production.call(connectionId, operationId, input, context, opts);
};
