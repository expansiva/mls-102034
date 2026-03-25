/// <mls fileReference="_102034_/l2/monitor/web/shared/home.ts" enhancement="_blank" />
import type { BffClientOptions } from '/_102029_/l2/bffClient.js';
import type { MonitorHomeResponse } from '/_102034_/l2/monitor/shared/contracts/home.js';
import { execBff } from '/_102029_/l2/bffClient.js';

export async function loadMonitorHome(options?: BffClientOptions) {
  return execBff<MonitorHomeResponse>('monitor.home.load', {}, options);
}
