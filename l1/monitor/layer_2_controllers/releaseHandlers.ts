/// <mls fileReference="_102034_/l1/monitor/layer_2_controllers/releaseHandlers.ts" enhancement="_blank" />
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { AppError, fail, ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

// ── Runtime layout ───────────────────────────────────────────────────────────
// The server runs with cwd = <base>/current (a symlink to <base>/releases/<id>),
// so the runtime base dir is two levels up. Override with COLLAB_RUNTIME_DIR.
const BASE_DIR = process.env.COLLAB_RUNTIME_DIR ?? resolve(process.cwd(), '..', '..');
const RELEASES_DIR = join(BASE_DIR, 'releases');
const CURRENT_LINK = join(BASE_DIR, 'current');
const LOGS_DIR = join(BASE_DIR, 'logs');
const PM2_CONFIG = join(BASE_DIR, 'pm2.config.js');
const RELEASE_ID_RE = /^\d{14}$/u;
const LOG_APP_RE = /^app\d*$/u;

interface LogTarget {
  app: string;
  file: string;
  updatedAt: string | null;
}

function activeReleaseId(): string | null {
  try {
    return basename(readlinkSync(CURRENT_LINK).replace(/\/+$/u, ''));
  } catch {
    return null;
  }
}

// List available releases (newest first), marking the active one.
//
// ADMIN ONLY. Authentication/authorization is not implemented yet; once it is,
// this handler must reject non-admin callers before returning anything.
export const monitorReleasesListHandler: BffHandler = async () => {
  const active = activeReleaseId();
  if (!existsSync(RELEASES_DIR)) {
    return ok({ active, releases: [] });
  }
  const releases = readdirSync(RELEASES_DIR)
    .filter((name) => RELEASE_ID_RE.test(name))
    .sort()
    .reverse()
    .map((id) => ({
      id,
      active: id === active,
      createdAt: statSync(join(RELEASES_DIR, id)).mtime.toISOString(),
    }));
  return ok({ active, releases });
};

// Activate (deploy or rollback to) a release: repoint the "current" symlink and
// reload pm2 (cluster -> graceful, no downtime).
//
// ADMIN ONLY. Sensitive: it changes what the whole runtime serves. Authentication
// is not implemented yet; gate this on an admin check once it exists.
export const monitorReleasesActivateHandler: BffHandler = async ({ request }) => {
  const params = (request.params ?? {}) as Record<string, unknown>;
  const releaseId = String(params.releaseId ?? '');
  if (!RELEASE_ID_RE.test(releaseId)) {
    return fail(new AppError('INVALID_RELEASE_ID', 'releaseId must be yyyyMMddHHmmss', 400));
  }
  const target = join(RELEASES_DIR, releaseId);
  if (!existsSync(target)) {
    return fail(new AppError('RELEASE_NOT_FOUND', `Release ${releaseId} not found`, 404));
  }
  // Atomic symlink swap (fast), then reload pm2 detached so this request can
  // return before the worker handling it is recycled by the reload.
  execFileSync('ln', ['-sfn', target, CURRENT_LINK]);
  spawn('pm2', ['startOrReload', PM2_CONFIG, '--update-env'], { detached: true, stdio: 'ignore' }).unref();
  return ok({ active: releaseId, reload: 'scheduled' });
};

function listLogTargets(stream: 'out' | 'error'): LogTarget[] {
  if (!existsSync(LOGS_DIR)) {
    return [];
  }
  return readdirSync(LOGS_DIR)
    .filter((name) => name.endsWith(`-${stream}.log`))
    .map((name) => {
      const file = join(LOGS_DIR, name);
      const stats = statSync(file);
      return {
        app: name.slice(0, -`-${stream}.log`.length),
        file,
        updatedAt: stats.mtime.toISOString(),
        mtimeMs: stats.mtimeMs,
      };
    })
    .filter((target) => LOG_APP_RE.test(target.app))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.app.localeCompare(b.app))
    .map(({ mtimeMs: _mtimeMs, ...target }) => target);
}

function selectLogTarget(stream: 'out' | 'error', requestedApp: unknown): { target: LogTarget; available: LogTarget[] } {
  const available = listLogTargets(stream);
  const app = typeof requestedApp === 'string' && LOG_APP_RE.test(requestedApp) ? requestedApp : '';
  const requested = app ? available.find((target) => target.app === app) : null;
  if (requested) {
    return { target: requested, available };
  }
  if (app) {
    const target = { app, file: join(LOGS_DIR, `${app}-${stream}.log`), updatedAt: null };
    return {
      target,
      available: [target, ...available],
    };
  }
  const newestProjectLog = available.find((target) => /^app\d+$/u.test(target.app));
  const fallback = newestProjectLog ?? available[0] ?? { app: 'app', file: join(LOGS_DIR, `app-${stream}.log`), updatedAt: null };
  return { target: fallback, available };
}

// Tail pm2 logs. New collab-sites publishes create per-project pm2 apps
// (app2051-out.log, app2048-error.log, ...); app-out.log is only the legacy
// runtime process and can be stale for project publishes.
//
// ADMIN ONLY (operational logs). Gate on an admin check once auth exists.
export const monitorLogsTailHandler: BffHandler = async ({ request }) => {
  const params = (request.params ?? {}) as Record<string, unknown>;
  const stream = params.stream === 'error' ? 'error' : 'out';
  const lines = Math.min(Math.max(Number(params.lines ?? 200), 1), 2000);
  const { target, available } = selectLogTarget(stream, params.app);
  if (!existsSync(target.file)) {
    return ok({ ...target, stream, available, lines: [] as string[] });
  }
  const tail = readFileSync(target.file, 'utf8').split(/\r?\n/u).slice(-lines);
  return ok({ ...target, stream, available, lines: tail });
};
