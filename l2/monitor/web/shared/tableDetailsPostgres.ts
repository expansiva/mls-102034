/// <mls fileReference="_102034_/l2/monitor/web/shared/tableDetailsPostgres.ts" enhancement="_blank" />
import type { BffClientOptions } from '/_102029_/l2/bffClient.js';
import type { MonitorPostgresTableDetailsResponse } from '/_102034_/l2/monitor/shared/contracts/table-details-postgres.js';
import { execBff } from '/_102029_/l2/bffClient.js';

export async function loadMonitorPostgresTableDetails(input: {
  databaseName?: string;
  tableName: string;
}, options?: BffClientOptions) {
  return execBff<MonitorPostgresTableDetailsResponse>('monitor.postgresTable.details', input, options);
}
