/// <mls fileReference="_102034_/l2/monitor/web/shared/postgres.ts" enhancement="_blank" />
import type { BffClientOptions } from '/_102029_/l2/bffClient.js';
import type { MonitorPostgresResponse } from '/_102034_/l2/monitor/shared/contracts/postgres.js';
import { execBff } from '/_102029_/l2/bffClient.js';

export async function loadMonitorPostgres(databaseName?: string, options?: BffClientOptions) {
  return execBff<MonitorPostgresResponse>('monitor.postgres.load', {
    databaseName,
  }, options);
}
