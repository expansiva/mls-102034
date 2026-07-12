/// <mls fileReference="_102034_/l2/monitor/web/shared/operations.ts" enhancement="_blank" />
import type { BffClientOptions } from '/_102029_/l2/bffClient.js';
import { execBff } from '/_102029_/l2/bffClient.js';
import type {
  MonitorOperationsSummaryRequest,
  MonitorOperationsSummaryResponse,
} from '/_102034_/l2/monitor/shared/contracts/operations.js';

export async function loadMonitorOperationsSummary(
  params: MonitorOperationsSummaryRequest,
  options?: BffClientOptions,
) {
  return execBff<MonitorOperationsSummaryResponse>('monitor.operations.summary', params, options);
}
