/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.ts" enhancement="_blank" />
import type { Pool } from 'pg';
import { getSharedPgPool } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import {
  hasDeclaredProjectMode,
  isTestMode,
  readProjectMode,
  type ProjectMode,
} from '/_102034_/l1/server/layer_1_external/config/projectMode.js';
import type {
  ResolvedTableDefinition,
  TableIndexColumnDefinition,
  TableIndexDefinition,
} from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import {
  moduleTableNamespacePrefix,
  projectTableNamespacePrefix,
  usesPostgres,
} from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import {
  buildSchemaSnapshot,
  loadResolvedTableDefinitions,
  loadViewDefinitions,
} from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import {
  ensureRegisteredDynamoTables,
  writeSchemaSnapshotLog,
} from '/_102034_/l1/server/layer_1_external/persistence/dynamoAdmin.js';
import {
  moduleHashes,
  parseStateKey,
  planModuleRebuild,
  stateKey,
  type ModuleRebuildMode,
  type ModuleRebuildPlan,
} from '/_102034_/l1/server/layer_1_external/persistence/schemaModulePlan.js';
import { applySeedRows } from '/_102034_/l1/server/layer_1_external/persistence/seedApplier.js';
import { selectEligibleSeedRows } from '/_102034_/l1/server/layer_1_external/persistence/seedPolicy.js';

const SCHEMA_MODULE_STATE_TABLE = '_schema_module_state';
const SCHEMA_MIGRATIONS_TABLE = '_schema_migrations';

export type OwnedNameDefinition = Pick<
  ResolvedTableDefinition,
  'tableName' | 'logicalTableName' | 'moduleId' | 'projectId'
>;

/** Names that `rebuildPostgresSchema` may drop. `modules: 'all'` is the full rebuild of today. */
export function ownedNamesFor(
  definitions: OwnedNameDefinition[],
  modules: string[] | 'all',
  removed: string[],
): { isOwned: (name: string) => boolean } {
  const full = modules === 'all';
  const rebuildIds = full ? null : new Set(modules);
  const selected = rebuildIds
    ? definitions.filter((definition) => rebuildIds.has(definition.moduleId))
    : definitions;

  const ownedNames = new Set<string>();
  for (const definition of selected) {
    if (definition.tableName === definition.logicalTableName) {
      ownedNames.add(definition.tableName);
    } else {
      ownedNames.add(definition.tableName);
      ownedNames.add(definition.logicalTableName);
    }
  }

  const projectIds = [
    ...new Set(
      definitions
        .filter((definition) => definition.tableName !== definition.logicalTableName)
        .map((definition) => definition.projectId),
    ),
  ];

  const prefixes: string[] = [];
  if (full) {
    prefixes.push(...projectIds.map((projectId) => projectTableNamespacePrefix(projectId)));
  } else {
    const moduleIds = [...modules, ...removed];
    for (const projectId of projectIds) {
      const projectPrefix = projectTableNamespacePrefix(projectId);
      for (const moduleId of moduleIds) {
        prefixes.push(`${projectPrefix}${moduleTableNamespacePrefix(moduleId)}`);
      }
    }
  }

  return {
    isOwned: (name: string): boolean => {
      if (name === SCHEMA_MODULE_STATE_TABLE) {
        return false;
      }
      if (!full && name === SCHEMA_MIGRATIONS_TABLE) {
        return false;
      }
      return ownedNames.has(name) || prefixes.some((prefix) => prefix.length > 0 && name.startsWith(prefix));
    },
  };
}

/** Tables this rebuild creates. `_schema_migrations` is recreated only in `full`. */
export function tablesToCreate<T extends OwnedNameDefinition>(
  definitions: T[],
  mode: 'full' | 'modules',
  rebuildModules: string[],
): T[] {
  if (mode === 'full') {
    return definitions;
  }
  const rebuildIds = new Set(rebuildModules);
  return definitions.filter((definition) =>
    rebuildIds.has(definition.moduleId) && definition.tableName !== SCHEMA_MIGRATIONS_TABLE);
}

/**
 * A leftover client table: project prefix, not in any current definition, and not dropped.
 * Intact modules stay in `definitions`, so they are not orphans. `full` owns the prefix, so the list is empty.
 */
export function orphanNames(
  existing: string[],
  definitions: OwnedNameDefinition[],
  isOwned: (name: string) => boolean,
  clientPrefixes: string[],
): string[] {
  const known = new Set<string>();
  for (const definition of definitions) {
    known.add(definition.tableName);
    known.add(definition.logicalTableName);
  }
  return existing
    .filter((name) =>
      name !== SCHEMA_MODULE_STATE_TABLE
      && clientPrefixes.some((prefix) => prefix.length > 0 && name.startsWith(prefix))
      && !known.has(name)
      && !isOwned(name))
    .sort((left, right) => left.localeCompare(right));
}

