/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeRebuildOnSave.ts" enhancement="_blank" />
// Triggers a background rebuild+redeploy after a studio save (setContents)
// writes files to disk. writeSources() (cbeSources.ts) only does plain file
// I/O — without this, a save never reaches the running server until someone
// SSHes in and runs `pnpm build` by hand.
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
import { closeSync, mkdirSync, openSync, rmSync, statSync, writeSync } from 'node:fs';
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

  // Everything between `{` and `}` runs as ONE backgrounded job; the outer
  // `sh -c` invocation returns as soon as it has started that job, which is
  // what lets the kernel reparent it to init before any pm2 reload can find it
  // still hanging off this worker's process tree.
  const shellChain = [
    '{',
    `printf '=== rebuild-on-save start %s pid=%s client=%s ===\\n' "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" ${shQuote(ownerToken)} ${shQuote(clientId)};`,
    `pnpm build -- --client ${shQuote(clientId)} --skip-install --skip-migrate;`,
    'code=$?;',
    `printf '=== rebuild-on-save end %s pid=%s exit=%s ===\\n' "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" ${shQuote(ownerToken)} "$code";`,
    `if [ "$(head -1 ${shQuote(LOCK_PATH)} 2>/dev/null)" = ${shQuote(ownerToken)} ]; then rm -f ${shQuote(LOCK_PATH)}; fi`,
    `} >> ${shQuote(LOG_PATH)} 2>&1 &`,
  ].join(' ');

  const launcher = spawn('sh', ['-c', shellChain], { cwd: ROOT, detached: true, stdio: 'ignore' });
  launcher.unref();
}

/** Call after a successful setContents write. Debounced + safe across the 2 pm2 cluster workers. */
export function scheduleRebuildOnSave(): void {
  if (!isEnabled()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(attemptBuild, DEBOUNCE_MS);
}
