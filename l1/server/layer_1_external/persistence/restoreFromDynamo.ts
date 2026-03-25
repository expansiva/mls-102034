/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/restoreFromDynamo.ts" enhancement="_blank" />
import type { Pool } from 'pg';
import { getSharedPgPool } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import type { ResolvedTableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import { usesPostgres } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import { findResolvedTableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { scanAllDynamoItems } from '/_102034_/l1/server/layer_1_external/persistence/dynamoAdmin.js';

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function upsertLocalRecord(
  pool: Pool,
  definition: ResolvedTableDefinition,
  record: Record<string, unknown>,
) {
  const entries = Object.entries(record);
  const columns = entries.map(([key]) => quoteIdentifier(key));
  const placeholders = entries.map((_, index) => `$${index + 1}`);
  const updateSql = entries
    .filter(([key]) => !definition.primaryKey.includes(key))
    .map(([key]) => `${quoteIdentifier(key)} = EXCLUDED.${quoteIdentifier(key)}`)
    .join(', ');

  await pool.query(
    `INSERT INTO ${quoteIdentifier(definition.tableName)} (${columns.join(', ')})
     VALUES (${placeholders.join(', ')})
     ON CONFLICT (${definition.primaryKey.map((key) => quoteIdentifier(key)).join(', ')})
     DO UPDATE SET ${updateSql}`,
    entries.map(([, value]) => value),
  );
}

export class RegistryRestoreFromDynamoUsecase {
  public constructor(private readonly env: AppEnv = readAppEnv()) {}

  public async restoreTable(repositoryNameOrTableName: string): Promise<number> {
    const definition = await findResolvedTableDefinition(repositoryNameOrTableName, this.env);
    if (!definition.dynamoResolvedTableName || !usesPostgres(definition)) {
      throw new Error(`Table ${repositoryNameOrTableName} does not support local restore from DynamoDB`);
    }

    const items = await scanAllDynamoItems(this.env, definition);
    const pool = getSharedPgPool(this.env);
    await pool.query(`TRUNCATE TABLE ${quoteIdentifier(definition.tableName)}`);

    for (const item of items) {
      await upsertLocalRecord(pool, definition, item);
    }

    return items.length;
  }
}