export interface SchemaBootstrapReport {
  /** `tableNames`: the physical names rebuilt, sorted. */
  rebuilt: Array<{ moduleId: string; tables: number; tableNames: string[]; seedRows: number }>;
  untouched: string[];
  removed: string[];
  mode: ModuleRebuildMode;
  orphans: string[];
}

export interface SchemaBootstrapResult {
  snapshotId: string;
  postgresTableCount: number;
  dynamoTableCount: number;
  report: SchemaBootstrapReport;
}

/**
 * `forceRebuild` is an internal reset. It is allowed only when the app declared a test mode.
 * Production, homologation, and an undeclared mode stop here, before any schema write.
 */
export function forceRebuildBlockReason(mode: ProjectMode, declared: boolean): string | null {
  if (!declared) {
    return '[bootstrapSchema] forceRebuild refused before schema write: appEnv is not declared';
  }
  if (!isTestMode(mode)) {
    return `[bootstrapSchema] forceRebuild refused before schema write: appEnv='${mode}' is not development or presentation`;
  }
  return null;
}

/** `forceModules` is exactly one module id and never combines with `forceRebuild`. */
export function forceModulesShapeReason(forceModules: readonly string[], forceRebuild: boolean): string | null {
  if (forceRebuild) {
    return '[bootstrapSchema] forceModules refused before schema write: it does not combine with forceRebuild';
  }
  if (forceModules.length !== 1 || forceModules[0] === undefined || forceModules[0].trim() === '') {
    return `[bootstrapSchema] forceModules refused before schema write: exactly one module id is required (got ${forceModules.length})`;
  }
  return null;
}

/**
 * One `pg_depend` row with `deptype = 'n'` whose referenced object is a relation of `public` (or the row type
 * of one): what `DROP … CASCADE` would drop together with it.
 * - `referenced`: the `public` relation, or the relation of the row type;
 * - `referencedKind`: its `relkind` (`S` is a sequence; `sequenceOwner` is the table linked to it by `deptype` 'a' (SERIAL) or 'i' (IDENTITY), or `null`);
 * - `owner` and `ownerSchema`: the relation that owns the dependent (constraint, rule, trigger, default,
 *   policy, or the relation itself); `null` when the catalog of the dependent is not one the reader knows;
 * - `description`: `pg_describe_object` of the dependent.
 */
export interface CascadeDependent {
  referenced: string;
  referencedKind: string;
  sequenceOwner: string | null;
  owner: string | null;
  ownerSchema: string | null;
  description: string;
}

const SYSTEM_SCHEMAS = new Set(['pg_catalog', 'information_schema', 'pg_toast']);

/** The system and the Timescale internals (chunks, aggregate views) go and come back with the table or the aggregate. */
function isInternalSchema(schema: string): boolean {
  return SYSTEM_SCHEMAS.has(schema) || schema.startsWith('_timescaledb');
}

/**
 * Why a single-module reset must stop before any DDL, or `null`.
 * 1. the module is not in the registry of this project;
 * 2. one of its definitions is a platform table (unprefixed name);
 * 3. something that `DROP … CASCADE` would drop silently depends on what the reset drops (the scope tables,
 *    the registry views, the sequences owned by a scope table, the row types of those): a dependent whose
 *    owner is outside that set, in any schema, or whose owner is unknown. Closed by default: no list of
 *    cases. The owner in the set (a foreign key between two tables of the module, a registry view over a
 *    scope table) and the owner in a system or Timescale schema do not refuse;
 * 4. the incremental plan is not `none`/`recordOnly`: another module has a pending migration, and
 *    `writeModuleState` would mark it as applied without having applied it.
 */
