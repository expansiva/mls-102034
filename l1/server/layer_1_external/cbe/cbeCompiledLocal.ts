/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeCompiledLocal.ts" enhancement="_blank" />
// Reads a project's obj/compiled.zip from the local workspace and prepares the
// incremental sources payload the cfe (mls) frontend expects — the same format
// the central cbe builds from the git repositories, but sourced from the local
// release/workspace. Everything is kept in memory with an mtime-based cache, so
// the zip is only re-read when it changes.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import AdmZip from 'adm-zip';
import { existsSyncOrDenied, resolveProjectsPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';

export { existsSyncOrDenied };
import type { CbePrjSourcesFile, CbePrjSourcesInfo } from '/_102034_/l1/server/layer_1_external/cbe/cbeTypes.js';

// Standard VM layout: the release (cwd) holds only the runtime output, while
// the project SOURCES (mls-<id>/obj/compiled.zip etc.) live at the deployment
// base, sibling of releases/ and static/.
const DEFAULT_PROJECTS_BASE = '/data/mls-base';

/** Root named by the process. Empty when the host did not name one. */
export function explicitProjectsRoot(): string | undefined {
  const raw = process.env.CBE_PROJECTS_DIR;
  const trimmed = raw?.trim();
  return trimmed ? resolve(trimmed) : undefined;
}

/** A named root other than the shared base is one project tree: the app runs from `<root>/current`. */
export function runsFromProjectCurrent(): boolean {
  const root = explicitProjectsRoot();
  return root !== undefined && root !== resolve(DEFAULT_PROJECTS_BASE);
}

let loggedDefaultProjectsBase = false;


/** Base dir where the mls-<id> source folders live. Order: named root -> VM standard -> dev workspace. */
export function getProjectsBaseDir(): string {
  const fromEnv = explicitProjectsRoot();
  if (fromEnv) return fromEnv;
  if (existsSyncOrDenied(DEFAULT_PROJECTS_BASE)) {
    if (!loggedDefaultProjectsBase) {
      loggedDefaultProjectsBase = true;
      console.info('[cbe] CBE_PROJECTS_DIR unset; using /data/mls-base');
    }
    return DEFAULT_PROJECTS_BASE;
  }
  return resolveProjectsPath('.');
}

/**
 * Resolves a path inside a project's source folder at the base (e.g. 'obj/compiled.zip').
 * `sourceRoot`, when set, replaces `<base>/mls-<id>` — a draft worktree, absolute.
 * Omitted, the path is exactly what it was.
 */
export function resolveProjectSourcePath(projectId: number, relativePath: string, sourceRoot?: string): string {
  if (sourceRoot !== undefined) {
    if (!isAbsolute(sourceRoot)) {
      console.warn(`[cbe] sourceRoot is not absolute: "${sourceRoot}" (project ${projectId})`);
    }
    return join(sourceRoot, relativePath);
  }
  return join(getProjectsBaseDir(), `mls-${projectId}`, relativePath);
}

interface CompiledProjectCacheEntry {
  zipMtimeMs: number;
  /** ISO date of the compiled sources (from fileinfos.json, falling back to the zip mtime). */
  lastModified: string;
  /** gzip+base64 of CbePrjSourcesInfo, ready to send to the frontend. */
  filesPayload: string;
  /** Same list, plain — served to the VM driver's loadFilesInfo. */
  filesInfo: CbePrjSourcesFile[];
  /** true when the zip has no usable fileinfos — the project must not be sent. */
  isEmpty: boolean;
}

const cache = new Map<number, CompiledProjectCacheEntry>();

interface CompiledProjectLoad {
  promise: Promise<CompiledProjectCacheEntry | null>;
  started: boolean;
  run: () => CompiledProjectCacheEntry | null;
}

/** One in-flight read per project. Login and boot warmup share it. */
const inflight = new Map<number, CompiledProjectLoad>();

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

  // First shortPath wins, same as findIndex. Built once per zip.
  const filesByShortPath = new Map<string, CbePrjSourcesFile>();
  for (const file of prjInfo.filesInfo) {
    if (!filesByShortPath.has(file.shortPath)) filesByShortPath.set(file.shortPath, file);
  }

  let jsMatched = 0;
  for (const entry of zip.getEntries()) {
    if (!entry.entryName.endsWith('.js')) continue;
    const shortPath = entryNameToShortPath(entry.entryName, projectId);
    if (!shortPath) continue;
    // fileinfos.json normally indexes sources (.ts), but locally generated
    // zips may index the compiled name (.js) — accept both.
    const shortPathJs = shortPath.replace(/\.ts$/u, '.js');
    const file = filesByShortPath.get(shortPath) ?? filesByShortPath.get(shortPathJs);
    if (!file) continue;
    file.jsContent = compressAndEncodeBase64(new Uint8Array(entry.getData()));
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
    filesInfo: prjInfo.filesInfo,
    isEmpty: prjInfo.filesInfo.length === 0,
  };
}

