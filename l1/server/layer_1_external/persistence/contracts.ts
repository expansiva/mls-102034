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
  dynamo?: DynamoTableConfig;
  retentionDays?: number;
  version: number;
}

export interface ResolvedTableDefinition extends TableDefinition {
  projectId: string;
  repositoryName: string;
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
