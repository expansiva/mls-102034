/// <mls fileReference="_102034_/l2/monitor/shared/contracts/table-inspect-postgres.ts" enhancement="_blank" />
export interface MonitorPostgresTableInspectResponse {
  generatedAt: string;
  databaseName: string;
  tableName: string;
  description?: string | null;
  moduleId?: string | null;
  repositoryName?: string | null;
  storageProfile?: string | null;
  backupHot?: boolean;
  exists: boolean;
  columns: Array<{
    name: string;
    dataType: string;
    isNullable: boolean;
  }>;
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
  filters: Record<string, string>;
  rows: Array<Record<string, unknown>>;
  order: {
    primary: string[];
    fallback: string;
  };
}
