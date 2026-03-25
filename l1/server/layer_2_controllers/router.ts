/// <mls fileReference="_102034_/l1/server/layer_2_controllers/router.ts" enhancement="_blank" />
import type { BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { getModuleBffRegistrations, loadModuleRouter } from '/_102034_/l1/server/layer_2_controllers/moduleRegistry.js';

export async function createServerRouter(): Promise<Map<string, BffHandler>> {
  const mergedRouter = new Map<string, BffHandler>();
  for (const registration of getModuleBffRegistrations()) {
    const router = await loadModuleRouter(registration);
    for (const [routine, handler] of router.entries()) {
      mergedRouter.set(routine, handler);
    }
  }
  return mergedRouter;
}
