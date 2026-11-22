import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { AssistantCatalog, AssistantCatalogSource } from '/_102034_/l1/workflow/assistantCatalog.js';
import type { ConnectionServeInput } from '/_102034_/l1/workflow/connectionServe.js';
import type { ConnectionResult } from '/_102034_/l2/shared/contracts/connections/types.js';
import type { PlatformCatalogAction, PlatformModuleCatalog } from '/_102034_/l2/shared/contracts/connections/platform.js';

/**
 * The catalog of actions of every module of the release, delivered ONCE per change to the module that serves
 * `platform.releaseCatalogChanged` (the connection of the platform). It runs at boot, after the catalogs are warm; it
 * calls the serve dispatch from inside (no HTTP) and never makes the boot wait or fail. No module name lives here.
 */
export const RELEASE_CATALOG_CONNECTION = 'platform';
export const RELEASE_CATALOG_OPERATION = 'releaseCatalogChanged';
const KEY_PREFIX = 'release-catalog:';
/** The start of the message `connectionServe` gives when no route of the release carries the mark. */
const NO_ROUTE_MESSAGE = 'no route of this release serves';

export type ReleaseCatalogDelivery = 'delivered' | 'unchanged' | 'no_module' | 'failed' | 'skipped';

export interface ReleaseCatalogDeliveryDeps {
  projectId: string;
  /** Id of the release running now; `null` outside a release (nothing is delivered then). */
  releaseId: () => string | null;
  moduleIds: () => readonly string[];
  catalogs: AssistantCatalogSource;
  /** The serve dispatch of `/exec/connection`. */
  serve: (input: ConnectionServeInput) => Promise<ConnectionResult>;
  /** The organization of the app (the connection context asks for it). */
  organizationId: () => string | undefined;
  kv: {
    get(ctx: RequestContext, params: { key: string }): Promise<{ value?: unknown } | null>;
    put(ctx: RequestContext, params: { key: string; value: Record<string, unknown> }): Promise<unknown>;
  };
  /**
   * Sha256 of the compiled `.js` of the module that serves `platform.releaseCatalogChanged`.
   * `null` when no route of the release serves that operation.
   */
  consumerFingerprint: () => Promise<string | null>;
  newContext: () => RequestContext;
  /**
   * Runs `run` while holding the lock `name`, shared by every process of the app (they split one database): read the key,
   * serve and keep the key are one step, so the second process of a cluster finds the key the first one kept.
   */
  withLock: <T>(name: string, run: () => Promise<T>) => Promise<T>;
  log?:{ info: (message: string) => void; error: (message: string) => void };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

const ACTION_TEXT_FIELDS = ['route', 'module', 'actionId', 'title', 'subject'] as const;
const OPTIONAL_TEXT_FIELDS = ['purpose', 'subjectTitle', 'moduleTitle'] as const;
const INPUT_TEXT_FIELDS = ['path', 'label', 'description', 'wireType', 'valueType', 'ref'] as const;
const INPUT_ROLES = new Set(['value', 'ref', 'version']);

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function projectInput(value: unknown): PlatformCatalogAction['inputs'][number] | undefined {
  if (!isRecord(value)) return undefined;
  if (!INPUT_TEXT_FIELDS.every((field) => isText(value[field]))) return undefined;
  if (typeof value.required !== 'boolean' || !isText(value.role) || !INPUT_ROLES.has(value.role)) return undefined;
  if (!Array.isArray(value.enumValues) || !value.enumValues.every((entry) => isRecord(entry) && isText(entry.value) && isText(entry.label))) return undefined;
  return {
    path: value.path as string,
    label: value.label as string,
    description: value.description as string,
    wireType: value.wireType as string,
    valueType: value.valueType as string,
    enumValues: (value.enumValues as Array<{ value: string; label: string }>).map((entry) => ({ value: entry.value, label: entry.label })),
    required: value.required,
    role: value.role as 'value' | 'ref' | 'version',
    ref: value.ref as string,
  };
}

/** One action as the published contract has it, field by field; `undefined` when a required field of the contract is missing. */
function projectAction(value: unknown): PlatformCatalogAction | undefined {
  if (!isRecord(value)) return undefined;
  if (!ACTION_TEXT_FIELDS.every((field) => isText(value[field]) && (value[field] as string) !== '')) return undefined;
  if (value.kind !== 'cmd' && value.kind !== 'qry') return undefined;
  if (value.assistant !== 'included' && value.assistant !== 'excluded') return undefined;
  if (!isText(value.risk)) return undefined;
  if (!Array.isArray(value.routes) || !value.routes.every(isText)) return undefined;
  if (!Array.isArray(value.actors) || !value.actors.every(isText)) return undefined;
  if (!Array.isArray(value.inputs)) return undefined;
  const inputs = value.inputs.map(projectInput);
  if (inputs.some((input) => input === undefined)) return undefined;
  const action: PlatformCatalogAction = {
    route: value.route as string,
    routes: [...(value.routes as string[])],
    module: value.module as string,
    kind: value.kind,
    actionId: value.actionId as string,
    title: value.title as string,
    subject: value.subject as string,
    actors: [...(value.actors as string[])],
    assistant: value.assistant,
    risk: value.risk,
    inputs: inputs as PlatformCatalogAction['inputs'],
  };
  for (const field of OPTIONAL_TEXT_FIELDS) {
    if (isText(value[field])) action[field] = value[field] as string;
  }
  const page = value.page;
  if (isRecord(page) && isText(page.address)) {
    action.page = { address: page.address, ...(isText(page.recordParam) ? { recordParam: page.recordParam } : {}) };
  }
  return action;
}

/**
 * The catalog of a module in the shape the published contract has (`PlatformModuleCatalog`), field by field: what the
 * builder carries beyond it (`lookups`, `entities`, any future field) never reaches the module that serves the
 * connection, which refuses a field it does not know. An action that lacks a required field of the contract is left out
 * and named in `issues`; nothing is invented.
 */
export function projectCatalog(catalog: AssistantCatalog): PlatformModuleCatalog {
  const issues = Array.isArray(catalog.issues) ? (catalog.issues as unknown[]).filter(isText) : [];
  const take = (items: unknown): PlatformCatalogAction[] => (Array.isArray(items) ? items : []).flatMap((item) => {
    const action = projectAction(item);
    if (action) return [action];
    const id = isRecord(item) && isText(item.actionId) ? item.actionId : '?';
    issues.push(`ACTION_NOT_IN_CONTRACT: ${id}`);
    return [];
  });
  const commands = take(catalog.commands);
  const queries = take(catalog.queries);
  return {
    schemaVersion: 'assistant-catalog-v1',
    module: catalog.module,
    ...(isText(catalog.title) ? { title: catalog.title } : {}),
    ...(isText(catalog.description) ? { description: catalog.description } : {}),
    commands,
    queries,
    issues,
  };
}

/** The hash of the catalogs: the same catalogs give the same hash, whatever the order of the keys. */
export function hashCatalogs(catalogs: readonly { module: string }[]): string {
  return createHash('sha256').update(JSON.stringify(stable([...catalogs].sort((a, b) => (a.module < b.module ? -1 : a.module > b.module ? 1 : 0))))).digest('hex');
}

export interface CompiledJsRoot {
  /** Stable id of the compiled module (the folder name under `l1/`). */
  id: string;
  /** Absolute path of `dist/local/_<projectId>_/l1/<moduleId>/`. */
  dir: string;
}

/**
 * Sha256 of the `.js` bytes of the compiled modules. Each file enters as `<id>/<relative path>` plus its bytes,
 * sorted, so the order the directories are read does not change the result. A missing directory is listed in
 * `missing` and left out; it is never an error.
 */
export function fingerprintCompiledJs(roots: readonly CompiledJsRoot[]): { fingerprint: string; missing: string[] } {
  const missing: string[] = [];
  const files: Array<{ key: string; bytes: Buffer }> = [];
  const ordered = [...roots].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const root of ordered) {
    if (!existsSync(root.dir)) {
      missing.push(root.id);
      continue;
    }
    collectJs(root.dir, root.id, files);
  }
  files.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.key);
    hash.update('\0');
    hash.update(file.bytes);
    hash.update('\0');
  }
  return { fingerprint: hash.digest('hex'), missing };
}

