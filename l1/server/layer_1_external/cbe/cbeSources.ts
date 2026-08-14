/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeSources.ts" enhancement="_blank" />
// Source file I/O for the VM storage driver (mls-102033 l2/cbe/driverVm.ts).
// The login payload only carries COMPILED js, so every read of a .ts source —
// opening a file in the studio editor, an agent reading or writing code — lands
// here through the cbe /exec actions getContents/setContents/loadFilesInfo.
//
// Reads and writes hit the project TREE (<base>/mls-<id>/l<level>/...), not
// obj/source.zip: the tree is what the publish syncs, what a write must change,
// and what buildProjectsObj compiles — so read-after-write stays consistent.

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { getProjectFilesInfo, resolveProjectSourcePath } from '/_102034_/l1/server/layer_1_external/cbe/cbeCompiledLocal.js';
import type { CbePrjSourcesFile, CbeSourceFile } from '/_102034_/l1/server/layer_1_external/cbe/cbeTypes.js';

/** Levels the platform defines (l1..l7); l0 has no level folder. */
const MAX_LEVEL = 7;
const SHORT_PATH_PATTERN = new RegExp(`^(l[1-${MAX_LEVEL}]/)?[^/].*$`, 'u');

/**
 * Absolute path of a source file, or null when the shortPath is not acceptable.
 *
 * The shortPath comes from the BROWSER and becomes a write target on the VM's
 * disk, so this is a security boundary, not a formality: the resolved path must
 * stay inside <base>/mls-<id>/. Rejects traversal ('..'), absolute paths, NUL
 * bytes and levels outside l1..l7.
 */
export function resolveSourcePath(projectId: number, shortPath: string): string | null {
  if (!Number.isInteger(projectId) || projectId <= 0) return null;
  if (typeof shortPath !== 'string' || shortPath.length === 0) return null;
  if (shortPath.includes('\0') || shortPath.includes('\\')) return null;
  if (shortPath.startsWith('/') || /^[A-Za-z]:/u.test(shortPath)) return null;
  if (shortPath.split('/').some((segment) => segment === '..' || segment === '.')) return null;
  if (!SHORT_PATH_PATTERN.test(shortPath)) return null;

  const projectRoot = resolve(resolveProjectSourcePath(projectId, '.'));
  const target = resolve(projectRoot, shortPath);
  // Containment check on the resolved paths — the only one that actually proves it.
  if (target !== projectRoot && !target.startsWith(projectRoot + sep)) return null;
  return target;
}

/** Reads the requested sources; a file that is not there comes back as null content. */
export function readSources(projectId: number, shortPaths: string[]): CbeSourceFile[] {
  const rc: CbeSourceFile[] = [];
  for (const shortPath of shortPaths) {
    const path = resolveSourcePath(projectId, shortPath);
    if (!path) {
      console.warn(`[cbe] getContents: rejected shortPath "${shortPath}" (project ${projectId})`);
      continue;
    }
    if (!existsSync(path) || !statSync(path).isFile()) continue;
    const isText = /\.(ts|tsx|js|json|less|css|html|md|txt|svg|sql|yml|yaml)$/u.test(shortPath);
    rc.push(isText
      ? { shortPath, content: readFileSync(path, 'utf8'), encoding: 'utf8' }
      : { shortPath, content: readFileSync(path).toString('base64'), encoding: 'base64' });
  }
  return rc;
}

/**
 * Writes the given sources and removes the deleted ones. All-or-nothing is NOT
 * attempted (no transaction on a plain FS): a rejected path aborts the whole
 * call BEFORE any write, so a bad request never leaves a half-applied state.
 */
export function writeSources(projectId: number, files: CbeSourceFile[], deletes: string[]): { ok: boolean; msg?: string } {
  const writes: { path: string; content: Buffer }[] = [];
  for (const file of files) {
    const path = resolveSourcePath(projectId, file.shortPath);
    if (!path) return { ok: false, msg: `rejected shortPath: ${file.shortPath}` };
    writes.push({
      path,
      content: file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : Buffer.from(file.content, 'utf8'),
    });
  }

  const removals: string[] = [];
  for (const shortPath of deletes) {
    const path = resolveSourcePath(projectId, shortPath);
    if (!path) return { ok: false, msg: `rejected shortPath: ${shortPath}` };
    removals.push(path);
  }

  for (const write of writes) {
    mkdirSync(dirname(write.path), { recursive: true });
    writeFileSync(write.path, write.content);
  }
  for (const path of removals) {
    if (existsSync(path)) rmSync(path, { force: true });
  }
  console.info(`[cbe] setContents project ${projectId}: ${writes.length} written, ${removals.length} removed`);
  return { ok: true };
}

/** The project's file index — same list the login ships, in plain form. */
export function listSources(projectId: number): CbePrjSourcesFile[] {
  return getProjectFilesInfo(projectId);
}
