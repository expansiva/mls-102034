/// <mls fileReference="_102034_/l1/server/layer_1_external/data/postgres/pg.ts" enhancement="_blank" />
import { Pool, types, type PoolClient } from 'pg';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import {
  databaseUrlEnvFor, hasDeclaredProjectMode, readProjectMode, resolveDatabaseUrl,
} from '/_102034_/l1/server/layer_1_external/config/projectMode.js';

// Platform row contract: DATE/TIMESTAMP/TIMESTAMPTZ columns arrive as ISO-8601 STRINGS, never Date
// objects — matching the memory runtime (seed rows) and the generated Row interfaces, whose code does
// string ops on them (localeCompare/slice; lesson run 2026-07-16 cafeFlow viewKitchenBoard 500).
// node-pg's default parsers return Date; override by type OID: 1082 date, 1114 timestamp, 1184 timestamptz.
types.setTypeParser(1082, (value) => value); // date: keep 'YYYY-MM-DD' verbatim
types.setTypeParser(1114, (value) => new Date(`${value}Z`).toISOString()); // timestamp: stored as UTC
types.setTypeParser(1184, (value) => new Date(value).toISOString()); // timestamptz

let sharedPool: Pool | null = null;

/**
 * WHICH DATABASE — the project's mode decides, when it has been given the means to.
 *
 * A project in `development`/`presentation` must talk to the TEST database, never to production: that is
 * the whole point of the modes. The connection string for it lives in `DATABASE_URL_TEST`.
 *
 * Two behaviours on purpose, so the order of operations stops mattering:
 * - the env EXISTS ⇒ the mode decides, and a test mode connects to the test database;
 * - the env does NOT exist ⇒ the legacy `PGHOST/PGDATABASE/...` path, exactly as before. A server that
 *   has not been given the variable yet keeps booting; when it is given one, the new behaviour turns
 *   itself on with no code change.
 *
 * The one thing that never happens is a test mode silently connecting to production: if the mode is a test
 * mode and `DATABASE_URL_TEST` is absent while `DATABASE_URL` is present, that is a legible failure, not a
 * fallback (`resolveDatabaseUrl`).
 */
function poolConfigFor(env: AppEnv): { connectionString: string } | {
  host: string; port: number; database: string; user: string; password: string;
} {
  const mode = readProjectMode(env.projectId);
  const name = databaseUrlEnvFor(mode);
  const url = process.env[name];
  // The legacy path stays in charge unless the deployment actually opted into connection strings: no URL
  // for this mode AND (no URL at all, or a project that never declared a mode). A project running on the
  // DEFAULT mode must never fail to boot because a variable it never heard of is missing.
  const optedIn = !!url || (!!process.env.DATABASE_URL && hasDeclaredProjectMode(env.projectId))
    || (!!process.env.DATABASE_URL_TEST && hasDeclaredProjectMode(env.projectId));
  if (!optedIn) {
    return { host: env.pgHost, port: env.pgPort, database: env.pgDatabase, user: env.pgUser, password: env.pgPassword };
  }
  // Throws with a legible message when a test mode has no test connection string.
  return { connectionString: resolveDatabaseUrl(mode) };
}

export function getSharedPgPool(env: AppEnv): Pool {
  if (!sharedPool) {
    sharedPool = new Pool(poolConfigFor(env));
  }

  return sharedPool;
}

export async function withPgTransaction<TValue>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<TValue>,
): Promise<TValue> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function queryRows<TRow>(
  client: Pool | PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<TRow[]> {
  const result = await client.query(sql, params);
  return result.rows as TRow[];
}
