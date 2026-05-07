/// <mls fileReference="_102034_/l1/monitor/layer_2_controllers/processHealthHandlers.ts" enhancement="_blank" />
import { ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { loadProcessHealth } from '/_102034_/l1/monitor/layer_3_usecases/processHealthUsecases.js';

export const monitorProcessLoadHandler: BffHandler = async () => ok(loadProcessHealth());
