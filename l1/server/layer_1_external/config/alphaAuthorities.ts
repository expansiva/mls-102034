/// <mls fileReference="_102034_/l1/server/layer_1_external/config/alphaAuthorities.ts" enhancement="_blank" />
import { existsSync } from 'node:fs';
import { resolveProjectDistPath, resolveProjectModuleImportUrl, readProjectsConfig } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';

// Release switch: l5/config.json top-level `"alphaAllAuthorities": true`, copied to the
// release config.json by the build. A new release is a new process, so the value is read once.
type AlphaConfig = { alphaAllAuthorities?: unknown };

let decided: boolean | null = null;
const actorCache = new Map<string, Promise<string[]>>();

/** Per-release alpha switch. True only when config.json has alphaAllAuthorities === true. */
export function isAlphaAllAuthorities(
  _projectId?: string | number,
  readConfig: () => AlphaConfig = () => readProjectsConfig() as AlphaConfig,
): boolean {
  if (decided !== null) return decided;
  const on = readConfig().alphaAllAuthorities === true;
  if (on) {
    console.warn('[alpha] alphaAllAuthorities ON (config.json) — every signed-in user gets every actor of every module (remove before beta)');
  }
  decided = on;
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
  decided = null;
  actorCache.clear();
}
