/// <mls fileReference="_102034_/l1/monitor/layer_2_controllers/traceHandlers.ts" enhancement="_blank" />
import { ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { loadRequestTrace } from '/_102034_/l1/monitor/layer_3_usecases/traceUsecases.js';

export const monitorRequestTraceLoadHandler: BffHandler = async ({ request }) => {
  const params = (request.params ?? {}) as Record<string, unknown>;
  const requestId = typeof params.requestId === 'string' ? params.requestId : undefined;
  const traceId = typeof params.traceId === 'string' ? params.traceId : undefined;
  return ok(await loadRequestTrace({ requestId, traceId }));
};