export function moduleResetBlockReason(input: {
  moduleId: string;
  projectId: string | undefined;
  registry: Array<{ projectId: string; moduleId: string }>;
  definitions: OwnedNameDefinition[];
  dependents: CascadeDependent[];
  registryViews: readonly string[];
  incrementalMode: ModuleRebuildMode;
}): string | null {
  const refused = (why: string): string => `[bootstrapSchema] forceModules refused before schema write: ${why}`;
  const { moduleId } = input;
  if (!input.registry.some((entry) => entry.moduleId === moduleId && entry.projectId === input.projectId)) {
    return refused(`module '${moduleId}' is not in the registry of project '${input.projectId}'`);
  }
  const platformTables = input.definitions
    .filter((definition) => definition.moduleId === moduleId && isPlatformOwnedTable(definition))
    .map((definition) => definition.tableName)
    .sort((left, right) => left.localeCompare(right));
  if (platformTables.length > 0) {
    return refused(`module '${moduleId}' declares platform tables (${platformTables.join(', ')})`);
  }
  const { isOwned } = ownedNamesFor(input.definitions, [moduleId], []);
  const registryViews = new Set(input.registryViews);
  const inDropSet = (name: string): boolean => isOwned(name) || registryViews.has(name);
  const stray = [...new Set(
    input.dependents
      .filter((dependent) => {
        const dropped = dependent.referencedKind === 'S'
          ? dependent.sequenceOwner !== null && isOwned(dependent.sequenceOwner)
          : inDropSet(dependent.referenced);
        if (!dropped) return false;
        if (dependent.owner === null || dependent.ownerSchema === null) return true;
        if (isInternalSchema(dependent.ownerSchema)) return false;
        return !(dependent.ownerSchema === 'public' && inDropSet(dependent.owner));
      })
      .map((dependent) => dependent.description),
  )].sort((left, right) => left.localeCompare(right));
  if (stray.length > 0) {
    return refused(`objects outside module '${moduleId}' depend on it and would be dropped (${stray.join(', ')})`);
  }
  if (input.incrementalMode !== 'none' && input.incrementalMode !== 'recordOnly') {
    return refused(`another module has a pending migration (plan ${input.incrementalMode}); migrate first`);
  }
  return null;
}

/** The dependents of the `public` relations that `DROP … CASCADE` follows (`deptype = 'n'`), with their owner. */
export async function readCascadeDependents(pool: Pool): Promise<CascadeDependent[]> {
  const result = await pool.query<{
    referenced: string;
    referenced_kind: string;
    sequence_owner: string | null;
    owner: string | null;
    owner_schema: string | null;
    description: string;
  }>(
    `WITH target AS (
       SELECT relation.oid AS relid, relation.relname, relation.relkind, relation.reltype
         FROM pg_class relation
         JOIN pg_namespace relation_schema ON relation_schema.oid = relation.relnamespace
        WHERE relation_schema.nspname = 'public' AND relation.relkind IN ('r', 'p', 'f', 'v', 'm', 'S')
     ), referenced AS (
       SELECT 'pg_class'::regclass::oid AS ref_class, relid AS ref_object, relid, relname, relkind FROM target
       UNION ALL
       SELECT 'pg_type'::regclass::oid, reltype, relid, relname, relkind FROM target WHERE reltype <> 0
     )
     SELECT DISTINCT
            referenced.relname AS referenced,
            referenced.relkind::text AS referenced_kind,
            sequence_owner.relname AS sequence_owner,
            owner.relname AS owner,
            owner_schema.nspname AS owner_schema,
            pg_describe_object(dependency.classid, dependency.objid, dependency.objsubid) AS description
       FROM pg_depend dependency
       JOIN referenced ON referenced.ref_class = dependency.refclassid AND referenced.ref_object = dependency.refobjid
       LEFT JOIN pg_depend sequence_link
              ON referenced.relkind = 'S'
             AND sequence_link.classid = 'pg_class'::regclass AND sequence_link.objid = referenced.relid
             AND sequence_link.refclassid = 'pg_class'::regclass AND sequence_link.deptype IN ('a', 'i')
       LEFT JOIN pg_class sequence_owner ON sequence_owner.oid = sequence_link.refobjid
       LEFT JOIN pg_class owner ON owner.oid = CASE
              WHEN dependency.classid = 'pg_constraint'::regclass THEN (SELECT conrelid FROM pg_constraint WHERE oid = dependency.objid)
              WHEN dependency.classid = 'pg_rewrite'::regclass THEN (SELECT ev_class FROM pg_rewrite WHERE oid = dependency.objid)
              WHEN dependency.classid = 'pg_trigger'::regclass THEN (SELECT tgrelid FROM pg_trigger WHERE oid = dependency.objid)
              WHEN dependency.classid = 'pg_attrdef'::regclass THEN (SELECT adrelid FROM pg_attrdef WHERE oid = dependency.objid)
              WHEN dependency.classid = 'pg_policy'::regclass THEN (SELECT polrelid FROM pg_policy WHERE oid = dependency.objid)
              WHEN dependency.classid = 'pg_class'::regclass THEN dependency.objid
            END
       LEFT JOIN pg_namespace owner_schema ON owner_schema.oid = owner.relnamespace
      WHERE dependency.deptype = 'n'
        AND NOT (dependency.classid = 'pg_class'::regclass AND dependency.objid = referenced.relid)`,
  );
  return result.rows.map((row) => ({
    referenced: row.referenced,
    referencedKind: row.referenced_kind,
    sequenceOwner: row.sequence_owner,
    owner: row.owner,
    ownerSchema: row.owner_schema,
    description: row.description,
  }));
}

