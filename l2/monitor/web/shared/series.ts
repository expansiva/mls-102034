/// <mls fileReference="_102034_/l2/monitor/web/shared/series.ts" enhancement="_blank" />
import type { BffClientOptions } from '/_102029_/l2/bffClient.js';
import type { MonitorStatisticsSeriesResponse } from '/_102034_/l2/monitor/shared/contracts/home.js';
import { execBff } from '/_102029_/l2/bffClient.js';

export async function loadMonitorSeries(windowSeconds = 100, options?: BffClientOptions) {
  return execBff<MonitorStatisticsSeriesResponse>('monitor.monitorGetStatistics.getSeries', {
    windowSeconds,
  }, options);
}
