/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.ts" enhancement="_blank" />
// One Deno dev process per studio draft. The import map is per process, so
// reloading a draft means killing that process and starting another — an ES
// module cannot be unloaded. Production only starts and stops it (reparented
// shell, same reason as cbeRebuildOnSave: pm2 kills the worker's process tree).

import { spawnSync } from 'node:child_process';
import {
  closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync,
  readFileSync, rmSync, statSync, symlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { parseDraftSlug } from '/_102034_/l1/server/layer_1_external/cbe/cbeDraft.js';
import {
  DEFAULT_PROJECT_MODE,
  isProjectMode,
  isTestMode,
  parseDatabaseUrl,
  type ProjectMode,
} from '/_102034_/l1/server/layer_1_external/config/projectMode.js';

const IDLE_MS = 30 * 60 * 1000;
const RESTART_DEBOUNCE_MS = 1000;
const DEFAULT_PORT_RANGE = '4100-4199';
const DEFAULT_MAX = 8;
const LOCK_RETRIES = 40;
const LOCK_RETRY_MS = 50;

/** Keys `readAppEnv` touches in memory mode. `readEnvValue` reads `KEY_<APP_ENV>` first. No `DATABASE_URL`. */
const MEMORY_ENV_KEYS = [
  'RUNTIME_MODE',
  'WRITE_BEHIND_ENABLED',
  'TICK_ENABLED',
  'PORT',
  'PGHOST',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'LOG_LEVEL',
  'TESTS_ENABLED',
  'PROJECT_ID',
  'COLLAB_PROJECT_ID',
  'PROJECT_DOMAIN',
  'DOMAIN',
  'STUDIO_ENABLED',
  'ACTIVE_COMPANY_ID',
  'ACTIVE_UNIT_ID',
  'CURRENT_WORKSPACE_ID',
  'WORKSPACE_ID',
  'ACTOR_ID',
  'ACTOR_SCOPE',
  'ORGANIZATION_COUNTRY_CODE',
  'COUNTRY_CODE',
  'ORGANIZATION_CURRENCY',
  'ORGANIZATION_TIMEZONE',
  'S3_BUCKET',
  'S3_BUCKET_TMP',
  'ATTACHMENT_MAX_BYTES',
  'ATTACHMENT_ALLOWED_MIME',
  'ATTACHMENT_LOCAL_DIR',
  'REDIS_URL',
  'IDENTITY_CACHE_TTL_SECONDS',
] as const;

/** Env names read outside `env.ts` (lima: boot + `loadPatients`). No `_DEVELOPMENT` suffix. */
const EXTRA_ENV_KEYS = [
  'AUTH_JWT_ENABLED',
  'AWS_LAMBDA_BENCHMARK_MODE',
  'AWS_LAMBDA_NODEJS_NO_GLOBAL_AWSLAMBDA',
  'AWS_NEW_RETRIES_2026',
  'BFF_ACTORS_ENFORCED',
  'BFF_JWT_ENABLED',
  'CANDIDATE_HUB',
  'CANDIDATE_ORIGIN',
  'CBE_LATEST_URL',
  'CBE_PROJECTS_DIR',
  'CBE_STATIC_DIR',
  'CBE_STATIC_ORIGIN',
  'CBE_TEST_LOGIN_USER',
  'COLLAB_AUTH_BASE_URL',
  'COLLAB_AUTH_ISSUER',
  'COLLAB_AUTH_JWKS_TIMEOUT_MS',
  'COLLAB_AUTH_JWKS_URL',
  'COLLAB_GIT_HTTP_ENABLED',
  'COLLAB_GIT_PROJECT_ROOT',
  'COLLAB_REBUILD_DEBOUNCE_MS',
  'COLLAB_RUNTIME_MODE',
  'COLLAB_DRAFT',
  'MSG_PROXY_ENABLED',
  'MSG_PROXY_TARGET',
  'MSG_PROXY_TOKEN',
  'NODE_PG_FORCE_NATIVE',
  'SMITHY_NEW_RETRIES_2026',
  'USER',
] as const;

export class AncestorDenoConfigError extends Error {}

export class DraftDatabaseError extends Error {}

const DRAFT_DATABASE_PREFIX = 'collab_app_draft_';
const DRAFT_DATABASE_MAX = 40;

function draftDatabaseName(slug: string): string {
  const normalized = slug.toLowerCase().replace(/[^a-z0-9]/gu, '_');
  return `${DRAFT_DATABASE_PREFIX}${normalized}`.slice(0, DRAFT_DATABASE_MAX);
}

/** Parent test URL with only the database name swapped for this draft. Invalid URL throws. */
export function draftDatabaseUrl(testUrl: string, slug: string): string {
  if (!parseDatabaseUrl(testUrl)) {
    console.error('[cbe] dev database url is invalid');
    throw new Error('invalid database url');
  }
  const url = new URL(testUrl);
  url.pathname = `/${draftDatabaseName(slug)}`;
  return url.toString();
}

function postgresHostPort(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (!url.hostname) {
    console.error('[cbe] dev database url has no host');
    throw new Error('invalid database url');
  }
  return `${url.hostname}:${url.port || '5432'}`;
}

/** `appEnv` of the draft worktree. Absent or invalid falls back to `presentation`, same as `readProjectMode`. */
function readDraftProjectMode(draftDir: string, clientProjectId: number): ProjectMode {
  const path = join(draftDir, `mls-${clientProjectId}`, 'l5', 'project.json');
  try {
    if (!existsSync(path)) {
      console.warn(`[cbe] dev project mode: l5/project.json not found at ${path}; assuming '${DEFAULT_PROJECT_MODE}'`);
      return DEFAULT_PROJECT_MODE;
    }
    const value = (JSON.parse(readFileSync(path, 'utf8')) as { appEnv?: unknown }).appEnv;
    if (isProjectMode(value)) return value;
    if (value === undefined) {
      console.warn(`[cbe] dev project mode: ${path} declares no appEnv; assuming '${DEFAULT_PROJECT_MODE}'`);
    } else {
      console.warn(`[cbe] dev project mode: ${path} declares appEnv='${String(value)}', which is not a project mode; assuming '${DEFAULT_PROJECT_MODE}'`);
    }
    return DEFAULT_PROJECT_MODE;
  } catch (error) {
    console.warn(`[cbe] dev project mode: could not read ${path} (${error instanceof Error ? error.message : String(error)}); assuming '${DEFAULT_PROJECT_MODE}'`);
    return DEFAULT_PROJECT_MODE;
  }
}

export function findAncestorDenoConfig(
  draftDir: string,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  let dir = dirname(draftDir);
  while (true) {
    for (const name of ['deno.json', 'deno.jsonc']) {
      const candidate = join(dir, name);
      if (exists(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export interface DevProcessInfo {
  port: number;
  pid: number;
  startedAt: number;
  lastRequestAt: number;
  /** Draft database name. Present on records written when the process starts. */
  database?: string;
}

export interface DevSpawnOptions {
  cwd: string;
  env: Record<string, string>;
  logPath: string;
}

export type DevSpawn = (command: string, args: string[], options: DevSpawnOptions) => { pid: number };

export interface EnsureDevProcessOpts {
  base: string;
  slug: string;
  clientProjectId: number;
  spawn?: DevSpawn;
  now?: () => number;
  writeConfig?: (input: { base: string; slug: string; clientProjectId: number }) => void;
}

interface PendingRestart {
  timer: ReturnType<typeof setTimeout>;
  waiters: Array<{
    resolve: (info: DevProcessInfo) => void;
    reject: (err: unknown) => void;
  }>;
}

const pendingRestarts = new Map<string, PendingRestart>();

export function memoryModeAllowEnv(): string[] {
  const names = ['APP_ENV'];
  for (const key of MEMORY_ENV_KEYS) {
    names.push(`${key}_DEVELOPMENT`, key);
  }
  names.push(...EXTRA_ENV_KEYS);
  return [...new Set(names)];
}

export function buildDenoArgs(base: string, slug: string, port: number, databaseUrl: string): string[] {
  const draftDir = draftDirOf(base, slug);
  const allowEnv = memoryModeAllowEnv();
  allowEnv.push('DATABASE_URL_TEST');
  return [
    'run',
    `--allow-read=${base},${draftDir}`,
    `--allow-env=${allowEnv.join(',')}`,
    `--allow-net=0.0.0.0:${port},127.0.0.1,${postgresHostPort(databaseUrl)}`,
    '--allow-sys=networkInterfaces',
    '--config',
    join(draftDir, 'deno.json'),
    '--node-modules-dir=manual',
    '--no-lock',
    join(base, 'mls-102034', 'l1', 'server', 'layer_1_external', 'transport', 'http', 'startServer.ts'),
  ];
}

function shQuote(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function draftKey(base: string, slug: string): string {
  return `${base}\0${slug}`;
}

function draftDirOf(base: string, slug: string): string {
  return join(base, 'drafts', slug);
}

function devJsonPath(base: string, slug: string): string {
  return join(draftDirOf(base, slug), 'dev.json');
}

function lockPathOf(base: string, slug: string): string {
  return join(base, `.dev-${slug}.lock`);
}

function assertSlug(slug: string): void {
  if (!parseDraftSlug(slug)) {
    console.error(`[cbe] dev slug invalid: ${slug}`);
    throw new Error(`dev slug invalid: ${slug}`);
  }
}

function errnoCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined;
}

export function isDevPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return errnoCode(err) === 'EPERM';
  }
}

function killDevPid(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    if (errnoCode(err) === 'ESRCH') return;
    console.error(`[cbe] dev kill ${pid} failed: ${(err as Error).message}`);
    throw err;
  }
}

function readDevJson(path: string): DevProcessInfo | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as DevProcessInfo;
    if (!Number.isInteger(parsed.pid) || !Number.isInteger(parsed.port)) {
      console.error(`[cbe] dev.json missing pid/port at ${path}`);
      return null;
    }
    return parsed;
  } catch (err) {
    console.error(`[cbe] dev.json unreadable at ${path}: ${(err as Error).message}`);
    return null;
  }
}

interface ListedDev {
  slug: string;
  path: string;
  record: DevProcessInfo;
}

function listDevRecords(base: string): ListedDev[] {
  const drafts = join(base, 'drafts');
  if (!existsSync(drafts)) return [];
  const listed: ListedDev[] = [];
  for (const slug of readdirSync(drafts)) {
    if (!parseDraftSlug(slug)) continue;
    const path = devJsonPath(base, slug);
    const record = readDevJson(path);
    if (record) listed.push({ slug, path, record });
  }
  return listed;
}

function parsePortRange(): { start: number; end: number } {
  const value = process.env.COLLAB_DEV_PORT_RANGE?.trim() || DEFAULT_PORT_RANGE;
  const match = /^(\d+)-(\d+)$/u.exec(value);
  const start = match ? Number(match[1]) : NaN;
  const end = match ? Number(match[2]) : NaN;
  if (!match || start > end || start < 1 || end > 65535) {
    console.error(`[cbe] invalid COLLAB_DEV_PORT_RANGE: ${value}`);
    throw new Error(`invalid COLLAB_DEV_PORT_RANGE: ${value}`);
  }
  return { start, end };
}

function devMax(): number {
  const raw = process.env.COLLAB_DEV_MAX;
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX;
  const max = Number(raw);
  if (!Number.isInteger(max) || max < 1) {
    console.error(`[cbe] invalid COLLAB_DEV_MAX: ${raw}`);
    throw new Error(`invalid COLLAB_DEV_MAX: ${raw}`);
  }
  return max;
}

function choosePort(base: string, slug: string): number {
  const { start, end } = parsePortRange();
  const used = new Set<number>();
  for (const entry of listDevRecords(base)) {
    if (entry.slug === slug) continue;
    if (isDevPidAlive(entry.record.pid)) used.add(entry.record.port);
  }
  for (let port = start; port <= end; port += 1) {
    if (!used.has(port)) return port;
  }
  console.error(`[cbe] dev ${slug}: no free port in ${start}-${end}`);
  throw new Error(`no free port in ${start}-${end}`);
}

function copyReleaseConfig(base: string, slug: string): void {
  const src = join(base, 'config.json');
  const dest = join(draftDirOf(base, slug), 'config.json');
  if (!existsSync(src)) {
    console.error(`[cbe] dev ${slug}: release config.json missing at ${src}`);
    throw new Error(`release config.json missing at ${src}`);
  }
  mkdirSync(draftDirOf(base, slug), { recursive: true });
  copyFileSync(src, dest);
}

const MLS_PROJECT_DIR = /^mls-\d+$/;

export function linkSharedProjects(base: string, slug: string, clientProjectId: number): void {
  const draftDir = draftDirOf(base, slug);
  mkdirSync(draftDir, { recursive: true });
  const clientName = `mls-${clientProjectId}`;
  let entries;
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch (err) {
    console.error(`[cbe] dev ${slug}: cannot list ${base}: ${(err as Error).message}`);
    return;
  }
  for (const entry of entries) {
    if (!MLS_PROJECT_DIR.test(entry.name) || entry.name === clientName) continue;
    const source = join(base, entry.name);
    try {
      if (!statSync(source).isDirectory()) continue;
    } catch (err) {
      console.error(`[cbe] dev ${slug}: ${entry.name} is not a readable directory: ${(err as Error).message}`);
      continue;
    }
    const dest = join(draftDir, entry.name);
    try {
      const existing = lstatSync(dest);
      if (existing.isSymbolicLink()) continue;
      console.warn(`[cbe] dev ${slug}: ${entry.name} is a real path, not linking`);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        console.error(`[cbe] dev ${slug}: ${entry.name}: ${(err as Error).message}`);
        continue;
      }
      try {
        symlinkSync(`../../${entry.name}`, dest);
      } catch (linkErr) {
        console.error(`[cbe] dev ${slug}: failed to link ${entry.name}: ${(linkErr as Error).message}`);
      }
    }
  }
}