/**
 * Equal snapshot keeps the incremental plan. `forceRebuild` selects a full rebuild of the registry modules.
 * `forceModules` selects a `modules` rebuild of only the listed ones.
 */
export function selectModuleRebuildPlan<T extends {
  mode: ModuleRebuildMode;
  rebuild: string[];
  untouched: string[];
  removed: string[];
}>(input: {
  forceRebuild: boolean;
  forceModules?: string[];
  incremental: T;
  registryModuleIds: string[];
}): T {
  if (input.forceModules && input.forceModules.length > 0) {
    const forced = new Set(input.forceModules);
    return {
      ...input.incremental,
      mode: 'modules',
      rebuild: [...forced],
      untouched: [...new Set(input.registryModuleIds)]
        .filter((moduleId) => !forced.has(moduleId))
        .sort((left, right) => left.localeCompare(right)),
      removed: [],
    };
  }
  if (!input.forceRebuild) {
    return input.incremental;
  }
  return {
    ...input.incremental,
    mode: 'full',
    rebuild: [...new Set(input.registryModuleIds)].sort((left, right) => left.localeCompare(right)),
    untouched: [],
    removed: [],
  };
}

/** Unprefixed physical name ⇒ platform/shared table (mdm_*, monitor_*, _schema_migrations). */
export function isPlatformOwnedTable(
  definition: Pick<ResolvedTableDefinition, 'tableName' | 'logicalTableName'>,
): boolean {
  return definition.tableName === definition.logicalTableName;
}

/**
 * Seeds follow the owning project's mode. Platform tables follow the server's hosted project
 * (`env.projectId`), not APP_ENV — that is a different vocabulary.
 */
export function shouldApplySeedRows(input: {
  tableName: string;
  logicalTableName: string;
  projectMode: ProjectMode;
  serverMode: ProjectMode;
}): { apply: boolean; mode: ProjectMode; reason: string } {
  const platform = isPlatformOwnedTable(input);
  const mode = platform ? input.serverMode : input.projectMode;
  if (isTestMode(mode)) {
    return {
      apply: true,
      mode,
      reason: platform
        ? `seeding platform table "${input.tableName}" (server appEnv='${mode}')`
        : `seeding "${input.tableName}" (project appEnv='${mode}')`,
    };
  }
  return {
    apply: false,
    mode,
    reason: platform
      ? `skipped seed for platform table "${input.tableName}": server appEnv='${mode}' is not a test mode`
      : `skipped seed for "${input.tableName}": project appEnv='${mode}' is not a test mode`,
  };
}

