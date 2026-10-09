/// <mls fileReference="_102034_/l1/server/layer_1_external/config/alphaAuthorities.ts" enhancement="_blank" />
import { existsSync, readFileSync } from 'node:fs';
import { resolveProjectDistPath, resolveProjectModuleImportUrl } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';

const flagCache = new Map<string, boolean>();
const actorCache = new Map<string, Promise<string[]>>();

export function isAlphaAllAuthorities(projectId?: string | number): boolean {
  const key = String(projectId ?? '');
  if (!key) return false;
  const cached = flagCache.get(key);
  if (cached !== undefined) return cached;
  let on = false;
  try {
    const path = resolveProjectDistPath(`_${key}_/l5/project.json`);
    if (existsSync(path)) {
      const value = (JSON.parse(readFileSync(path, 'utf8')) as { alphaAllAuthorities?: unknown }).alphaAllAuthorities;
      on = value === true;
    }
  } catch (err) {
    console.warn(`[alphaAuthorities] _${key}_/l5/project.json unreadable — alphaAllAuthorities off: ${(err as Error).message}`);
    on = false;
  }
  flagCache.set(key, on);
  return on;
}

export function moduleActorRefs(controllersDir: string): Promise<string[]> {
  const cached = actorCache.get(controllersDir);
  if (cached) return cached;
  const pending = loadActorRefs(controllersDir);
  actorCache.set(controllersDir, pending);
  return pending;
}

async function loadActorRefs(controllersDir: string): Promise<string[]> {
  const relativePath = `${controllersDir.replace(/\/$/u, '')}/../../auth/authorityMap.js`;
  if (!existsSync(resolveProjectDistPath(relativePath))) {
    return [];
  }
  const mod = await import(resolveProjectModuleImportUrl(relativePath));
  const entries = (mod as { entries?: Array<{ actorRef?: unknown }> }).entries;
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const entry of entries) {
    if (entry && typeof entry.actorRef === 'string' && !seen.has(entry.actorRef)) {
      seen.add(entry.actorRef);
      refs.push(entry.actorRef);
    }
  }
  return refs;
}

export function resetAlphaAuthoritiesCache(): void {
  flagCache.clear();
  actorCache.clear();
}
