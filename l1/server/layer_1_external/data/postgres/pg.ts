/// <mls fileReference="_102034_/l1/server/layer_1_external/data/postgres/pg.ts" enhancement="_blank" />
import { Pool, types, type PoolClient } from 'pg';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';

// Platform row contract: DATE/TIMESTAMP/TIMESTAMPTZ columns arrive as ISO-8601 STRINGS, never Date
// objects — matching the memory runtime (seed rows) and the generated Row interfaces, whose code does
// string ops on them (localeCompare/slice; lesson run 2026-07-16 cafeFlow viewKitchenBoard 500).
// node-pg's default parsers return Date; override by type OID: 1082 date, 1114 timestamp, 1184 timestamptz.
types.setTypeParser(1082, (value) => value); // date: keep 'YYYY-MM-DD' verbatim
types.setTypeParser(1114, (value) => new Date(`${value}Z`).toISOString()); // timestamp: stored as UTC
types.setTypeParser(1184, (value) => new Date(value).toISOString()); // timestamptz

let sharedPool: Pool | null = null;

export function getSharedPgPool(env: AppEnv): Pool {
  if (!sharedPool) {
    sharedPool = new Pool({
      host: env.pgHost,
      port: env.pgPort,
      database: env.pgDatabase,
      user: env.pgUser,
      password: env.pgPassword,
    });
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