async function readLastAppliedSnapshotId(pool: Pool): Promise<string | null> {
  try {
    const result = await pool.query<{ id: string }>(
      'SELECT id FROM "_schema_migrations" ORDER BY applied_at DESC, id DESC LIMIT 1',
    );
    return result.rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function renderIndexColumn(column: TableIndexColumnDefinition): string {
  if (typeof column === 'string') {
    return quoteIdentifier(column);
  }
  return `${quoteIdentifier(column.name)} ${(column.direction ?? 'asc').toUpperCase()}`;
}

export function buildCreateTableSql(definition: ResolvedTableDefinition): string {
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

function indexColumnName(column: TableIndexColumnDefinition): string {
  return typeof column === 'string' ? column : column.name;
}

function isReservedPrimaryKeyIndexName(
  indexName: string,
  tableName: string,
  logicalTableName?: string,
): boolean {
  if (indexName === `${tableName}_pkey`) return true;
  return !!logicalTableName && indexName === `${logicalTableName}_pkey`;
}

function columnsMatchPrimaryKey(indexColumns: string[], primaryKey: string[]): boolean {
  return primaryKey.length > 0
    && indexColumns.length === primaryKey.length
    && indexColumns.every((column, i) => column === primaryKey[i]);
}

/**
 * Drop indexes that collide with the implicit Postgres PRIMARY KEY index (`<table>_pkey`)
 * or that repeat the same columns. Generated client defs have emitted both; discarding
 * is decide-log-continue so publish does not die with 42P07.
 */
export function sanitizeDefinitionIndexes<T extends {
  tableName: string;
  primaryKey: string[];
  indexes?: TableIndexDefinition[];
  logicalTableName?: string;
}>(definition: T): T {
  const indexes = definition.indexes;
  if (!indexes?.length) return definition;
  const kept: TableIndexDefinition[] = [];
  for (const index of indexes) {
    const indexColumns = index.columns.map(indexColumnName);
    const reservedName = isReservedPrimaryKeyIndexName(
      index.name,
      definition.tableName,
      definition.logicalTableName,
    );
    const redundantColumns = columnsMatchPrimaryKey(indexColumns, definition.primaryKey);
    if (reservedName || redundantColumns) {
      console.info(`[bootstrapSchema] discarding redundant PK index "${index.name}" on "${definition.tableName}"`);
      continue;
    }
    kept.push(index);
  }
  if (kept.length === indexes.length) return definition;
  return { ...definition, indexes: kept };
}

export function buildCreateIndexSql(definition: ResolvedTableDefinition): string[] {
  return (sanitizeDefinitionIndexes(definition).indexes ?? []).map((index) => {
    const whereSql = index.where ? ` WHERE ${index.where}` : '';
    return `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdentifier(index.name)}
     ON ${quoteIdentifier(definition.tableName)} (${index.columns.map((column) => renderIndexColumn(column)).join(', ')})${whereSql}`;
  });
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
  input: {
    mode: 'full' | 'modules';
    rebuildModules: string[];
    removedModules: string[];
    insertSnapshot: boolean;
  },
): Promise<{ timescaleAvailable: boolean; orphans: string[]; createdTables: ResolvedTableDefinition[] }> {
  const pool = getSharedPgPool(env);
  const postgresDefinitions = definitions.filter((definition) => usesPostgres(definition));
  const hasTimescale = definitions.some((d) => d.timescale?.hypertable);
  const timescaleAvailable = hasTimescale ? await ensureTimescaleAvailable(pool) : false;

  const dropScope = ownedNamesFor(
    postgresDefinitions,
    input.mode === 'full' ? 'all' : input.rebuildModules,
    input.removedModules,
  );
  const viewDefs = await loadViewDefinitions();
  const ownedViewNames = new Set(viewDefs.map((view) => view.viewName));
  const dropViews = input.mode === 'full' || input.rebuildModules.length > 0 || input.removedModules.length > 0;
  const isOwned = (name: string): boolean =>
    dropScope.isOwned(name) || (dropViews && ownedViewNames.has(name));

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
  const clientPrefixes = [
    ...new Set(
      postgresDefinitions
        .filter((definition) => definition.tableName !== definition.logicalTableName)
        .map((definition) => projectTableNamespacePrefix(definition.projectId)),
    ),
  ];
  const orphans = orphanNames(
    existingTables.rows.map((row) => row.tablename),
    postgresDefinitions,
    isOwned,
    clientPrefixes,
  );
  for (const row of existingTables.rows) {
    if (!isOwned(row.tablename)) continue;
    await pool.query(`DROP TABLE IF EXISTS ${quoteIdentifier(row.tablename)} CASCADE`);
  }

  const createDefinitions = tablesToCreate(postgresDefinitions, input.mode, input.rebuildModules);

  const orderedDefinitions = [...createDefinitions]
    .sort((left, right) => {
      if (left.tableName === SCHEMA_MIGRATIONS_TABLE) {
        return -1;
      }
      if (right.tableName === SCHEMA_MIGRATIONS_TABLE) {
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

  if (input.insertSnapshot) {
    // Apps sharing a database alternate snapshots, so this id may already be there from an earlier publish.
    await pool.query(
      'INSERT INTO "_schema_migrations" ("id") VALUES ($1) ON CONFLICT ("id") DO UPDATE SET "applied_at" = NOW()',
      [snapshotId],
    );
  }
  return { timescaleAvailable, orphans, createdTables: orderedDefinitions };
}

function modulesOf(tables: { projectId: string; moduleId: string }[]): { projectId: string; moduleId: string }[] {
  const byModule = new Map<string, string>();
  for (const table of tables) {
    if (!byModule.has(table.moduleId)) {
      byModule.set(table.moduleId, table.projectId);
    }
  }
  return [...byModule].map(([moduleId, projectId]) => ({ projectId, moduleId }));
}

/** Adds `project_id`, adopts rows this migrate owns, and switches the PK once no legacy nulls remain. */
async function ensureModuleStateTable(
  pool: Pool,
  adoptions: { projectId: string; moduleId: string }[],
): Promise<void> {
  const table = quoteIdentifier(SCHEMA_MODULE_STATE_TABLE);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      project_id text,
      module_id text,
      hash text not null,
      applied_at timestamptz not null default now(),
      primary key (project_id, module_id)
    )
  `);
  await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS project_id text`);
  for (const adoption of adoptions) {
    await pool.query(
      `UPDATE ${table} SET project_id = $1 WHERE project_id IS NULL AND module_id = $2`,
      [adoption.projectId, adoption.moduleId],
    );
  }
  // A leftover null belongs to the other app. PK (project_id, module_id) rejects nulls, so it waits.
  const pending = await pool.query<{ pending: string }>(
    `SELECT count(*)::text AS pending FROM ${table} WHERE project_id IS NULL`,
  );
  if (pending.rows[0]?.pending !== '0') {
    return;
  }
  const key = await pool.query<{ attname: string }>(`
    SELECT a.attname
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = $1::regclass AND i.indisprimary
    ORDER BY array_position(i.indkey, a.attnum)
  `, [SCHEMA_MODULE_STATE_TABLE]);
  const columns = key.rows.map((row) => row.attname);
  if (columns.length === 2 && columns[0] === 'project_id' && columns[1] === 'module_id') {
    return;
  }
  const constraint = await pool.query<{ conname: string }>(`
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = $1::regclass AND con.contype = 'p'
  `, [SCHEMA_MODULE_STATE_TABLE]);
  const name = constraint.rows[0]?.conname;
  if (name) {
    await pool.query(`ALTER TABLE ${table} DROP CONSTRAINT ${quoteIdentifier(name)}`);
  }
  await pool.query(`ALTER TABLE ${table} ALTER COLUMN project_id SET NOT NULL`);
  await pool.query(`ALTER TABLE ${table} ADD PRIMARY KEY (project_id, module_id)`);
}

async function readAppliedModuleHashes(pool: Pool, ownProjects: string[]): Promise<Map<string, string> | null> {
  try {
    const result = await pool.query<{ project_id: string; module_id: string; hash: string }>(
      `SELECT project_id, module_id, hash FROM ${quoteIdentifier(SCHEMA_MODULE_STATE_TABLE)} WHERE project_id = ANY($1::text[])`,
      [ownProjects],
    );
    return new Map(result.rows.map((row) => [stateKey(row.project_id, row.module_id), row.hash]));
  } catch {
    return null;
  }
}

async function writeModuleState(pool: Pool, hashes: Map<string, string>, ownProjects: string[]): Promise<void> {
  const table = quoteIdentifier(SCHEMA_MODULE_STATE_TABLE);
  await pool.query(`DELETE FROM ${table} WHERE project_id = ANY($1::text[])`, [ownProjects]);
  for (const [key, hash] of hashes) {
    const parsed = parseStateKey(key);
    if (!parsed || !ownProjects.includes(parsed.projectId)) {
      continue;
    }
    await pool.query(
      `INSERT INTO ${table} (project_id, module_id, hash) VALUES ($1, $2, $3)`,
      [parsed.projectId, parsed.moduleId, hash],
    );
  }
}

export function rebuiltSummary(
  env: AppEnv,
  definitions: ResolvedTableDefinition[],
  rebuildModules: string[],
): SchemaBootstrapReport['rebuilt'] {
  const serverMode = readProjectMode(env.projectId);
  return [...rebuildModules].sort((left, right) => left.localeCompare(right)).map((moduleId) => {
    const tables = definitions.filter((definition) => definition.moduleId === moduleId && usesPostgres(definition));
    // Eligible rows for this rebuild (initial always, test only in a test mode). Not a write count.
    let seedRows = 0;
    for (const definition of tables) {
      seedRows += selectEligibleSeedRows(definition, {
        tableName: definition.tableName,
        logicalTableName: definition.logicalTableName,
        projectMode: readProjectMode(definition.projectId),
        serverMode,
      }).length;
    }
    return {
      moduleId,
      tables: tables.length,
      tableNames: tables.map((definition) => definition.tableName).sort((left, right) => left.localeCompare(right)),
      seedRows,
    };
  });
}

function emptyReport(mode: ModuleRebuildMode): SchemaBootstrapReport {
  return { rebuilt: [], untouched: [], removed: [], mode, orphans: [] };
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
    forceRebuild?: boolean;
    /** Rebuild only this module (exactly one id). Test modes only; see `moduleResetBlockReason`. */
    forceModules?: string[];
  },
): Promise<SchemaBootstrapResult> {
  if (env.runtimeMode === 'memory') {
    console.info('[bootstrapSchema] Skipped — memory mode');
    return { snapshotId: 'memory', postgresTableCount: 0, dynamoTableCount: 0, report: emptyReport('none') };
  }

  const forceRebuild = input?.forceRebuild === true;
  const forceModules = input?.forceModules;
  if (forceModules) {
    const shape = forceModulesShapeReason(forceModules, forceRebuild);
    if (shape) {
      throw new Error(shape);
    }
  }
  if (forceRebuild || forceModules) {
    const block = forceRebuildBlockReason(readProjectMode(env.projectId), hasDeclaredProjectMode(env.projectId));
    if (block) {
      throw new Error(block);
    }
  }

  const definitions = await loadResolvedTableDefinitions(env);
  const snapshot = await buildSchemaSnapshot(env);
  const pool = getSharedPgPool(env);
  const definedModules = modulesOf(snapshot.tables);
  const ownProjects = [...new Set(definedModules.map((module) => module.projectId))];
  await ensureModuleStateTable(pool, definedModules);
  const lastSnapshotId = await readLastAppliedSnapshotId(pool);
  const currentHashes = await moduleHashes(snapshot.tables);
  const appliedHashes = await readAppliedModuleHashes(pool, ownProjects);
  const incremental = planModuleRebuild({
    current: currentHashes,
    applied: appliedHashes,
    lastSnapshotId,
    currentSnapshotId: snapshot.id,
    ownProjects,
  });
  if (forceModules) {
    const block = moduleResetBlockReason({
      moduleId: forceModules[0] as string,
      projectId: env.projectId,
      registry: definedModules,
      definitions: definitions.filter((definition) => usesPostgres(definition)),
      dependents: await readCascadeDependents(pool),
      registryViews: (await loadViewDefinitions()).map((view) => view.viewName),
      incrementalMode: incremental.mode,
    });
    if (block) {
      throw new Error(block);
    }
  }
  const plan = selectModuleRebuildPlan({
    forceRebuild,
    forceModules,
    incremental,
    registryModuleIds: definedModules.map((module) => module.moduleId),
  });

  let orphans: string[] = [];
  let createdTables: ResolvedTableDefinition[] = [];
  if (plan.mode === 'none') {
    console.info(`[bootstrapSchema] schema unchanged (${snapshot.id}); skipping rebuild`);
  } else if (plan.mode === 'recordOnly') {
    console.info(`[bootstrapSchema] schema unchanged (${snapshot.id}); recording module state`);
    await writeModuleState(pool, currentHashes, ownProjects);
  } else {
    if (plan.mode === 'full') {
      if (forceRebuild) {
        console.info(`[bootstrapSchema] forceRebuild: rebuilding own scope (${plan.rebuild.join(', ') || '—'})`);
      } else if (lastSnapshotId && lastSnapshotId !== snapshot.id) {
        console.info(`[bootstrapSchema] schema changed (${lastSnapshotId} → ${snapshot.id}); rebuilding`);
      } else if (!lastSnapshotId) {
        console.info(`[bootstrapSchema] no applied snapshot; rebuilding (${snapshot.id})`);
      }
    } else if (forceModules) {
      console.info(`[bootstrapSchema] forceModules: rebuilding only ${plan.rebuild.join(', ')}`);
    } else {
      const removed = plan.removed.length > 0 ? plan.removed.join(', ') : '—';
      console.info(
        `[bootstrapSchema] module state changed (rebuild: ${plan.rebuild.join(', ')}; removed: ${removed}); rebuilding only those`,
      );
    }
    const rebuilt = await rebuildPostgresSchema(env, definitions, snapshot.id, {
      mode: plan.mode === 'full' ? 'full' : 'modules',
      rebuildModules: plan.rebuild,
      removedModules: plan.removed,
      insertSnapshot: forceRebuild || lastSnapshotId !== snapshot.id,
    });
    orphans = rebuilt.orphans;
    createdTables = rebuilt.createdTables;
    if (plan.rebuild.length > 0 || plan.removed.length > 0) {
      await applyViewDefinitions(pool, { timescaleAvailable: rebuilt.timescaleAvailable });
    }
    await writeModuleState(pool, currentHashes, ownProjects);
  }

  const seedCounts = await applySeedRows(pool, definitions, {
    projectMode: readProjectMode,
    serverMode: readProjectMode(env.projectId),
    rebuiltTableNames: new Set(createdTables.map((definition) => definition.tableName)),
  });
  console.info(
    `[bootstrapSchema] seed applied (plan ${plan.mode}): initial inserted ${seedCounts.initialInserted}, conflicts ${seedCounts.initialConflicts}, test inserted ${seedCounts.testInserted}`,
  );

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
    report: {
      rebuilt: rebuiltSummary(env, definitions, plan.rebuild),
      untouched: plan.untouched,
      removed: plan.removed,
      mode: plan.mode,
      orphans,
    },
  };
}

const SCHEMA_DIFF_TEXT: Record<'en' | 'pt' | 'es', (list: string) => string> = {
  en: (list) => `Module ${list} differs from the published app. Choose sample data or a copy to start this draft.`,
  pt: (list) => `O módulo ${list} difere do aplicativo publicado. Escolha dados de exemplo ou uma cópia para iniciar este rascunho.`,
  es: (list) => `El módulo ${list} difiere de la aplicación publicada. Elija datos de ejemplo o una copia para iniciar este borrador.`,
};

const SCHEMA_DIFF_MARK = /DRAFT_SCHEMA_DIFF modules=([A-Za-z0-9_-]+(?:,[A-Za-z0-9_-]+)*)/u;

/** Modules whose published hash differs. `none` and `recordOnly` do not change the database. */
export function sharedDraftDrift(plan: ModuleRebuildPlan): string[] {
  if (plan.mode === 'none' || plan.mode === 'recordOnly') return [];
  return [...new Set([...plan.rebuild, ...plan.removed])].sort((left, right) => left.localeCompare(right));
}

export function sharedDraftSchemaMessage(modules: readonly string[], lang: 'en' | 'pt' | 'es' = 'en'): string {
  return SCHEMA_DIFF_TEXT[lang](modules.join(', '));
}

export function sharedDraftSchemaLog(modules: readonly string[]): string {
  return `${sharedDraftSchemaMessage(modules)} DRAFT_SCHEMA_DIFF modules=${modules.join(',')}`;
}

export function sharedDraftSchemaModules(text: string): string[] | null {
  const match = SCHEMA_DIFF_MARK.exec(text);
  if (!match?.[1]) return null;
  return match[1].split(',');
}

export class SharedDraftSchemaError extends Error {
  readonly modules: string[];

  constructor(modules: string[]) {
    super(sharedDraftSchemaLog(modules));
    this.name = 'SharedDraftSchemaError';
    this.modules = modules;
  }
}

const UNDEFINED_TABLE = '42P01';

function scrubDbError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/postgres:\/\/\S+/giu, 'postgres://***');
}

