/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeCompiledLocal.ts" enhancement="_blank" />
// Reads a project's obj/compiled.zip from the local workspace and prepares the
// incremental sources payload the cfe (mls) frontend expects — the same format
// the central cbe builds from the git repositories, but sourced from the local
// release/workspace. Everything is kept in memory with an mtime-based cache, so
// the zip is only re-read when it changes.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import AdmZip from 'adm-zip';
import { resolveProjectsPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import type { CbePrjSourcesFile, CbePrjSourcesInfo } from '/_102034_/l1/server/layer_1_external/cbe/cbeTypes.js';

// Standard VM layout: the release (cwd) holds only the runtime output, while
// the project SOURCES (mls-<id>/obj/compiled.zip etc.) live at the deployment
// base, sibling of releases/ and static/.
const DEFAULT_PROJECTS_BASE = '/data/mls-base';

/** Base dir where the mls-<id> source folders live. Order: .env override -> VM standard -> dev workspace. */
export function getProjectsBaseDir(): string {
  const fromEnv = process.env.CBE_PROJECTS_DIR;
  if (fromEnv) return resolve(fromEnv);
  if (existsSync(DEFAULT_PROJECTS_BASE)) return DEFAULT_PROJECTS_BASE;
  return resolveProjectsPath('.');
}

/** Resolves a path inside a project's source folder at the base (e.g. 'obj/compiled.zip'). */
export function resolveProjectSourcePath(projectId: number, relativePath: string): string {
  return join(getProjectsBaseDir(), `mls-${projectId}`, relativePath);
}

interface CompiledProjectCacheEntry {
  zipMtimeMs: number;
  /** ISO date of the compiled sources (from fileinfos.json, falling back to the zip mtime). */
  lastModified: string;
  /** gzip+base64 of CbePrjSourcesInfo, ready to send to the frontend. */
  filesPayload: string;
  /** true when the zip has no usable fileinfos — the project must not be sent. */
  isEmpty: boolean;
}

const cache = new Map<number, CompiledProjectCacheEntry>();

export function compressAndEncodeBase64(data: object | string | Uint8Array): string {
  const input = data instanceof Uint8Array
    ? data
    : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
  return gzipSync(input).toString('base64');
}

function resolveCompiledZipPath(projectId: number): string {
  return resolveProjectSourcePath(projectId, 'obj/compiled.zip');
}

export function hasCompiledZip(projectId: number): boolean {
  return existsSync(resolveCompiledZipPath(projectId));
}

/** Maps a zip entry (e.g. `_102033_/l2/core/bootstrap.js`) to the fileinfos shortPath (`l2/core/bootstrap.ts`). */
function entryNameToShortPath(entryName: string, projectId: number): string | null {
  const l2Index = entryName.indexOf('/l2/');
  if (l2Index < 0) return null;
  const rest = entryName.slice(l2Index + '/l2/'.length);
  return `l2/${rest}`
    .replace(/\.js$/u, '.ts')
    .replace(`_${projectId}_`, '');
}

function readCompiledZip(projectId: number, zipPath: string, zipMtimeMs: number): CompiledProjectCacheEntry {
  const zip = new AdmZip(readFileSync(zipPath));
  const prjInfo: CbePrjSourcesInfo = { filesInfo: [], importsMap: '', indexModules: '' };
  let lastModified = '';

  for (const entry of zip.getEntries()) {
    const name = entry.entryName;
    if (name.endsWith('fileinfos.json')) {
      const parsed = JSON.parse(entry.getData().toString('utf8')) as {
        files?: CbePrjSourcesFile[];
        lastModified?: string;
        lastModify?: string;
      };
      prjInfo.filesInfo.push(...(parsed.files ?? []));
      lastModified = parsed.lastModified ?? parsed.lastModify ?? '';
    } else if (name.endsWith('types/index.d.ts')) {
      prjInfo.indexModules = entry.getData().toString('utf8');
    } else if (name.endsWith('types/importsMap.json')) {
      prjInfo.importsMap = entry.getData().toString('utf8');
    }
  }

  let jsMatched = 0;
  for (const entry of zip.getEntries()) {
    if (!entry.entryName.endsWith('.js')) continue;
    const shortPath = entryNameToShortPath(entry.entryName, projectId);
    if (!shortPath) continue;
    // fileinfos.json normally indexes sources (.ts), but locally generated
    // zips may index the compiled name (.js) — accept both.
    const shortPathJs = shortPath.replace(/\.ts$/u, '.js');
    const index = prjInfo.filesInfo.findIndex((f) => f.shortPath === shortPath || f.shortPath === shortPathJs);
    if (index < 0) continue;
    prjInfo.filesInfo[index].jsContent = compressAndEncodeBase64(new Uint8Array(entry.getData()));
    jsMatched += 1;
  }

  if (prjInfo.filesInfo.length === 0) {
    console.warn(`[cbe] project ${projectId}: compiled.zip has no fileinfos.json (or it is empty) — project will NOT be sent to the frontend. Regenerate the obj with scripts/buildClientObj.mjs (zip: ${zipPath})`);
  } else if (jsMatched === 0) {
    console.warn(`[cbe] project ${projectId}: no js entry matched fileinfos shortPaths — sources list will be sent without js content (zip: ${zipPath})`);
  }

  return {
    zipMtimeMs,
    lastModified: lastModified || new Date(zipMtimeMs).toISOString(),
    filesPayload: compressAndEncodeBase64(prjInfo),
    isEmpty: prjInfo.filesInfo.length === 0,
  };
}

/**
 * Returns the compiled sources info for a workspace project, or null when the
 * project has no obj/compiled.zip. Results are cached until the zip changes.
 */
export function getCompiledProject(projectId: number): CompiledProjectCacheEntry | null {
  const zipPath = resolveCompiledZipPath(projectId);
  if (!existsSync(zipPath)) return null;

  const zipMtimeMs = statSync(zipPath).mtimeMs;
  const cached = cache.get(projectId);
  if (cached && cached.zipMtimeMs === zipMtimeMs) return cached;

  const entry = readCompiledZip(projectId, zipPath, zipMtimeMs);
  cache.set(projectId, entry);
  return entry;
}

/**
 * Incremental delivery control (same rule as the central cbe): only return the
 * files payload when the local compiled sources are newer than what the
 * frontend reported having in its IndexedDB.
 */
export function getFilesIfNewer(projectId: number, frontendLastModified: string | undefined): { files?: string; lastModified: string } | null {
  const compiled = getCompiledProject(projectId);
  if (!compiled || compiled.isEmpty) return null;

  const dtFrontend = new Date(frontendLastModified || '2000-01-01').getTime();
  const dtLocal = new Date(compiled.lastModified).getTime();
  const needUpdate = dtFrontend < dtLocal;

  return {
    lastModified: compiled.lastModified,
    files: needUpdate ? compiled.filesPayload : undefined,
  };
}
