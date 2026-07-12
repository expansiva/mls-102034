/// <mls fileReference="_102034_/l2/monitor/web/shared/abend.ts" enhancement="_blank" />
import type { BffClientOptions } from '/_102029_/l2/bffClient.js';
import type { MonitorAbendResponse, MonitorClientErrorsResponse } from '/_102034_/l2/monitor/shared/contracts/abend.js';
import { execBff } from '/_102029_/l2/bffClient.js';

export async function loadMonitorAbend(params: { module?: string; limit?: number }, options?: BffClientOptions) {
  return execBff<MonitorAbendResponse>('monitor.abend.load', params, options);
}

export async function loadMonitorClientErrors(params: { limit?: number; sinceHours?: number }, options?: BffClientOptions) {
  return execBff<MonitorClientErrorsResponse>('monitor.clientErrors.load', params, options);
}
