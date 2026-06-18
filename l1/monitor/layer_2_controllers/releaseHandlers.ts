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

// Tail the pm2 logs from the known, fixed location (configured in pm2.config.js).
//
// ADMIN ONLY (operational logs). Gate on an admin check once auth exists.
export const monitorLogsTailHandler: BffHandler = async ({ request }) => {
  const params = (request.params ?? {}) as Record<string, unknown>;
  const stream = params.stream === 'error' ? 'error' : 'out';
  const lines = Math.min(Math.max(Number(params.lines ?? 200), 1), 2000);
  const file = join(LOGS_DIR, stream === 'error' ? 'app-error.log' : 'app-out.log');
  if (!existsSync(file)) {
    return ok({ file, stream, lines: [] as string[] });
  }
  const tail = readFileSync(file, 'utf8').split(/\r?\n/u).slice(-lines);
  return ok({ file, stream, lines: tail });
};
