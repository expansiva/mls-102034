/// <mls fileReference="_102034_/l1/server/layer_1_external/config/projectMode.ts" enhancement="_blank" />
// The MODE a published project runs in, and what follows from it (which database, who may write).
//
// NAME, deliberately not `appEnv` in code: `AppEnv.appEnv` already exists here and means something else —
// the deployment environment of this SERVER (`development | staging | production`, from `APP_ENV`), which
// drives storage config and the persistence engine. One server hosts several projects, and each project
// carries its own mode in its `l5/project.json`. Two different scopes, so two different names; the
// canonical definition of both is `docs/appEnvAndAuth.md`.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveProjectDistPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';

export type ProjectMode = 'production' | 'homologation' | 'development' | 'presentation';

const MODES: readonly ProjectMode[] = ['production', 'homologation', 'development', 'presentation'];

/** A generated module is born in `presentation`; anything unreadable falls back to it, loudly. */
export const DEFAULT_PROJECT_MODE: ProjectMode = 'presentation';

const warned = new Set<string>();
const cache = new Map<string, ProjectMode>();

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

export function isProjectMode(value: unknown): value is ProjectMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

/** Test modes run against the TEST database and may be written to by the test runner. */
export function isTestMode(mode: ProjectMode): boolean {
  return mode === 'development' || mode === 'presentation';
}

/**
 * The mode declared by `l5/project.json` of a project. Absent or invalid ⇒ `presentation` with a warning:
 * defaulting to production would point a freshly generated module at real data, which is the one mistake
 * this whole concept exists to prevent.
 */
/**
 * Did the project DECLARE its mode, or is it running on the default?
 *
 * The difference decides whether a missing `DATABASE_URL_TEST` is a failure: a project that explicitly
 * says `presentation` and has no test connection string is misconfigured and must say so; a project that
 * declared nothing at all is simply older than the modes, and breaking its boot over a default would be
 * this feature's worst outcome.
 */
export function hasDeclaredProjectMode(projectId?: string | number): boolean {
  return declared.get(String(projectId ?? 'local')) === true;
}

const declared = new Map<string, boolean>();

export function readProjectMode(projectId?: string | number): ProjectMode {
  const key = String(projectId ?? 'local');
  const cached = cache.get(key);
  if (cached) return cached;
  let mode: ProjectMode = DEFAULT_PROJECT_MODE;
  try {
    const path = projectId
      ? resolveProjectDistPath(`_${projectId}_/l5/project.json`)
      : resolve(process.cwd(), 'l5', 'project.json');
    if (!existsSync(path)) {
      warnOnce(`missing:${key}`, `[projectMode] l5/project.json not found for project ${key}; assuming '${DEFAULT_PROJECT_MODE}'`);
    } else {
      const value = (JSON.parse(readFileSync(path, 'utf8')) as { appEnv?: unknown }).appEnv;
      if (isProjectMode(value)) { mode = value; declared.set(key, true); }
      else if (value === undefined) {
        warnOnce(`absent:${key}`, `[projectMode] project ${key} declares no appEnv; assuming '${DEFAULT_PROJECT_MODE}'`);
      } else {
        warnOnce(`invalid:${key}`, `[projectMode] project ${key} declares appEnv='${String(value)}', which is not one of ${MODES.join(' | ')}; assuming '${DEFAULT_PROJECT_MODE}'`);
      }
    }
  } catch (error) {
    warnOnce(`error:${key}`, `[projectMode] could not read the mode of project ${key} (${error instanceof Error ? error.message : String(error)}); assuming '${DEFAULT_PROJECT_MODE}'`);
  }
  cache.set(key, mode);
  return mode;
}

/** Which env var holds the connection string for this mode. */
export function databaseUrlEnvFor(mode: ProjectMode): 'DATABASE_URL' | 'DATABASE_URL_TEST' {
  return isTestMode(mode) ? 'DATABASE_URL_TEST' : 'DATABASE_URL';
}

/**
 * The connection string for a mode — and a LEGIBLE failure when a test mode has none.
 *
 * Falling back to `DATABASE_URL` here would be the worst possible bug of this feature: a presentation
 * module quietly writing curated seeds over production data. So the absence is an error, not a default.
 */
export function resolveDatabaseUrl(mode: ProjectMode): string {
  const name = databaseUrlEnvFor(mode);
  const value = process.env[name];
  if (value) return value;
  if (isTestMode(mode)) {
    throw new Error(
      `${name} is not set, and appEnv='${mode}' must run against the TEST database. `
      + 'Create the test database and set the variable; the production connection string is never used as a fallback.',
    );
  }
  throw new Error(`${name} is not set, and appEnv='${mode}' requires it.`);
}

/**
 * Create the TEST database when it does not exist yet.
 *
 * "Nothing manual per project": provisioning a generated app flows through the publish, so a test mode
 * that points at a database nobody created should create it instead of demanding an SSH session. Only the
 * DATABASE is created — the schema is the bootstrap's job — and only in a test mode: nobody
 * auto-provisions production. Returns what happened, so the caller can log it; a missing privilege is
 * reported, not swallowed, because then the legible failure IS the answer.
 */
export async function ensureTestDatabase(
  mode: ProjectMode,
  connect: (adminUrl: string) => Promise<{
    exists: (database: string) => Promise<boolean>;
    create: (database: string) => Promise<void>;
    end: () => Promise<void>;
  }>,
): Promise<{ created: boolean; database: string; reason: string }> {
  if (!isTestMode(mode)) return { created: false, database: '', reason: 'not-a-test-mode' };
  const url = process.env[databaseUrlEnvFor(mode)];
  if (!url) return { created: false, database: '', reason: 'no-connection-string' };
  const parsed = parseDatabaseUrl(url);
  if (!parsed) return { created: false, database: '', reason: 'unparseable-connection-string' };
  const admin = await connect(parsed.adminUrl);
  try {
    if (await admin.exists(parsed.database)) return { created: false, database: parsed.database, reason: 'already-exists' };
    await admin.create(parsed.database);
    return { created: true, database: parsed.database, reason: 'created' };
  } finally {
    await admin.end();
  }
}

/** The database name of a connection string, plus the same string pointed at `postgres` (admin). */
export function parseDatabaseUrl(url: string): { database: string; adminUrl: string } | null {
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//u, '');
    if (!database) return null;
    const admin = new URL(url);
    admin.pathname = '/postgres';
    return { database, adminUrl: admin.toString() };
  } catch {
    return null;
  }
}

export interface WriteAttempt {
  /** Where the request came from — the transport stamps it; `test` is the monitor runner. */
  source?: 'http' | 'message' | 'test';
  /** The routine's command segment (`cmdCreateClient`, `qryListClient`). */
  command?: string;
}

/**
 * May this request write? The SERVER half of the two defences.
 *
 * The runner is supposed to keep its destructive suite for test modes, but "supposed to" is what let a
 * production run write junk once. The generated vocabulary makes the check deterministic: `cmd*` mutates,
 * `qry*` reads. A read-only smoke from the runner stays allowed everywhere, which is what makes production
 * still observable.
 */
export function refuseTestWrite(mode: ProjectMode, attempt: WriteAttempt): string {
  if (attempt.source !== 'test') return '';
  if (isTestMode(mode)) return '';
  if (!/^cmd/u.test(attempt.command ?? '')) return '';
  return `appEnv='${mode}' refuses a write from the test runner (${attempt.command}). `
    + 'The destructive suite runs only in development or presentation; production and homologation accept read-only smoke.';
}
