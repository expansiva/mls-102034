/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/contracts.ts" enhancement="_blank" />
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';

export type TablePurpose =
  | 'mdm'
  | 'cadastro'
  | 'transacao'
  | 'controle'
  | 'fila'
  | 'cache';

export type StorageProfile =
  | 'postgres'
  | 'postgresHotBackup'
  | 'dynamoOnly'
  | 'dynamoWithPostgresIndex';

export type TableWriteMode = 'sync' | 'writeBehind';

export interface TableColumnDefinition {
  name: string;
  postgresType: string;
  nullable?: boolean;
  defaultSql?: string;
  description?: string;
}

export type TableIndexColumnDefinition =
  | string
  | {
      name: string;
      direction?: 'asc' | 'desc';
    };

export interface TableIndexDefinition {
  name: string;
  columns: TableIndexColumnDefinition[];
  unique?: boolean;
}

export interface DynamoTableConfig {
  tableName?: string;
  tableNameByEnv?: Partial<Record<AppEnv['appEnv'], string>>;
  partitionKey: string;
  sortKey?: string;
  ttlField?: string;
}

export interface TableTimescaleConfig {
  hypertable: {
    timeColumn: string;
    chunkTimeInterval?: string;
  };
}

export interface ViewDefinition {
  moduleId: string;
  viewName: string;
  /** SQL statements executed in order after all tables and hypertables are created. */
  statements: string[];
}

export interface TableDefinition {
  moduleId: string;
  repositoryName?: string;
  tableName: string;
  tableNameByEnv?: Partial<Record<AppEnv['appEnv'], string>>;
  purpose: TablePurpose;
  description: string;
  backupHot: boolean;
  storageProfile: StorageProfile;
  writeMode: TableWriteMode;
  columns: TableColumnDefinition[];
  primaryKey: string[];
  indexes?: TableIndexDefinition[];
  postgres?: {
    unlogged?: boolean;
  };
  timescale?: TableTimescaleConfig;
  dynamo?: DynamoTableConfig;
  retentionDays?: number;
  version: number;
  // Mechanical mock rows applied when the table is (re)created empty: on every Postgres
  // schema rebuild (migrate) and on every memory-runtime store init (dev preview).
  // Keyed by column name; JSONB columns take plain objects.
  seedRows?: Array<Record<string, unknown>>;
}

/** Seed rows shipped in a separate file inside the module's tableDefsDir (so generated
 *  table definitions stay untouched). Discovered by shape, like TableDefinition. */
export interface TableSeedRows {
  seedFor: string; // repositoryName or tableName of the target TableDefinition
  rows: Array<Record<string, unknown>>;
}

export interface ResolvedTableDefinition extends TableDefinition {
  projectId: string;
  repositoryName: string;
  // Physical table name (`tableName`) namespaced per client project. `logicalTableName` is the
  // pre-namespace base name, kept as a lookup key so `getTable('order')` / a `seedFor: 'order'` still
  // resolve after the physical name becomes `mls<projectId>_order`.
  logicalTableName: string;
  dynamoResolvedTableName: string | null;
}

export interface SchemaSnapshot {
  id: string;
  hash: string;
  appliedAt: string;
  tables: Array<{
    projectId: string;
    moduleId: string;
    repositoryName: string;
    tableName: string;
    storageProfile: StorageProfile;
    backupHot: boolean;
    dynamoTableName: string | null;
    version: number;
  }>;
}

export function resolveRepositoryName(definition: TableDefinition): string {
  return definition.repositoryName ?? definition.tableName;
}

export function resolveDynamoTableName(
  definition: TableDefinition,
  env: Pick<AppEnv, 'appEnv'>,
): string | null {
  if (!definition.dynamo) {
    return null;
  }

  return (
    definition.dynamo.tableNameByEnv?.[env.appEnv] ??
    definition.dynamo.tableName ??
    null
  );
}

export function resolvePostgresTableName(
  definition: TableDefinition,
  env: Pick<AppEnv, 'appEnv'>,
): string {
  return definition.tableNameByEnv?.[env.appEnv] ?? definition.tableName;
}

/** A project is namespaced when it owns application (client) tables. Platform tables live in
 *  master-backend / lib projects and stay on their canonical, shared names. */
export function isClientProjectType(projectType: string | undefined): boolean {
  return projectType === 'client';
}

/** Physical-name prefix for a client project. `mls` keeps the identifier unquoted-safe in Postgres
 *  (a bare `102051_order` would require quoting everywhere), and readable. */
export function projectTableNamespacePrefix(projectId: string): string {
  return `mls${projectId}_`;
}

/**
 * Namespaces a physical storage name (Postgres table or DynamoDB table) with the owning project when
 * that project owns application tables, so several client projects can share one database/schema on a
 * VM without colliding on generic names (`order`, `daily_shift`, ...). Platform tables (mdm_*, monitor,
 * _schema_migrations) belong to master/lib projects and are left on their canonical names. Idempotent:
 * a name already carrying the prefix is returned unchanged.
 */
export function applyProjectTableNamespace(
  physicalName: string,
  projectId: string,
  projectType: string | undefined,
): string {
  if (!isClientProjectType(projectType)) {
    return physicalName;
  }
  const prefix = projectTableNamespacePrefix(projectId);
  return physicalName.startsWith(prefix) ? physicalName : `${prefix}${physicalName}`;
}

export function usesPostgres(definition: TableDefinition): boolean {
  return definition.storageProfile !== 'dynamoOnly';
}

export function usesDynamo(definition: TableDefinition): boolean {
  return (
    definition.storageProfile === 'dynamoOnly' ||
    definition.storageProfile === 'postgresHotBackup' ||
    definition.storageProfile === 'dynamoWithPostgresIndex'
  );
}

export function requiresWriteBehind(definition: TableDefinition): boolean {
  return definition.writeMode === 'writeBehind' && definition.storageProfile === 'postgresHotBackup';
}
