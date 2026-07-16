/// <mls fileReference="_102034_/l2/monitor/web/shared/tests.ts" enhancement="_blank" />
import type { BffClientOptions } from '/_102029_/l2/bffClient.js';
import type { MonitorTestRunSummary, MonitorTestsListResponse, MonitorTestsResultsResponse } from '/_102034_/l2/monitor/shared/contracts/tests.js';
import { execBff } from '/_102029_/l2/bffClient.js';

export async function loadMonitorTestsList(options?: BffClientOptions) {
  return execBff<MonitorTestsListResponse>('monitor.tests.list', {}, options);
}

export async function runMonitorTests(params: { moduleId?: string; page?: string; skipMutating?: boolean }, options?: BffClientOptions) {
  return execBff<MonitorTestRunSummary>('monitor.tests.run', params, options);
}

export async function loadMonitorTestsResults(params: { moduleId?: string; page?: string; runId?: string; limit?: number }, options?: BffClientOptions) {
  return execBff<MonitorTestsResultsResponse>('monitor.tests.results', params, options);
}
