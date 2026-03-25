/// <mls fileReference="_102034_/l2/monitor/web/shared/tableInspectPostgres.ts" enhancement="_blank" />
import type { BffClientOptions } from '/_102029_/l2/bffClient.js';
import type { MonitorPostgresTableInspectResponse } from '/_102034_/l2/monitor/shared/contracts/table-inspect-postgres.js';
import { execBff } from '/_102029_/l2/bffClient.js';

export async function loadMonitorPostgresTableInspect(input: {
  databaseName?: string;
  tableName: string;
  page?: number;
  filters?: Record<string, string>;
}, options?: BffClientOptions) {
  return execBff<MonitorPostgresTableInspectResponse>('monitor.postgresTable.inspect', input, options);
}
