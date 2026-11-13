/// <mls fileReference="_102034_/l1/workflow/assistantCatalog.ts" enhancement="_blank"/>
import { existsSync } from 'node:fs';
import { resolveProjectDistPath, resolveProjectModuleImportUrl } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  assistantModuleAuthorities,
  assistantPerson,
  type AssistantAccessDeps,
} from '/_102034_/l1/workflow/assistantAccess.js';
import type { AssistantOnBehalfOf } from '/_102034_/l1/workflow/assistantActivities.js';

/**
 * The assistant's `catalog` request: the actions each module of the release offers, and which of them this person
 * may use. The catalog is a file the generator emits per module (`assistantCatalog`); this code reads its fields
 * and never decides what is risky or included. No module name lives here.
 */
export const ASSISTANT_CATALOG_SCHEMA = 'assistant-catalog-v1';

export interface AssistantCatalogItem {
  route: string;
  routes?: string[];
  module?: string;
  kind: 'cmd' | 'qry';
  actionId: string;
  title?: string;
  /** Local actor ids (L4 `actorId`) that may use the action. */
  actors: string[];
  assistant: 'included' | 'excluded';
  risk?: string;
  /** Inputs of the operation; the one with `role: 'version'` is where `expectVersion` goes. */
  inputs?: Array<{ path?: string; role?: string; [field: string]: unknown }>;
  [field: string]: unknown;
}

export interface AssistantCatalog {
  schemaVersion: typeof ASSISTANT_CATALOG_SCHEMA;
  module: string;
  commands: AssistantCatalogItem[];
  queries: AssistantCatalogItem[];
  [field: string]: unknown;
}

export type CatalogLoad = { ok: true; catalog: AssistantCatalog } | { ok: false; code: string };