function collectJs(dir: string, prefix: string, out: Array<{ key: string; bytes: Buffer }>): void {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const key = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      collectJs(abs, key, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) out.push({ key, bytes: readFileSync(abs) });
  }
}

export async function deliverReleaseCatalog(deps: ReleaseCatalogDeliveryDeps): Promise<ReleaseCatalogDelivery> {
  const log = deps.log ?? console;
  try {
    const releaseId = deps.releaseId();
    if (releaseId === null) return 'skipped';
    const organizationId = deps.organizationId();
    if (!organizationId) {
      log.error('[release-catalog] not delivered: the app has no organization configured');
      return 'skipped';
    }

    const loaded = await Promise.all(deps.moduleIds().map(async (moduleId) => {
      try {
        return await deps.catalogs.get(moduleId);
      } catch {
        return { ok: false as const, code: 'ASSISTANT_CATALOG_UNAVAILABLE' };
      }
    }));
    const catalogs = loaded.flatMap((entry) => (entry.ok ? [projectCatalog(entry.catalog)] : []));
    if (catalogs.length === 0) {
      log.info('[release-catalog] nothing to deliver: no module has a catalog');
      return 'skipped';
    }
    const hash = hashCatalogs(catalogs);
    const fingerprint = await deps.consumerFingerprint();
    if (fingerprint === null) {
      log.info(`[release-catalog] no module serves ${RELEASE_CATALOG_CONNECTION}.${RELEASE_CATALOG_OPERATION}: nothing delivered`);
      return 'no_module';
    }

    const ctx = deps.newContext();
    const key = `${KEY_PREFIX}${deps.projectId}`;
    // Check and act under one lock per project: a cluster of processes boots together and would all read the old key.
    return await deps.withLock(key, async (): Promise<ReleaseCatalogDelivery> => {
      const last = await deps.kv.get(ctx, { key });
      const stored = last?.value !== null && typeof last?.value === 'object' ? (last.value as { hash?: unknown; consumer?: unknown }) : undefined;
      if (stored?.hash === hash && stored.consumer === fingerprint) {
        log.info(`[release-catalog] unchanged (release ${releaseId}): not delivered again`);
        return 'unchanged';
      }

      const result = await deps.serve({
        connectionId: RELEASE_CATALOG_CONNECTION,
        operationId: RELEASE_CATALOG_OPERATION,
        input: { releaseId, hash, catalogs },
        context: { organizationId },
        idempotencyKey: `${releaseId}:${hash}:${fingerprint}`,
      });
      if (!result.ok) {
        // Only the absence of a route is "no module serves it" (the message of connectionServe.ts); any other `not_found`
        // is the module's own answer (a 404 of its route) and a failure, so it is tried again and says why.
        if (result.code === 'not_found' && result.message.startsWith(NO_ROUTE_MESSAGE)) {
          log.info(`[release-catalog] no module serves ${RELEASE_CATALOG_CONNECTION}.${RELEASE_CATALOG_OPERATION}: nothing delivered`);
          return 'no_module';
        }
        log.error(`[release-catalog] not delivered: ${result.code}${result.message ? `: ${result.message.slice(0, 200)}` : ''}`);
        return 'failed';
      }
      // The hash is kept only after the module said ok: a failure is tried again at the next boot.
      await deps.kv.put(ctx, { key, value: { hash, releaseId, consumer: fingerprint, at: new Date().toISOString() } });
      log.info(`[release-catalog] delivered: release ${releaseId}, ${catalogs.length} module(s)`);
      return 'delivered';
    });
  } catch (error) {
    log.error(`[release-catalog] not delivered: ${error instanceof Error ? error.name : 'error'}`);
    return 'failed';
  }
}