/** Reads the published hashes. A missing state table is "no client state", not a silent seed. Any other error is thrown. */
async function readPublishedModuleState(pool: Pool, ownProjects: string[]): Promise<{
  applied: Map<string, string> | null;
  lastSnapshotId: string | null;
}> {
  let lastSnapshotId: string | null = null;
  try {
    const snap = await pool.query<{ id: string }>(
      `SELECT id FROM ${quoteIdentifier(SCHEMA_MIGRATIONS_TABLE)} ORDER BY applied_at DESC, id DESC LIMIT 1`,
    );
    lastSnapshotId = snap.rows[0]?.id ?? null;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== UNDEFINED_TABLE) {
      const cause = scrubDbError(error);
      console.error(`[boot] could not read the published schema snapshot: ${cause}`);
      throw new Error(`Could not read the published schema snapshot (${cause})`);
    }
    console.error('[boot] published database has no _schema_migrations table');
  }
  try {
    const result = await pool.query<{ project_id: string; module_id: string; hash: string }>(
      `SELECT project_id, module_id, hash FROM ${quoteIdentifier(SCHEMA_MODULE_STATE_TABLE)} WHERE project_id = ANY($1::text[])`,
      [ownProjects],
    );
    return {
      applied: new Map(result.rows.map((row) => [stateKey(row.project_id, row.module_id), row.hash])),
      lastSnapshotId,
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === UNDEFINED_TABLE) {
      console.error('[boot] published database has no _schema_module_state table');
      return { applied: null, lastSnapshotId };
    }
    const cause = scrubDbError(error);
    console.error(`[boot] could not read published module hashes: ${cause}`);
    throw new Error(`Could not read published module hashes (${cause})`);
  }
}