/**
 * The project's file list in plain form — the same index the login ships gzipped,
 * used by the VM storage driver's loadFilesInfo so both answer with one truth.
 */
export function getProjectFilesInfo(projectId: number): CbePrjSourcesFile[] {
  return getCompiledProject(projectId)?.filesInfo ?? [];
}

/**
 * Returns the compiled sources info for a workspace project, or null when the
 * project has no obj/compiled.zip. Results are cached until the zip changes.
 */
/** Cache hit, or `null` when the zip is absent. `undefined` means it still has to be read. */
function peekCompiledProject(projectId: number): CompiledProjectCacheEntry | null | undefined {
  const zipPath = resolveCompiledZipPath(projectId);
  if (!existsSync(zipPath)) return null;
  const zipMtimeMs = statSync(zipPath).mtimeMs;
  const cached = cache.get(projectId);
  if (cached && cached.zipMtimeMs === zipMtimeMs) return cached;
  return undefined;
}

function readCompiledProjectNow(projectId: number): CompiledProjectCacheEntry | null {
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
 * Shared read of one project's compiled zip. A second caller (the login arriving
 * while boot warmup is still in flight) gets the same promise, not a second read.
 * The read itself is deferred so the caller can attach before it starts.
 */
export function loadCompiledProject(projectId: number): Promise<CompiledProjectCacheEntry | null> {
  const ready = peekCompiledProject(projectId);
  if (ready !== undefined) return Promise.resolve(ready);
  const existing = inflight.get(projectId);
  if (existing) return existing.promise;

  let resolveLoad: (entry: CompiledProjectCacheEntry | null) => void = () => {};
  const promise = new Promise<CompiledProjectCacheEntry | null>((resolve) => {
    resolveLoad = resolve;
  });
  const job: CompiledProjectLoad = {
    promise,
    started: false,
    run: () => {
      job.started = true;
      let entry: CompiledProjectCacheEntry | null = null;
      try {
        entry = readCompiledProjectNow(projectId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[cbe] compiled zip project ${projectId}: ${message}`);
        entry = null;
      } finally {
        inflight.delete(projectId);
      }
      resolveLoad(entry);
      return entry;
    },
  };
  inflight.set(projectId, job);
  queueMicrotask(() => {
    if (inflight.get(projectId) === job && !job.started) job.run();
  });
  return promise;
}

/**
 * After listen: warm each project's compiled zip without blocking the boot callback.
 * One project at a time, yielding between them, so `/health` stays responsive.
 * A failure is one log line inside `loadCompiledProject` and does not stop the rest.
 */
export function warmCompiledProjects(projectIds: readonly number[]): void {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const projectId of projectIds) {
    if (seen.has(projectId)) continue;
    seen.add(projectId);
    ids.push(projectId);
  }
  const step = (index: number): void => {
    if (index >= ids.length) return;
    void loadCompiledProject(ids[index]).then(() => {
      setImmediate(() => step(index + 1));
    });
  };
  setImmediate(() => step(0));
}

export function getCompiledProject(projectId: number): CompiledProjectCacheEntry | null {
  const ready = peekCompiledProject(projectId);
  if (ready !== undefined) return ready;
  const pending = inflight.get(projectId);
  if (pending) {
    if (!pending.started) return pending.run();
    return null;
  }
  loadCompiledProject(projectId);
  const job = inflight.get(projectId);
  if (job && !job.started) return job.run();
  const after = peekCompiledProject(projectId);
  return after === undefined ? null : after;
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
