/// <mls fileReference="_102034_/l1/monitor/layer_1_external/data/persistence/MonitorPersistenceMetadata.ts" enhancement="_blank" />
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import {
  loadResolvedDynamoTableDefinitions,
  loadResolvedPostgresTableDefinitions,
  loadResolvedTableDefinitions,
} from '/_102034_/l1/server/layer_1_external/persistence/registry.js';

export interface MonitorTableMetadata {
  projectId: string;
  moduleId: string;
  repositoryName: string;
  tableName: string;
  description: string;
  purpose: string;
  storageProfile: string;
  backupHot: boolean;
  writeMode: string;
  dynamoTableName: string | null;
  dynamoPartitionKey: string | null;
  dynamoSortKey: string | null;
  dynamoTtlField: string | null;
  localIndexes: Array<{
    name: string;
    unique: boolean;
    columns: string[];
  }>;
  detailsInDynamoOnly: boolean;
}

export class MonitorPersistenceMetadata {
  public constructor(private readonly env: AppEnv) {}

  public async listAll(): Promise<MonitorTableMetadata[]> {
    const definitions = await loadResolvedTableDefinitions(this.env);
    return definitions.map((definition) => ({
      projectId: definition.projectId,
      moduleId: definition.moduleId,
      repositoryName: definition.repositoryName,
      tableName: definition.tableName,
      description: definition.description,
      purpose: definition.purpose,
      storageProfile: definition.storageProfile,
      backupHot: definition.backupHot,
      writeMode: definition.writeMode,
      dynamoTableName: definition.dynamoResolvedTableName,
      dynamoPartitionKey: definition.dynamo?.partitionKey ?? null,
      dynamoSortKey: definition.dynamo?.sortKey ?? null,
      dynamoTtlField: definition.dynamo?.ttlField ?? null,
      localIndexes: (definition.indexes ?? []).map((index) => ({
        name: index.name,
        unique: index.unique === true,
        columns: index.columns.map((column) =>
          typeof column === 'string'
            ? column
            : `${column.name}${column.direction ? ` ${column.direction}` : ''}`,
        ),
      })),
      detailsInDynamoOnly: definition.storageProfile === 'dynamoWithPostgresIndex',
    }));
  }

  public async listPostgresTables() {
    return loadResolvedPostgresTableDefinitions(this.env);
  }

  public async listDynamoTables() {
    return loadResolvedDynamoTableDefinitions(this.env);
  }

  public async findByPostgresTableName(tableName: string): Promise<MonitorTableMetadata | null> {
    const items = await this.listAll();
    return items.find((item) => item.tableName === tableName) ?? null;
  }

  public async findByDynamoTableName(tableName: string): Promise<MonitorTableMetadata | null> {
    const items = await this.listAll();
    return items.find((item) => item.dynamoTableName === tableName) ?? null;
  }
}
