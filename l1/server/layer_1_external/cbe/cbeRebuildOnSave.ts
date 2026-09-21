/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeRebuildOnSave.ts" enhancement="_blank" />
// Triggers a background rebuild+redeploy after a studio save (setContents)
// writes files to disk. writeSources() (cbeSources.ts) only does plain file
// I/O — without this, a save never reaches the running server until someone
// SSHes in and runs `pnpm build` by hand.
//
// IT ALSO REFRESHES THE SAVED PROJECT'S obj/compiled.zip, which `pnpm build`
// alone does NOT do for a project inside the release fecho: addNewVersion only
// refreshes the projects OUTSIDE it (the fecho is built by the publish's git
// hook, which a save never runs). The saved project is normally the fecho's own
// app, and its fileinfos.json is where the browser reads each file's versionRef
// from — leave it frozen at the last publish and the studio keeps serving the
// pre-edit source no matter how many times the build runs.
//
// Two layers of coordination:
//   1. A per-worker in-process debounce (setTimeout) collapses a burst of
//      rapid saves handled by the SAME pm2 cluster worker into one attempt.
//   2. A cross-worker file lock — this pm2 app runs 2 cluster instances of the
//      same code (servers/pm2.config.js: instances 2) — makes sure only ONE
//      worker actually spawns `pnpm build` at a time, no matter which worker's
//      debounce timer fires first. A worker that loses the race re-arms a
//      short retry instead of dropping the save: every write is already
//      durable on disk (writeFileSync completed synchronously inside
//      writeSources(), before this module is ever called), so any build that
//      runs after the last write, by any worker, is correct.
//
// WHY THE BUILD IS LAUNCHED VIA A BACKGROUNDED SHELL, NOT spawn(...).unref()
// directly: pm2's own reload kills the OLD worker's entire "process tree"
// (confirmed in ~/.pm2/pm2.log: "process tree killed (6 pids)" instead of the
// usual 1) — Node's `detached: true` only changes the child's session, not
// who the kernel reports as its parent, so a plain detached child spawned
// from inside a request handler is still discovered and killed when THAT
// worker gets reloaded (including by the very build this module triggers —
// confirmed: the reload command failed both times it was self-triggered, but
// succeeded instantly when run manually from an unrelated shell).
// `sh -c '{ ...; } >>log 2>&1 &'` backgrounds the real work and lets the
// wrapper shell exit immediately, so the kernel reparents the long-running
// build to init (pid 1) within milliseconds — by the time any pm2 reload
// walks a worker's tree, the build is no longer part of it. The header/footer
// log lines and the lock release live INSIDE that shell chain (not in a JS
// `child.on('exit')` handler) for the same reason: a JS handler only fires if
// the worker holding it survives long enough, which a reload cannot guarantee.

import { spawn } from 'node:child_process';
import { closeSync, lstatSync, mkdirSync, openSync, rmSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectsBaseDir } from '/_102034_/l1/server/layer_1_external/cbe/cbeCompiledLocal.js';
import { readProjectsConfig } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';

/** POSIX single-quote escaping for values interpolated into the shell command below. */
function shQuote(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

// getProjectsBaseDir() and releaseHandlers.ts's own BASE_DIR
// (resolve(process.cwd(), '..', '..')) resolve to the same directory in
// production (/data/mls-base) — reused here instead of re-deriving a third way.
const ROOT = getProjectsBaseDir();
const LOGS_DIR = join(ROOT, 'logs');
const LOG_PATH = join(LOGS_DIR, 'rebuild-on-save.log');
const LOCK_PATH = join(ROOT, '.rebuild-on-save.lock');

const STALE_LOCK_MS = 15 * 60 * 1000; // well above a lean (--skip-install --skip-migrate) build
const RETRY_MS = 1000;
const RETRY_JITTER_MS = 500;
const DEBOUNCE_MS = Number.parseInt(process.env.COLLAB_REBUILD_DEBOUNCE_MS ?? '4000', 10);

/** CBE_REBUILD_ON_SAVE=always|never overrides; default is production-only —
 * a local dev checkout also has servers/pm2.config.js on disk, so "does the
 * config file exist" would not reliably tell dev and prod apart. */
function isEnabled(): boolean {
  const override = process.env.CBE_REBUILD_ON_SAVE;
  if (override === 'always') return true;
  if (override === 'never') return false;
  return process.env.NODE_ENV === 'production';
}

/** Only for the synchronous lock-contention diagnostics below — the build's own
 * start/end lines are written by the detached shell chain, not from here. */
function log(line: string): void {
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    const fd = openSync(LOG_PATH, 'a');
    writeSync(fd, `${line}\n`);
    closeSync(fd);
  } catch {
    // best-effort logging only — never let a log failure break the build trigger
  }
}

function lockIsStale(): boolean {
  try {
    return Date.now() - statSync(LOCK_PATH).mtimeMs > STALE_LOCK_MS;
  } catch {
    return false;
  }
}

let timer: NodeJS.Timeout | null = null;
/** Projects saved since the last launched build — refreshed before it compiles. */
const pendingProjects = new Set<number>();

/**
 * The `current-<id>` symlink the running app uses as its cwd, or '' when there is none.
 *
 * addNewVersion always flips the global `current`, but an ALIAS only moves when
 * COLLAB_RELEASE_ALIAS names it — and pm2 starts this app with cwd on the alias
 * (pm2.apps.d/app<port>.config.js). Without passing it, a save compiled a new release,
 * moved `current`, reloaded pm2 — and the app came back on the OLD release, because its
 * alias never moved. Observed on the VM: current -> 20260918182437 while
 * current-102047 -> 20260918152151, with the build reporting exit=0.
 *
 * lstat, not existsSync: a dangling alias (its target pruned) must still be moved — that
 * is exactly the state that needs fixing, and existsSync follows the link and says no.
 */
