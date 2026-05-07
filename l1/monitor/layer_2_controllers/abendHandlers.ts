/// <mls fileReference="_102034_/l1/monitor/layer_2_controllers/abendHandlers.ts" enhancement="_blank" />
import { ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { loadAbends } from '/_102034_/l1/monitor/layer_3_usecases/abendUsecases.js';

export const monitorAbendLoadHandler: BffHandler = async ({ request }) => {
  const params = (request.params ?? {}) as Record<string, unknown>;
  const module = typeof params.module === 'string' ? params.module : undefined;
  const limit = typeof params.limit === 'number' ? params.limit : undefined;
  return ok(await loadAbends({ module, limit }));
};
