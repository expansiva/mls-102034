/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/traceUsecases.ts" enhancement="_blank" />
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { MonitorRuntimePostgres } from '/_102034_/l1/monitor/layer_1_external/data/postgres/MonitorRuntimePostgres.js';
import type { MonitorTraceResponse } from '/_102034_/l2/monitor/shared/contracts/trace.js';

export async function loadRequestTrace(input: {
  requestId?: string;
  traceId?: string;
}): Promise<MonitorTraceResponse> {
  const env = readAppEnv();
  const runtime = new MonitorRuntimePostgres(env);
  const entries = await runtime.loadRequestTrace(input);
  return {
    requestId: input.requestId ?? null,
    traceId: input.traceId ?? null,
    entries,
    totalCount: entries.length,
  };
}
