/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.ts" enhancement="_blank" />
import type { Pool } from 'pg';
import { getSharedPgPool } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import type {
  ResolvedTableDefinition,
  TableIndexColumnDefinition,
} from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import { projectTableNamespacePrefix, usesPostgres } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
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

async function ensureTimescaleAvailable(pool: Pool): Promise<boolean> {
  const existing = await pool.query<{ exists: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') AS exists",
  );
  if (existing.rows[0]?.exists) {
    return true;
  }

  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE');
    return true;
  } catch {
    console.warn('[bootstrapSchema] TimescaleDB extension not available — hypertables will be created as regular tables');
    return false;
  }
}

async function rebuildPostgresSchema(
  env: AppEnv,
  definitions: ResolvedTableDefinition[],
  snapshotId: string,
): Promise<boolean> {
  const pool = getSharedPgPool(env);
  const hasTimescale = definitions.some((d) => d.timescale?.hypertable);
  const timescaleAvailable = hasTimescale ? await ensureTimescaleAvailable(pool) : false;

  // Multi-project isolation: several client projects can share one database/schema on a VM, so this
  // publish must rebuild ONLY the objects this workspace owns and never drop another project's tables.
  // "Owned" = every physical name we are about to (re)create, plus any stale object still carrying this
  // workspace's client prefix (mls<projectId>_) from a prior publish. Platform tables (mdm_*, monitor,
  // _schema_migrations) are unprefixed and part of `definitions`, so they are owned and rebuilt as
  // before; another project's mls<otherId>_* tables match neither set and are left untouched.
  const ownedNames = new Set(
    definitions
      .filter((d) => usesPostgres(d))
      .flatMap((d) => d.tableName === d.logicalTableName
        ? [d.tableName]
        : [d.tableName, d.logicalTableName]),
  );
  const clientPrefixes = [
    ...new Set(
      definitions
        .filter((d) => d.tableName !== d.logicalTableName)
        .map((d) => projectTableNamespacePrefix(d.projectId)),
    ),
  ];
  const viewDefs = await loadViewDefinitions();
  const ownedViewNames = new Set(viewDefs.map((view) => view.viewName));
  const isOwned = (name: string): boolean =>
    ownedNames.has(name) || ownedViewNames.has(name) || clientPrefixes.some((prefix) => name.startsWith(prefix));

  // Surgical cleanup instead of DROP SCHEMA public CASCADE: dropping the schema would
  // CASCADE-drop the timescaledb extension (its functions live in public) and the app
  // role cannot re-create it (superuser-only, see vmInitialSetup.sh). Drop only the
  // user objects THIS workspace owns; the extension, its catalogs, and other projects survive.

  // Continuous aggregates first: they show up in pg_views but Timescale requires
  // DROP MATERIALIZED VIEW for them.
  const droppedCaggs = new Set<string>();
  if (timescaleAvailable) {
    try {
      const caggs = await pool.query<{ view_name: string }>(
        "SELECT view_name FROM timescaledb_information.continuous_aggregates WHERE view_schema = 'public'",
      );
      for (const row of caggs.rows) {
        if (!isOwned(row.view_name)) continue;
        await pool.query(`DROP MATERIALIZED VIEW IF EXISTS ${quoteIdentifier(row.view_name)} CASCADE`);
        droppedCaggs.add(row.view_name);
      }
    } catch (error) {
      console.warn('[bootstrapSchema] continuous aggregate cleanup skipped:', error instanceof Error ? error.message : error);
    }
  }

  const existingViews = await pool.query<{ viewname: string }>(
    "SELECT viewname FROM pg_views WHERE schemaname = 'public'",
  );
  for (const row of existingViews.rows) {
    if (droppedCaggs.has(row.viewname) || !isOwned(row.viewname)) continue;
    try {
      await pool.query(`DROP VIEW IF EXISTS ${quoteIdentifier(row.viewname)} CASCADE`);
    } catch (error) {
      // 0A000: a continuous aggregate not listed by the info view — retry the right way.
      await pool.query(`DROP MATERIALIZED VIEW IF EXISTS ${quoteIdentifier(row.viewname)} CASCADE`);
    }
  }
  const existingMatViews = await pool.query<{ matviewname: string }>(
    "SELECT matviewname FROM pg_matviews WHERE schemaname = 'public'",
  );
  for (const row of existingMatViews.rows) {
    if (!isOwned(row.matviewname)) continue;
    await pool.query(`DROP MATERIALIZED VIEW IF EXISTS ${quoteIdentifier(row.matviewname)} CASCADE`);
  }
  const existingTables = await pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  );
  for (const row of existingTables.rows) {
    if (!isOwned(row.tablename)) continue;
    await pool.query(`DROP TABLE IF EXISTS ${quoteIdentifier(row.tablename)} CASCADE`);
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

  if (timescaleAvailable) {
    for (const definition of orderedDefinitions.filter((d) => d.timescale?.hypertable)) {
      const { timeColumn, chunkTimeInterval } = definition.timescale!.hypertable;
      const intervalPart = chunkTimeInterval ? `, chunk_time_interval => INTERVAL '${chunkTimeInterval}'` : '';
      // Explicit casts: extended-protocol params arrive as "unknown" and Postgres does
      // not resolve create_hypertable(regclass, name, ...) with named notation otherwise.
      // Non-fatal: the table already exists as a regular table at this point; a Timescale
      // failure must not abort the whole migration/publish.
      try {
        await pool.query(
          `SELECT create_hypertable($1::regclass, $2::name, if_not_exists => TRUE${intervalPart})`,
          [definition.tableName, timeColumn],
        );
      } catch (error) {
        console.warn(`[bootstrapSchema] create_hypertable failed for "${definition.tableName}" — kept as regular table:`, error instanceof Error ? error.message : error);
      }
    }
  }

  // Mechanical seed: the schema was just rebuilt (DROP SCHEMA above), so every table is
  // empty — apply the definitions' seedRows. Non-fatal: bad seed data must not block a release.
  for (const definition of orderedDefinitions.filter((d) => d.seedRows?.length)) {
    try {
      for (const row of definition.seedRows!) {
        const columns = definition.columns.filter((column) => row[column.name] !== undefined);
        if (columns.length === 0) continue;
        const placeholders = columns.map((_, index) => `$${index + 1}`);
        const values = columns.map((column) => {
          const value = row[column.name];
          if (value === null || typeof value !== 'object') return value;
          return column.postgresType.endsWith('[]') ? value : JSON.stringify(value);
        });
        await pool.query(
          `INSERT INTO ${quoteIdentifier(definition.tableName)} (${columns.map((column) => quoteIdentifier(column.name)).join(', ')}) VALUES (${placeholders.join(', ')})`,
          values,
        );
      }
      console.info(`[bootstrapSchema] seeded ${definition.seedRows!.length} row(s) into "${definition.tableName}"`);
    } catch (error) {
      console.warn(`[bootstrapSchema] seed failed for "${definition.tableName}":`, error instanceof Error ? error.message : error);
    }
  }

  await pool.query('INSERT INTO "_schema_migrations" ("id") VALUES ($1)', [snapshotId]);
  return timescaleAvailable;
}

const TIMESCALE_STATEMENT_PATTERN = /timescaledb|time_bucket|create_hypertable|continuous aggregate|add_retention_policy|add_compression_policy/iu;

async function applyViewDefinitions(pool: Pool, input: { timescaleAvailable: boolean }): Promise<void> {
  const viewDefs = await loadViewDefinitions();
  for (const view of viewDefs) {
    for (const statement of view.statements) {
      if (!input.timescaleAvailable && TIMESCALE_STATEMENT_PATTERN.test(statement)) {
        console.warn(`[bootstrapSchema] Skipped TimescaleDB view statement for ${view.viewName}`);
        continue;
      }
      // Non-fatal: a broken view must not block the migration/publish.
      try {
        await pool.query(statement);
      } catch (error) {
        console.warn(`[bootstrapSchema] view statement failed for ${view.viewName}:`, error instanceof Error ? error.message : error);
      }
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
  const timescaleAvailable = await rebuildPostgresSchema(env, definitions, snapshot.id);

  const pool = getSharedPgPool(env);
  await applyViewDefinitions(pool, { timescaleAvailable });

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
