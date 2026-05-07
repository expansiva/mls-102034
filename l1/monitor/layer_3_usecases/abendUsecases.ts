/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/abendUsecases.ts" enhancement="_blank" />
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { MonitorRuntimePostgres } from '/_102034_/l1/monitor/layer_1_external/data/postgres/MonitorRuntimePostgres.js';
import type { MonitorAbendResponse } from '/_102034_/l2/monitor/shared/contracts/abend.js';

export async function loadAbends(input: {
  module?: string;
  limit?: number;
}): Promise<MonitorAbendResponse> {
  const env = readAppEnv();
  const runtime = new MonitorRuntimePostgres(env);
  const entries = await runtime.loadAbends(input);
  return {
    entries,
    totalCount: entries.length,
    generatedAt: new Date().toISOString(),
  };
}
