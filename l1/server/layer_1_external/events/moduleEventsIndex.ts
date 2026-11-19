/// <mls fileReference="_102034_/l1/server/layer_1_external/events/moduleEventsIndex.ts" enhancement="_blank"/>
/**
 * Who of the active release publishes each module event, and who declared they receive it.
 * A new release is a new process, so the maps are cached for the life of this one.
 */
import { existsSync, readdirSync } from 'node:fs';
import { distDefsReader } from '/_102034_/l1/workflow/assistantCatalogDefs.js';
import { resolveProjectsPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import {
  moduleEventRefText,
  type ModuleEventsIndex,
} from '/_102034_/l1/server/layer_1_external/events/types.js';

const SAFE_NAME = /^[a-z][A-Za-z0-9]*$/u;
const cache = new Map<string, Promise<ModuleEventsIndex>>();

function warn(message: string): void {
  console.warn(`[events] ${message}`);
}

function rec(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function itemsOf(loaded: unknown, field: 'inbound' | 'outbound'): Record<string, unknown>[] {
  const root = rec(loaded);
  if (root === undefined) return [];
  const list = root[field];
  if (!Array.isArray(list)) return [];
  const items: Record<string, unknown>[] = [];
  for (const item of list) {
    const row = rec(item);
    if (row !== undefined) items.push(row);
  }
  return items;
}

function eventIdOf(row: Record<string, unknown>): string | undefined {
  if (row.kind !== 'event') return undefined;
  const event = row.event;
  if (typeof event === 'string' && event !== '') return event;
  const id = row.id;
  if (typeof id === 'string' && id !== '') return id;
  return undefined;
}

function emptyIndex(): ModuleEventsIndex {
  return { publishes: new Map(), consumers: new Map() };
}

/** Problems are logged and left out of the maps. */
export function moduleEventsIndex(projectId: string): Promise<ModuleEventsIndex> {
  const cached = cache.get(projectId);
  if (cached) return cached;
  const built = buildIndex(projectId);
  cache.set(projectId, built);
  return built;
}

async function buildIndex(projectId: string): Promise<ModuleEventsIndex> {
  const index = emptyIndex();
  if (!/^\d+$/u.test(projectId)) {
    warn('events index refused: project id is not digits');
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
    warn(`events index unreadable: ${message}`);
    return index;
  }

  const modules = new Set(moduleIds);
  const inbound: { moduleId: string; from: string; eventId: string }[] = [];

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

    for (const row of itemsOf(loaded, 'outbound')) {
      const eventId = eventIdOf(row);
      if (eventId === undefined) continue;
      if (!SAFE_NAME.test(eventId)) {
        warn('event id refused: not a plain id');
        continue;
      }
      const toRaw = row.to;
      const to = typeof toRaw === 'string' && toRaw !== '' ? toRaw : 'any';
      if (to !== 'any' && (to === moduleId || !modules.has(to))) {
        warn(`event destination refused: not a sibling (${moduleEventRefText({ module: moduleId, eventId })})`);
        continue;
      }
      const ref = moduleEventRefText({ module: moduleId, eventId });
      if (index.publishes.has(ref)) {
        warn(`event id refused: published twice (${ref})`);
        index.publishes.delete(ref);
        continue;
      }
      index.publishes.set(ref, { to });
    }

    for (const row of itemsOf(loaded, 'inbound')) {
      const eventId = eventIdOf(row);
      if (eventId === undefined) continue;
      const from = row.from;
      if (typeof from !== 'string' || from === '') continue;
      // `organization` is the platform's own event catalogue, not a sibling module: nothing to match it against here.
      if (from === 'organization') continue;
      inbound.push({ moduleId, from, eventId });
    }
  }

  for (const [ref, publish] of index.publishes) {
    const declared: string[] = [];
    for (const row of inbound) {
      const want = moduleEventRefText({ module: row.from, eventId: row.eventId });
      if (want !== ref) continue;
      if (publish.to !== 'any' && publish.to !== row.moduleId) continue;
      declared.push(row.moduleId);
    }
    declared.sort();
    index.consumers.set(ref, declared);
  }

  for (const row of inbound) {
    const ref = moduleEventRefText({ module: row.from, eventId: row.eventId });
    if (index.publishes.has(ref)) continue;
    warn(`event subscriber refused: nobody publishes (${ref})`);
  }

  return index;
}
