/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeCompiledStatic.ts" enhancement="_blank" />
// Fallback static delivery of compiled project modules straight from
// mls-<id>/obj/compiled.zip. The browser normally gets these through the mls
// service worker (IndexedDB filled by the cbe login), but before the SW
// controls the page (first load, hard refresh, fresh profile) module imports
// like /_102041_/l2/collab-nav-1.js hit the server — and the dist only carries
// the config.json projects. This fallback makes every project with a compiled
// zip servable directly, so the studio components never depend on SW timing.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import AdmZip from 'adm-zip';
import { resolveProjectSourcePath } from '/_102034_/l1/server/layer_1_external/cbe/cbeCompiledLocal.js';

interface CompiledStaticEntry {
  content: Buffer;
  eTag: string;
}

interface CompiledStaticCache {
  zipMtimeMs: number;
  entries: Map<string, CompiledStaticEntry>;
}

const cache = new Map<number, CompiledStaticCache>();

// /_102041_/l2/collab-nav-1.js -> { projectId: 102041, entryName: '_102041_/l2/collab-nav-1.js' }
// Extensionless module imports (e.g. /_100554_/l2/collabIcons) are how the
// studio modules import each other — the mls service worker resolves them by
// assuming .js, and this fallback does the same.
const MODULE_PATH_RE = /^\/(_(\d+)_\/l2\/[^?]+)$/u;
const KNOWN_EXTENSIONS_RE = /\.(?:js|css|json|map)$/u;

function loadZipEntries(projectId: number): CompiledStaticCache | null {
  const zipPath = resolveProjectSourcePath(projectId, 'obj/compiled.zip');
  if (!existsSync(zipPath)) return null;

  const zipMtimeMs = statSync(zipPath).mtimeMs;
  const cached = cache.get(projectId);
  if (cached && cached.zipMtimeMs === zipMtimeMs) return cached;

  const entries = new Map<string, CompiledStaticEntry>();
  for (const entry of new AdmZip(readFileSync(zipPath)).getEntries()) {
    if (entry.isDirectory) continue;
    const content = entry.getData();
    entries.set(entry.entryName, {
      content,
      eTag: `${createHash('sha1').update(content).digest('base64')}c`,
    });
  }

  const built: CompiledStaticCache = { zipMtimeMs, entries };
  cache.set(projectId, built);
  return built;
}

export interface CompiledStaticResult {
  content: Buffer;
  eTag: string;
  contentType: string;
}

/**
 * Serves a `/_<id>_/l2/...` module from the project's compiled.zip, or null
 * when the path is not a module path / the project or entry does not exist.
 */
export function getCompiledStaticFile(rawUrlPath: string): CompiledStaticResult | null {
  const urlPath = rawUrlPath.replace(/\?.*$/u, '');
  const match = MODULE_PATH_RE.exec(urlPath);
  if (!match || urlPath.includes('..')) return null;

  const requested = match[1];
  const projectId = Number(match[2]);
  if (!Number.isFinite(projectId)) return null;

  const entryName = KNOWN_EXTENSIONS_RE.test(requested) ? requested : `${requested}.js`;
  const zip = loadZipEntries(projectId);
  const entry = zip?.entries.get(entryName);
  if (!entry) return null;

  const contentType = entryName.endsWith('.js')
    ? 'text/javascript; charset=utf-8'
    : entryName.endsWith('.css')
      ? 'text/css; charset=utf-8'
      : 'application/json; charset=utf-8';
  return { content: entry.content, eTag: entry.eTag, contentType };
}