export function releaseAliasFor(clientId: string): string {
  const fromEnv = (process.env.COLLAB_RELEASE_ALIAS ?? '').trim();
  if (fromEnv) return fromEnv; // an explicit setting wins, as in the publish
  if (!/^\d+$/u.test(clientId)) return '';
  const alias = `current-${clientId}`;
  try {
    lstatSync(join(ROOT, alias));
    return alias;
  } catch {
    return ''; // no alias on this host: the global `current` is enough
  }
}

/**
 * The one backgrounded job the build runs as. Everything between `{` and `}`
 * runs as ONE job; the outer `sh -c` invocation returns as soon as it has
 * started it, which is what lets the kernel reparent it to init before any pm2
 * reload can find it still hanging off this worker's process tree.
 *
 * The obj refresh comes BEFORE `pnpm build` so the release it assembles already
 * carries the new zip (and addNewVersion's assertFechoCompiledZips validates
 * that one). It is a separate `;` step: if it fails, the build still runs.
 */
export function buildShellChain(options: { ownerToken: string; clientId: string; projects: number[]; releaseAlias?: string }): string {
  const { ownerToken, clientId, projects, releaseAlias } = options;
  const steps = [
    '{',
    `printf '=== rebuild-on-save start %s pid=%s client=%s projects=%s ===\\n' "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" ${shQuote(ownerToken)} ${shQuote(clientId)} ${shQuote(projects.join(',') || '-')};`,
  ];
  if (projects.length > 0) {
    steps.push(`node scripts/runtime/buildProjectsObj.mjs --only ${shQuote(projects.join(','))};`);
  }
  // The alias goes on the build command itself (not exported for the whole chain) so it
  // reaches addNewVersion's parseReleaseAliases and nothing else.
  const aliasPrefix = releaseAlias ? `COLLAB_RELEASE_ALIAS=${shQuote(releaseAlias)} ` : '';
  steps.push(
    `${aliasPrefix}pnpm build -- --client ${shQuote(clientId)} --skip-install --skip-migrate;`,
    'code=$?;',
    `printf '=== rebuild-on-save end %s pid=%s exit=%s ===\\n' "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" ${shQuote(ownerToken)} "$code";`,
    `if [ "$(head -1 ${shQuote(LOCK_PATH)} 2>/dev/null)" = ${shQuote(ownerToken)} ]; then rm -f ${shQuote(LOCK_PATH)}; fi`,
    `} >> ${shQuote(LOG_PATH)} 2>&1 &`,
  );
  return steps.join(' ');
}

function scheduleRetry(delayMs: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(attemptBuild, delayMs);
}

function attemptBuild(): void {
  let fd: number;
  try {
    fd = openSync(LOCK_PATH, 'wx'); // atomic exclusive create — fails with EEXIST if already locked
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      log(`[rebuild-on-save] lock check failed: ${(err as Error).message}`);
      return;
    }
    if (lockIsStale()) {
      log('[rebuild-on-save] stale lock found (holder likely crashed) — clearing and retrying');
      rmSync(LOCK_PATH, { force: true });
      scheduleRetry(50);
      return;
    }
    // Another worker is already building — retry shortly rather than dropping
    // this save; the eventual build (by whichever worker holds the lock) will
    // still pick up everything already written to disk.
    scheduleRetry(RETRY_MS + Math.round(Math.random() * RETRY_JITTER_MS));
    return;
  }

  // The lock's owner token: this worker's pid. Recorded here and checked again
  // by the shell chain's own cleanup step below (NOT via the shell's own `$$`,
  // which would be a different, unrelated pid once reparented).
  const ownerToken = String(process.pid);
  writeSync(fd, `${ownerToken}\n${Date.now()}`);
  closeSync(fd);

  const clientId = String(readProjectsConfig().defaultProjectId);
  mkdirSync(LOGS_DIR, { recursive: true });

  // Claimed here, not in the timer: a worker that loses the lock race re-arms
  // and must still carry its projects into the build that finally runs.
  const projects = [...pendingProjects].sort((a, b) => a - b);
  pendingProjects.clear();

  const chain = buildShellChain({ ownerToken, clientId, projects, releaseAlias: releaseAliasFor(clientId) });
  const launcher = spawn('sh', ['-c', chain], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
  });
  launcher.unref();
}

/**
 * Whether a build is running RIGHT NOW, for anyone asking "did my save land yet?".
 * Read from disk on every call on purpose: unlike the release stamp, this is exactly
 * the kind of state that changes under the process. The lock is created by the worker
 * that wins the race and removed by the build's own shell chain, so it covers builds
 * started by the other pm2 worker too.
 */
export function isRebuildInProgress(): boolean {
  try {
    return statSync(LOCK_PATH).mtimeMs > Date.now() - STALE_LOCK_MS;
  } catch {
    return false; // no lock file = nothing building
  }
}

/**
 * Call after a successful setContents write, with the project it wrote to — its
 * obj is refreshed before the build (see the header). Debounced + safe across
 * the 2 pm2 cluster workers.
 */
export function scheduleRebuildOnSave(project?: number): void {
  if (!isEnabled()) return;
  if (Number.isInteger(project) && (project as number) > 0) pendingProjects.add(project as number);
  if (timer) clearTimeout(timer);
  timer = setTimeout(attemptBuild, DEBOUNCE_MS);
}
