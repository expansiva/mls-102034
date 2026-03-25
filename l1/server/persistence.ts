/// <mls fileReference="_102034_/l1/server/persistence.ts" enhancement="_blank" />
import type { TableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';

export const tableDefinitions: TableDefinition[] = [
  {
    moduleId: 'platform',
    repositoryName: 'schemaMigrations',
    tableName: '_schema_migrations',
    purpose: 'controle',
    description: 'Tracks the currently applied schema registry snapshot for the local PostgreSQL database.',
    backupHot: false,
    storageProfile: 'postgres',
    writeMode: 'sync',
    columns: [
      { name: 'id', postgresType: 'TEXT' },
      { name: 'applied_at', postgresType: 'TIMESTAMPTZ', defaultSql: 'NOW()' },
    ],
    primaryKey: ['id'],
    version: 1,
  },
  {
    moduleId: 'platform',
    repositoryName: 'schemaSnapshotLog',
    tableName: 'platform_schema_snapshot_log',
    purpose: 'controle',
    description: 'Schema bootstrap history stored remotely for audit and inspection.',
    backupHot: false,
    storageProfile: 'dynamoOnly',
    writeMode: 'sync',
    columns: [
      { name: 'snapshotId', postgresType: 'TEXT' },
      { name: 'hash', postgresType: 'TEXT' },
      { name: 'appliedAt', postgresType: 'TIMESTAMPTZ' },
      { name: 'tables', postgresType: 'JSONB' },
    ],
    primaryKey: ['snapshotId'],
    dynamo: {
      tableNameByEnv: {
        development: 'platform_schema_snapshot_log',
        staging: 'platform_schema_snapshot_log_test',
        production: 'platform_schema_snapshot_log',
      },
      partitionKey: 'snapshotId',
    },
    version: 1,
  },
];