function childEnv(port: number, slug: string, clientProjectId: number, databaseUrlTest: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    APP_ENV: 'development',
    PORT: String(port),
    RUNTIME_MODE: 'postgres',
    DATABASE_URL_TEST: databaseUrlTest,
    COLLAB_DRAFT: slug,
    COLLAB_PROJECT_ID: String(clientProjectId),
  };
}

function defaultWriteConfig(input: { base: string; slug: string; clientProjectId: number }): void {
  const script = join(input.base, 'scripts', 'runtime', 'denoDraftConfig.mjs');
  if (!existsSync(script)) {
    console.error(`[cbe] dev ${input.slug}: deno config script missing at ${script}`);
    throw new Error(`deno config script missing at ${script}`);
  }
  const result = spawnSync(process.execPath, [
    script,
    input.base,
    input.slug,
    String(input.clientProjectId),
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || `exit ${result.status}`).trim();
    console.error(`[cbe] dev ${input.slug}: write deno.json failed: ${detail}`);
    throw new Error(`write deno.json failed: ${detail}`);
  }
}

/** Background the real process and let `sh` exit so the kernel reparents it to init. */
function defaultDevSpawn(command: string, args: string[], options: DevSpawnOptions): { pid: number } {
  mkdirSync(dirname(options.logPath), { recursive: true });
  const cmdline = [command, ...args].map(shQuote).join(' ');
  const script = `${cmdline} >> ${shQuote(options.logPath)} 2>&1 & echo $!`;
  const result = spawnSync('sh', ['-c', script], {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status}`).trim();
    console.error(`[cbe] dev spawn failed: ${detail}`);
    throw new Error(`dev spawn failed: ${detail}`);
  }
  const pid = Number(String(result.stdout).trim().split('\n').pop());
  if (!Number.isInteger(pid) || pid <= 0) {
    console.error(`[cbe] dev spawn returned no pid: ${result.stdout}`);
    throw new Error('dev spawn returned no pid');
  }
  return { pid };
}

function lockIsStale(path: string): boolean {
  try {
    const pid = Number(readFileSync(path, 'utf8').split('\n')[0]);
    return !isDevPidAlive(pid);
  } catch (err) {
    console.error(`[cbe] dev lock read failed at ${path}: ${(err as Error).message}`);
    return true;
  }
}

function acquireLock(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, `${process.pid}\n${Date.now()}`);
      closeSync(fd);
      return;
    } catch (err) {
      if (errnoCode(err) !== 'EEXIST') {
        console.error(`[cbe] dev lock failed at ${path}: ${(err as Error).message}`);
        throw err;
      }
      if (lockIsStale(path)) {
        rmSync(path, { force: true });
        continue;
      }
      sleepMs(LOCK_RETRY_MS);
    }
  }
  console.error(`[cbe] dev lock busy: ${path}`);
  throw new Error(`dev lock busy: ${path}`);
}

function releaseLock(path: string): void {
  try {
    if (!existsSync(path)) return;
    const owner = readFileSync(path, 'utf8').split('\n')[0];
    if (owner === String(process.pid)) rmSync(path, { force: true });
  } catch (err) {
    console.error(`[cbe] dev lock release failed at ${path}: ${(err as Error).message}`);
  }
}

function withLock<T>(base: string, slug: string, fn: () => T): T {
  const path = lockPathOf(base, slug);
  acquireLock(path);
  try {
    return fn();
  } finally {
    releaseLock(path);
  }
}

function stopDevUnlocked(base: string, slug: string): void {
  const path = devJsonPath(base, slug);
  const record = readDevJson(path);
  if (!record) {
    if (existsSync(path)) rmSync(path, { force: true });
    return;
  }
  if (isDevPidAlive(record.pid)) killDevPid(record.pid);
  rmSync(path, { force: true });
}

function ensureUnlocked(opts: EnsureDevProcessOpts): DevProcessInfo {
  const { base, slug, clientProjectId } = opts;
  const now = opts.now ?? (() => Date.now());
  copyReleaseConfig(base, slug);
  linkSharedProjects(base, slug, clientProjectId);
  const path = devJsonPath(base, slug);
  const existing = readDevJson(path);
  if (existing && isDevPidAlive(existing.pid)) return existing;
  if (existsSync(path)) rmSync(path, { force: true });

  const draftDir = draftDirOf(base, slug);
  const ancestor = findAncestorDenoConfig(draftDir);
  if (ancestor) {
    const message = `ancestor deno config: ${ancestor}`;
    console.error(`[cbe] dev ${slug}: ${message}`);
    throw new AncestorDenoConfigError(message);
  }

  const mode = readDraftProjectMode(draftDir, clientProjectId);
  if (!isTestMode(mode)) {
    const message = `project mode ${mode} is not a test mode`;
    console.error(`[cbe] dev ${slug}: ${message}`);
    throw new DraftDatabaseError(message);
  }
  const testUrl = process.env.DATABASE_URL_TEST;
  if (!testUrl) {
    const message = 'DATABASE_URL_TEST is not set';
    console.error(`[cbe] dev ${slug}: ${message}`);
    throw new DraftDatabaseError(message);
  }
  const databaseUrl = draftDatabaseUrl(testUrl, slug);
  const database = new URL(databaseUrl).pathname.replace(/^\//u, '');

  const writeConfig = opts.writeConfig ?? defaultWriteConfig;
  writeConfig({ base, slug, clientProjectId });

  const port = choosePort(base, slug);
  const logPath = join(base, 'logs', `dev-${slug}.log`);
  mkdirSync(join(base, 'logs'), { recursive: true });
  const spawn = opts.spawn ?? defaultDevSpawn;
  const spawned = spawn('deno', buildDenoArgs(base, slug, port, databaseUrl), {
    cwd: draftDir,
    env: childEnv(port, slug, clientProjectId, databaseUrl),
    logPath,
  });
  if (!Number.isInteger(spawned.pid) || spawned.pid <= 0) {
    console.error(`[cbe] dev ${slug}: spawn returned no pid`);
    throw new Error('dev spawn returned no pid');
  }
  const record: DevProcessInfo = {
    port,
    pid: spawned.pid,
    startedAt: now(),
    lastRequestAt: now(),
    database,
  };
  try {
    writeFileSync(path, `${JSON.stringify(record)}\n`);
  } catch (err) {
    console.error(`[cbe] dev ${slug}: failed to write ${path}: ${(err as Error).message}`);
    killDevPid(spawned.pid);
    throw err;
  }
  return record;
}

export function ensureDevProcess(opts: EnsureDevProcessOpts): DevProcessInfo {
  assertSlug(opts.slug);
  return withLock(opts.base, opts.slug, () => ensureUnlocked(opts));
}

/** Stops the draft dev process. `dev.json` is removed, so the database name is not read from it. */
export function stopDevProcess(base: string, slug: string): void {
  assertSlug(slug);
  withLock(base, slug, () => stopDevUnlocked(base, slug));
}

export function restartDevProcess(opts: EnsureDevProcessOpts): Promise<DevProcessInfo> {
  assertSlug(opts.slug);
  const key = draftKey(opts.base, opts.slug);
  return new Promise((resolve, reject) => {
    const prev = pendingRestarts.get(key);
    if (prev) clearTimeout(prev.timer);
    const waiters = prev?.waiters ?? [];
    waiters.push({ resolve, reject });
    const timer = setTimeout(() => {
      pendingRestarts.delete(key);
      try {
        const info = withLock(opts.base, opts.slug, () => {
          stopDevUnlocked(opts.base, opts.slug);
          return ensureUnlocked(opts);
        });
        for (const waiter of waiters) waiter.resolve(info);
      } catch (err) {
        console.error(`[cbe] dev restart ${opts.slug} failed: ${(err as Error).message}`);
        for (const waiter of waiters) waiter.reject(err);
      }
    }, RESTART_DEBOUNCE_MS);
    pendingRestarts.set(key, { timer, waiters });
  });
}

function byIdleness(a: ListedDev, b: ListedDev): number {
  return a.record.lastRequestAt - b.record.lastRequestAt || a.slug.localeCompare(b.slug);
}

export function reapIdle(opts: { base: string; now: number }): void {
  const idle = listDevRecords(opts.base)
    .filter((entry) => opts.now - entry.record.lastRequestAt >= IDLE_MS);
  for (const entry of idle) {
    if (!parseDraftSlug(entry.slug)) continue;
    withLock(opts.base, entry.slug, () => stopDevUnlocked(opts.base, entry.slug));
  }

  let alive = listDevRecords(opts.base).filter((entry) => isDevPidAlive(entry.record.pid));
  const max = devMax();
  while (alive.length > max) {
    alive.sort(byIdleness);
    const victim = alive[0];
    withLock(opts.base, victim.slug, () => stopDevUnlocked(opts.base, victim.slug));
    alive = listDevRecords(opts.base).filter((entry) => isDevPidAlive(entry.record.pid));
  }
}

const DEV_READY_TIMEOUT_MS = 10_000;
const DEV_READY_STEP_MS = 250;

export interface WaitForDevReadyOpts {
  timeoutMs?: number;
  stepMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls `GET /health` on the dev port until a 2xx or the deadline.
 * A network error retries. Never throws.
 */
export async function waitForDevReady(port: number, opts?: WaitForDevReadyOpts): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? DEV_READY_TIMEOUT_MS;
  const stepMs = opts?.stepMs ?? DEV_READY_STEP_MS;
  const doFetch = opts?.fetchImpl ?? fetch;
  const sleep = opts?.sleep ?? delayMs;
  const url = `http://127.0.0.1:${port}/health`;
  let elapsed = 0;
  try {
    while (elapsed < timeoutMs) {
      const started = Date.now();
      try {
        const response = await doFetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(stepMs * 4),
        });
        if (response.status >= 200 && response.status < 300) return true;
      } catch {
        // The process is still binding the port. Try again until the deadline.
      }
      elapsed += Date.now() - started;
      if (elapsed >= timeoutMs) break;
      const pause = Math.min(stepMs, timeoutMs - elapsed);
      if (pause <= 0) break;
      const sleepStarted = Date.now();
      await sleep(pause);
      elapsed += Math.max(pause, Date.now() - sleepStarted);
    }
  } catch (err) {
    console.error(`[cbe] dev port ${port} ready check failed: ${(err as Error).message}`);
    return false;
  }
  console.error(`[cbe] dev port ${port} not ready after ${timeoutMs}ms`);
  return false;
}

/** Rewrites `lastRequestAt`. No-op when `dev.json` is absent. `restart`/`ensure` already stamp it. */
export function touchDevProcess(base: string, slug: string, now: number): void {
  assertSlug(slug);
  withLock(base, slug, () => {
    const path = devJsonPath(base, slug);
    const record = readDevJson(path);
    if (!record) return;
    const next: DevProcessInfo = { ...record, lastRequestAt: now };
    writeFileSync(path, `${JSON.stringify(next)}\n`);
  });
}

const devReapers = new Map<string, ReturnType<typeof setInterval>>();

/** One idle sweep per base. The first draft save in this worker arms it. */
export function ensureDevReaper(base: string): void {
  if (devReapers.has(base)) return;
  const timer = setInterval(() => {
    try {
      reapIdle({ base, now: Date.now() });
    } catch (err) {
      console.error(`[cbe] dev reaper failed for ${base}: ${(err as Error).message}`);
    }
  }, 60_000);
  timer.unref();
  devReapers.set(base, timer);
}
