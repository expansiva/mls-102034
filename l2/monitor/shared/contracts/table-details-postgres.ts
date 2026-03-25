/// <mls fileReference="_102034_/l2/monitor/shared/contracts/table-details-postgres.ts" enhancement="_blank" />
export interface MonitorPostgresTableDetailsResponse {
  generatedAt: string;
  databaseName: string;
  tableName: string;
  description?: string | null;
  moduleId?: string | null;
  repositoryName?: string | null;
  storageProfile?: string | null;
  backupHot?: boolean;
  exists: boolean;
  metrics: {
    rowCount: number;
    totalSizeBytes: number;
  };
  columns: Array<{
    name: string;
    dataType: string;
    isNullable: boolean;
    defaultValue: string | null;
  }>;
  primaryKey: string[];
  indexes: Array<{
    name: string;
    unique: boolean;
    method: string;
    columns: string[];
  }>;
}