/**
 * Read-only check for a draft that shares the app database.
 * A differing module hash throws. This function does not create, rebuild, seed or write.
 */
export async function assertSharedDraftSchema(input: {
  pool: Pool;
  current: Map<string, string>;
  currentSnapshotId: string;
  ownProjects: string[];
}): Promise<void> {
  const published = await readPublishedModuleState(input.pool, input.ownProjects);
  const plan = planModuleRebuild({
    current: input.current,
    applied: published.applied,
    lastSnapshotId: published.lastSnapshotId,
    currentSnapshotId: input.currentSnapshotId,
    ownProjects: input.ownProjects,
  });
  const modules = sharedDraftDrift(plan);
  if (modules.length === 0) return;
  const error = new SharedDraftSchemaError(modules);
  console.error(`[boot] ${error.message}`);
  throw error;
}

/** The one boot check for readonly and same: compare the draft schema to the published database, then stop. */
export async function assertSharedDraftSchemaForBoot(env: AppEnv, pool?: Pool): Promise<void> {
  if (env.runtimeMode === 'memory') return;
  const snapshot = await buildSchemaSnapshot(env);
  const definedModules = modulesOf(snapshot.tables);
  const ownProjects = [...new Set(definedModules.map((module) => module.projectId))];
  await assertSharedDraftSchema({
    pool: pool ?? getSharedPgPool(env),
    current: await moduleHashes(snapshot.tables),
    currentSnapshotId: snapshot.id,
    ownProjects,
  });
}
