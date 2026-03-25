/// <mls fileReference="_102034_/l2/monitor/shared/contracts/architecture.ts" enhancement="_blank" />
export interface MonitorArchitectureResponse {
  generatedAt: string;
  architecture: {
    totalTables: number;
    postgresBackedTables: number;
    dynamoBackedTables: number;
    hotBackupTables: number;
    tables: Array<{
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
      detailsInDynamoOnly: boolean;
      localIndexes: Array<{
        name: string;
        unique: boolean;
        columns: string[];
      }>;
    }>;
  };
}
