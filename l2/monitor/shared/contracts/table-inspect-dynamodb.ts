/// <mls fileReference="_102034_/l2/monitor/shared/contracts/table-inspect-dynamodb.ts" enhancement="_blank" />
export interface MonitorDynamoTableInspectResponse {
  generatedAt: string;
  tableName: string;
  description?: string | null;
  moduleId?: string | null;
  repositoryName?: string | null;
  storageProfile?: string | null;
  backupHot?: boolean;
  exists: boolean;
  columns: Array<{
    name: string;
    type: string;
    filterable: boolean;
  }>;
  pagination: {
    pageSize: number;
    cursor: string | null;
    nextCursor: string | null;
    hasNextPage: boolean;
  };
  filters: Record<string, string>;
  rows: Array<Record<string, unknown>>;
  metricsAreApproximate?: boolean;
}
