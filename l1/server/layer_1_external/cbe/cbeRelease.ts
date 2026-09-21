/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeRelease.ts" enhancement="_blank" />
// Identity of the release THIS process is running — not the one the `current`
// symlink points at.
//
// The two are usually the same and disagree exactly when it matters: addNewVersion
// flips `current` and then reloads pm2, so between those steps (or forever, if the
// reload fails — see the app2046 incident) the symlink advertises a release that no
// running worker is serving. Reading the symlink would answer "what should be live";
// this answers "what I am", which is the only useful reply to a browser asking
// whether its rebuild already landed.
//
// The path comes from process.cwd(): pm2 starts the app with cwd on the
// `current-<id>` symlink and the kernel resolves it at exec time, so cwd is the
// concrete releases/<id> directory even after the symlink moves on. Caching it is
// deliberate for the same reason — a process's identity cannot change while it runs.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** release.json as addNewVersion writes it (scripts/runtime/releaseStamp.mjs). */
export interface RunningRelease {
  id: string;
  client?: string;
  libs?: string;
  monaco?: string;
  versionRef?: string;
  modelCommit?: string | null;
  platformCommit?: string | null;
}

/** How far up to look — the compiled entrypoint sits ~8 levels under the release root. */
const MAX_LEVELS = 12;

/**
 * Nearest release.json at or above `startDir`, or null when there is none — a dev
 * checkout has no release layout, and that is not an error.
 */
export function findRelease(startDir: string): RunningRelease | null {
  let dir = startDir;
  for (let level = 0; level < MAX_LEVELS; level += 1) {
    const candidate = join(dir, 'release.json');
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as RunningRelease;
        return parsed && typeof parsed.id === 'string' ? parsed : null;
      } catch {
        return null; // a corrupt stamp must not break the ping
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

let cached: RunningRelease | null | undefined;

/** The running release, resolved once. */
export function getRunningRelease(): RunningRelease | null {
  if (cached === undefined) cached = findRelease(process.cwd());
  return cached;
}

/** Drops the memoized value so tests can resolve again. */
export function resetRunningReleaseCache(): void {
  cached = undefined;
}
