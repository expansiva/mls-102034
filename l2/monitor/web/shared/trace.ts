/// <mls fileReference="_102034_/l2/monitor/web/shared/trace.ts" enhancement="_blank" />
import type { BffClientOptions } from '/_102029_/l2/bffClient.js';
import type { MonitorTraceResponse } from '/_102034_/l2/monitor/shared/contracts/trace.js';
import { execBff } from '/_102029_/l2/bffClient.js';

export interface MonitorTraceLoadParams {
  requestId?: string;
  traceId?: string;
}

export async function loadMonitorTrace(params: MonitorTraceLoadParams, options?: BffClientOptions) {
  return execBff<MonitorTraceResponse>('monitor.requestTrace.load', params, options);
}
