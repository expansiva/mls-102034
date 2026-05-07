/// <mls fileReference="_102034_/l2/monitor/web/shared/process.ts" enhancement="_blank" />
import type { BffClientOptions } from '/_102029_/l2/bffClient.js';
import type { MonitorProcessResponse } from '/_102034_/l2/monitor/shared/contracts/process.js';
import { execBff } from '/_102029_/l2/bffClient.js';

export async function loadMonitorProcess(options?: BffClientOptions) {
  return execBff<MonitorProcessResponse>('monitor.process.load', {}, options);
}