export interface AssistantCatalogSource {
  get(moduleId: string): Promise<CatalogLoad>;
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validItem(value: unknown): value is AssistantCatalogItem {
  if (value === null || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return isText(item.route)
    && isText(item.actionId)
    && (item.kind === 'cmd' || item.kind === 'qry')
    && Array.isArray(item.actors) && item.actors.every(isText)
    && (item.assistant === 'included' || item.assistant === 'excluded');
}

/** The exported object, checked: version, module, and every item the request code reads. */
export function parseAssistantCatalog(raw: unknown, moduleId: string): CatalogLoad {
  if (raw === null || typeof raw !== 'object') return { ok: false, code: 'ASSISTANT_CATALOG_INVALID' };
  const doc = raw as Record<string, unknown>;
  if (doc.schemaVersion !== ASSISTANT_CATALOG_SCHEMA || doc.module !== moduleId) return { ok: false, code: 'ASSISTANT_CATALOG_INVALID' };
  if (!Array.isArray(doc.commands) || !Array.isArray(doc.queries)) return { ok: false, code: 'ASSISTANT_CATALOG_INVALID' };
  if (![...doc.commands, ...doc.queries].every(validItem)) return { ok: false, code: 'ASSISTANT_CATALOG_INVALID' };
  const actionIds = [...doc.commands, ...doc.queries].map((item) => (item as AssistantCatalogItem).actionId);
  if (new Set(actionIds).size !== actionIds.length) return { ok: false, code: 'ASSISTANT_CATALOG_INVALID' };
  return { ok: true, catalog: doc as unknown as AssistantCatalog };
}

export interface AssistantCatalogSourceOptions {
  projectId: string;
  /** Running release id, or null outside a release (nothing is cached then). */
  releaseId: () => string | null;
  /** The module's `assistantCatalog` export, or `undefined` when the module has no catalog file. */
  importCatalog: (moduleId: string) => Promise<unknown | undefined>;
}

/** Catalogs by module, kept per release in this process: a new release is a new process in the PM2 reload. */
export function createAssistantCatalogSource(options: AssistantCatalogSourceOptions): AssistantCatalogSource {
  let cached: { releaseId: string; byModule: Map<string, Promise<CatalogLoad>> } | undefined;
  async function load(moduleId: string): Promise<CatalogLoad> {
    let raw: unknown;
    try {
      raw = await options.importCatalog(moduleId);
    } catch {
      return { ok: false, code: 'ASSISTANT_CATALOG_INVALID' };
    }
    if (raw === undefined) return { ok: false, code: 'ASSISTANT_CATALOG_MISSING' };
    return parseAssistantCatalog(raw, moduleId);
  }
  return {
    get(moduleId) {
      const releaseId = options.releaseId();
      if (releaseId === null) return load(moduleId);
      if (!cached || cached.releaseId !== releaseId) cached = { releaseId, byModule: new Map() };
      let pending = cached.byModule.get(moduleId);
      if (!pending) {
        pending = load(moduleId);
        cached.byModule.set(moduleId, pending);
      }
      return pending;
    },
  };
}

/** Production importer: the compiled `assistantCatalog` of the module, by the path the generator emits it to. */
export function distAssistantCatalogImporter(projectId: string): (moduleId: string) => Promise<unknown | undefined> {
  return async (moduleId) => {
    const relative = `_${projectId}_/l1/${moduleId}/layer_2_application/assistant/assistantCatalog.js`;
    if (!existsSync(resolveProjectDistPath(relative))) return undefined;
    const mod = (await import(resolveProjectModuleImportUrl(relative))) as { assistantCatalog?: unknown };
    return mod.assistantCatalog;
  };
}

export interface AssistantCatalogDeps extends AssistantAccessDeps {
  catalogs: AssistantCatalogSource;
  /** Id of the release running now. */
  release: () => string;
}

export interface AssistantCatalogInput {
  onBehalfOf: AssistantOnBehalfOf;
  knownRelease?: string;
}

export interface AssistantCatalogResult {
  outcome: 'done' | 'no_person';
  release: string;
  /** Omitted when the cm already holds the catalogs of this release. */
  catalogs?: Array<{ moduleId: string; catalog: AssistantCatalog }>;
  /** `actionId` this person may use: `included` items whose actors cross the person's authorities in the module. */
  allowed: string[];
  partial: Array<{ moduleId: string; code: string }>;
}

/** An action is allowed when it enters the assistant and the person holds one of its actors in that module. */
export function allowedActions(catalog: AssistantCatalog, held: readonly string[]): string[] {
  const allowed: string[] = [];
  for (const item of [...catalog.commands, ...catalog.queries]) {
    if (item.assistant !== 'included') continue;
    if (item.actors.some((actor) => held.includes(`${catalog.module}:${actor}`))) allowed.push(item.actionId);
  }
  return allowed;
}

export async function listAssistantCatalog(
  ctx: RequestContext,
  deps: AssistantCatalogDeps,
  input: AssistantCatalogInput,
): Promise<AssistantCatalogResult> {
  const release = deps.release();
  const person = await assistantPerson(ctx, deps, input.onBehalfOf.cmUserId);
  if (person === null) return { outcome: 'no_person', release, allowed: [], partial: [] };

  const answers = await Promise.all(deps.modules.map(async (entry) => {
    const loaded = await deps.catalogs.get(entry.moduleId);
    if (!loaded.ok) return { moduleId: entry.moduleId, code: loaded.code };
    try {
      const held = await assistantModuleAuthorities(deps, input.onBehalfOf, entry);
      return { moduleId: entry.moduleId, catalog: loaded.catalog, allowed: allowedActions(loaded.catalog, held) };
    } catch {
      return { moduleId: entry.moduleId, code: 'ASSISTANT_MODULE_FAILED' };
    }
  }));

  const catalogs: Array<{ moduleId: string; catalog: AssistantCatalog }> = [];
  const allowed: string[] = [];
  const partial: Array<{ moduleId: string; code: string }> = [];
  for (const answer of answers) {
    if ('code' in answer) {
      partial.push({ moduleId: answer.moduleId, code: answer.code });
      continue;
    }
    catalogs.push({ moduleId: answer.moduleId, catalog: answer.catalog });
    allowed.push(...answer.allowed);
  }
  return {
    outcome: 'done',
    release,
    ...(input.knownRelease === release ? {} : { catalogs }),
    allowed,
    partial,
  };
}
