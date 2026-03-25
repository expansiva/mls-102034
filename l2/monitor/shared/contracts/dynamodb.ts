/// <mls fileReference="_102034_/l2/monitor/shared/contracts/dynamodb.ts" enhancement="_blank" />
export interface MonitorDynamoResponse {
  generatedAt: string;
  dynamodb: {
    runtimeMode: 'memory' | 'postgres';
    region: string;
    tables: Array<{
      tableName: string;
      description?: string | null;
      moduleId?: string | null;
      repositoryName?: string | null;
      storageProfile?: string | null;
      backupHot?: boolean;
      exists: boolean;
      itemCount: number | null;
      tableStatus: string | null;
      tableSizeBytes: number | null;
      metricsAreApproximate?: boolean;
    }>;
    summary: {
      totalTables: number;
      availableTables: number;
      missingTables: number;
      totalItemCount: number;
      metricsAreApproximate: boolean;
    };
  };
}
