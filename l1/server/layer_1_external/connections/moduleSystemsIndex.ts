/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/moduleSystemsIndex.ts" enhancement="_blank"/>
/**
 * Which module of the active release declared each outside system.
 * A new release is a new process, so the map is cached for the life of this one.
 */
import { existsSync, readdirSync } from 'node:fs';
import { distDefsReader } from '/_102034_/l1/workflow/assistantCatalogDefs.js';
import { resolveProjectsPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { connectionCatalogs } from '/_102034_/l1/server/layer_1_external/connections/connectionCatalogs.js';
import { externalSystemDeclarationFile } from '/_102034_/l2/shared/contracts/connections/externalSystem.js';

const SAFE_NAME = /^[a-z][A-Za-z0-9]*$/u;
const cache = new Map<string, Promise<Map<string, string>>>();
const catalogOf = connectionCatalogs();

function warn(message: string): void {
  console.warn(`[external] ${message}`);
}

function systemIdsOf(loaded: unknown): string[] {
  if (typeof loaded !== 'object' || loaded === null || Array.isArray(loaded)) return [];
  const list = (loaded as { externalSystems?: unknown }).externalSystems;
  if (!Array.isArray(list)) return [];
  const ids: string[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id === 'string') ids.push(id);
  }
  return ids;
}

/** `systemId` → module that declared it. Problems are logged and left out; a missing defs file is skipped. */
export function moduleSystemsIndex(projectId: string): Promise<Map<string, string>> {
  // The promise is cached, not the map: a second caller that arrives while the first is still reading must wait for the
  // whole index, not see it half built.
  const cached = cache.get(projectId);
  if (cached) return cached;
  const built = buildIndex(projectId);
  cache.set(projectId, built);
  return built;
}

async function buildIndex(projectId: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  if (!/^\d+$/u.test(projectId)) {
    warn('systems index refused: project id is not digits');
    return index;
  }

  const reader = distDefsReader(projectId);
  const l4 = resolveProjectsPath(`dist/local/_${projectId}_/l4`);
  if (!existsSync(l4)) return index;

  let moduleIds: string[];
  try {
    moduleIds = readdirSync(l4, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && SAFE_NAME.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unreadable';
    warn(`systems index unreadable: ${message}`);
    return index;
  }

  const owner = new Map<string, string>();
  const dropped = new Set<string>();

  for (const moduleId of moduleIds) {
    let loaded: unknown;
    try {
      loaded = await reader.read(`l4/${moduleId}/integration.defs.js`, 'default');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unreadable';
      warn(`integration defs unreadable: ${message}`);
      continue;
    }
    if (loaded === undefined) continue;

    for (const systemId of systemIdsOf(loaded)) {
      if (!SAFE_NAME.test(systemId)) {
        warn('system id refused: not a plain id');
        continue;
      }
      if (await catalogOf(systemId) !== undefined) {
        warn(`system id refused: reserved by a platform catalog (${systemId})`);
        dropped.add(systemId);
        continue;
      }
      const relative = externalSystemDeclarationFile(moduleId, systemId).replace(/\.ts$/u, '.js');
      let declaration: unknown;
      try {
        declaration = await reader.read(relative, 'default');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unreadable';
        warn(`declaration unreadable ${systemId}: ${message}`);
        continue;
      }
      if (declaration === undefined) {
        warn(`declaration missing ${systemId}`);
        continue;
      }
      const previous = owner.get(systemId);
      if (previous !== undefined && previous !== moduleId) {
        warn(`system id refused: declared by two modules (${systemId})`);
        dropped.add(systemId);
        continue;
      }
      owner.set(systemId, moduleId);
    }
  }

  for (const [systemId, moduleId] of owner) {
    if (!dropped.has(systemId)) index.set(systemId, moduleId);
  }
  return index;
}
