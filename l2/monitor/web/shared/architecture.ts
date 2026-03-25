/// <mls fileReference="_102034_/l2/monitor/web/shared/architecture.ts" enhancement="_blank" />
import type { BffClientOptions } from '/_102029_/l2/bffClient.js';
import type { MonitorArchitectureResponse } from '/_102034_/l2/monitor/shared/contracts/architecture.js';
import { execBff } from '/_102029_/l2/bffClient.js';

export async function loadMonitorArchitecture(options?: BffClientOptions) {
  return execBff<MonitorArchitectureResponse>('monitor.architecture.load', {}, options);
}
