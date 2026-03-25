/// <mls fileReference="_102034_/l1/server/layer_1_external/data/postgres/pg.ts" enhancement="_blank" />
import { Pool, type PoolClient } from 'pg';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';

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
