/// <mls fileReference="_102034_/l2/monitor/shared/contracts/table-details-dynamodb.ts" enhancement="_blank" />
export interface MonitorDynamoTableDetailsResponse {
  generatedAt: string;
  tableName: string;
  description?: string | null;
  moduleId?: string | null;
  repositoryName?: string | null;
  storageProfile?: string | null;
  backupHot?: boolean;
  exists: boolean;
  summary: {
    tableStatus: string | null;
    itemCount: number;
    tableSizeBytes: number;
    billingMode: string | null;
    tableClass: string | null;
    metricsAreApproximate?: boolean;
  };
  keys: {
    partitionKey: string | null;
    sortKey: string | null;
  };
  attributeDefinitions: Array<{
    name: string;
    type: string;
  }>;
  globalSecondaryIndexes: Array<{
    name: string;
    projectionType: string | null;
    keys: string[];
  }>;
  localSecondaryIndexes: Array<{
    name: string;
    projectionType: string | null;
    keys: string[];
  }>;
}
