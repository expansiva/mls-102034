/// <mls fileReference="_102034_/l1/server/layer_1_external/config/alphaAuthorities.ts" enhancement="_blank" />
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolveProjectDistPath, resolveProjectModuleImportUrl } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';

// The switch lives ON THE VM, outside the releases and outside the repo: an alpha operator turns it on
// or off by editing this file, with no publish and no restart. One org per VM, so it is VM-wide.
//   /data/mls-base/runtime-flags.json  ->  { "alphaAllAuthorities": true }
const DEFAULT_RUNTIME_FLAGS_FILE = '/data/mls-base/runtime-flags.json';

let flagState: { file: string; mtimeMs: number; on: boolean } | null = null;
const actorCache = new Map<string, Promise<string[]>>();

export function runtimeFlagsFile(env: Record<string, string | undefined> = process.env): string {
  return env.COLLAB_RUNTIME_FLAGS_FILE?.trim() || DEFAULT_RUNTIME_FLAGS_FILE;
}

/** VM-wide alpha switch. Re-read whenever the file's mtime changes; missing file = off. */
export function isAlphaAllAuthorities(_projectId?: string | number, file: string = runtimeFlagsFile()): boolean {
  let mtimeMs = -1;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    mtimeMs = -1;
  }
  if (flagState && flagState.file === file && flagState.mtimeMs === mtimeMs) return flagState.on;
  let on = false;
  if (mtimeMs >= 0) {
    try {
      on = (JSON.parse(readFileSync(file, 'utf8')) as { alphaAllAuthorities?: unknown }).alphaAllAuthorities === true;
    } catch (err) {
      console.warn(`[alpha] ${file} unreadable — alphaAllAuthorities off: ${(err as Error).message}`);
    }
  }
  const was = flagState?.file === file ? flagState.on : false;
  if (on && !was) {
    console.warn(`[alpha] alphaAllAuthorities ON (${file}) — every signed-in user gets every actor of every module (remove before beta)`);
  } else if (!on && was) {
    console.info(`[alpha] alphaAllAuthorities OFF (${file})`);
  }
  flagState = { file, mtimeMs, on };
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
  flagState = null;
  actorCache.clear();
}
