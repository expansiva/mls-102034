/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.ts" enhancement="_blank" />
import type { Pool } from 'pg';
import { getSharedPgPool } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import type {
  ResolvedTableDefinition,
  TableIndexColumnDefinition,
} from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import { usesPostgres } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import {
  buildSchemaSnapshot,
  loadResolvedTableDefinitions,
  loadViewDefinitions,
} from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import {
  ensureRegisteredDynamoTables,
  writeSchemaSnapshotLog,
} from '/_102034_/l1/server/layer_1_external/persistence/dynamoAdmin.js';

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function renderIndexColumn(column: TableIndexColumnDefinition): string {
  if (typeof column === 'string') {
    return quoteIdentifier(column);
  }
  return `${quoteIdentifier(column.name)} ${(column.direction ?? 'asc').toUpperCase()}`;
}

function buildCreateTableSql(definition: ResolvedTableDefinition): string {
  const columnsSql = definition.columns.map((column) => {
    const notNullSql = column.nullable ? '' : ' NOT NULL';
    const defaultSql = column.defaultSql ? ` DEFAULT ${column.defaultSql}` : '';
    return `${quoteIdentifier(column.name)} ${column.postgresType}${notNullSql}${defaultSql}`;
  });
  const primaryKeySql = definition.primaryKey.length > 0
    ? `, PRIMARY KEY (${definition.primaryKey.map((column) => quoteIdentifier(column)).join(', ')})`
    : '';
  const unloggedSql = definition.postgres?.unlogged ? 'UNLOGGED ' : '';

  return `CREATE ${unloggedSql}TABLE ${quoteIdentifier(definition.tableName)} (${columnsSql.join(', ')}${primaryKeySql})`;
}

function buildCreateIndexSql(definition: ResolvedTableDefinition): string[] {
  return (definition.indexes ?? []).map((index) =>
    `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdentifier(index.name)}
     ON ${quoteIdentifier(definition.tableName)} (${index.columns.map((column) => renderIndexColumn(column)).join(', ')})`,
  );
}

async function rebuildPostgresSchema(
  env: AppEnv,
  definitions: ResolvedTableDefinition[],
  snapshotId: string,
): Promise<void> {
  const pool = getSharedPgPool(env);
  const hasTimescale = definitions.some((d) => d.timescale?.hypertable);

  if (hasTimescale) {
    await pool.query('DROP EXTENSION IF EXISTS timescaledb CASCADE');
  }

  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');

  if (hasTimescale) {
    await pool.query('CREATE EXTENSION timescaledb CASCADE');
  }

  const orderedDefinitions = [...definitions]
    .filter((definition) => usesPostgres(definition))
    .sort((left, right) => {
      if (left.tableName === '_schema_migrations') {
        return -1;
      }
      if (right.tableName === '_schema_migrations') {
        return 1;
      }
      return left.tableName.localeCompare(right.tableName);
    });

  for (const definition of orderedDefinitions) {
    await pool.query(buildCreateTableSql(definition));
  }

  for (const definition of orderedDefinitions) {
    for (const indexSql of buildCreateIndexSql(definition)) {
      await pool.query(indexSql);
    }
  }

  for (const definition of orderedDefinitions.filter((d) => d.timescale?.hypertable)) {
    const { timeColumn, chunkTimeInterval } = definition.timescale!.hypertable;
    const intervalPart = chunkTimeInterval ? `, chunk_time_interval => INTERVAL '${chunkTimeInterval}'` : '';
    await pool.query(
      `SELECT create_hypertable($1, $2, if_not_exists => TRUE${intervalPart})`,
      [definition.tableName, timeColumn],
    );
  }

  await pool.query('INSERT INTO "_schema_migrations" ("id") VALUES ($1)', [snapshotId]);
}

async function applyViewDefinitions(pool: Pool): Promise<void> {
  const viewDefs = await loadViewDefinitions();
  for (const view of viewDefs) {
    for (const statement of view.statements) {
      await pool.query(statement);
    }
  }
}

export async function bootstrapSchema(
  env: AppEnv,
  input?: {
    ensureDynamo?: boolean;
    recordSnapshotLog?: boolean;
  },
): Promise<{ snapshotId: string; postgresTableCount: number; dynamoTableCount: number }> {
  if (env.runtimeMode === 'memory') {
    console.info('[bootstrapSchema] Skipped — memory mode');
    return { snapshotId: 'memory', postgresTableCount: 0, dynamoTableCount: 0 };
  }

  const definitions = await loadResolvedTableDefinitions(env);
  const snapshot = await buildSchemaSnapshot(env);
  await rebuildPostgresSchema(env, definitions, snapshot.id);

  const pool = getSharedPgPool(env);
  await applyViewDefinitions(pool);

  let dynamoTableCount = 0;
  if (input?.ensureDynamo !== false) {
    await ensureRegisteredDynamoTables(env);
    dynamoTableCount = definitions.filter((definition) => definition.dynamoResolvedTableName).length;
  }

  if (input?.recordSnapshotLog) {
    await writeSchemaSnapshotLog(env, snapshot);
  }

  return {
    snapshotId: snapshot.id,
    postgresTableCount: definitions.filter((definition) => usesPostgres(definition)).length,
    dynamoTableCount,
  };
}
