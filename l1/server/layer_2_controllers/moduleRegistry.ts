/// <mls fileReference="_102034_/l1/server/layer_2_controllers/moduleRegistry.ts" enhancement="_blank" />
import { AppError, type BffHandler, type ModuleBffRegistration, type RoutineResolution } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { readProjectsConfig, resolveProjectModuleImportUrl } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';

const routerCache = new Map<string, Promise<Map<string, BffHandler>>>();

function getConfiguredModuleRegistrations(): ModuleBffRegistration[] {
  const config = readProjectsConfig();
  const configuredProjects = Object.entries(config.projects) as Array<[string, import('/_102034_/l1/server/layer_1_external/config/projectConfig.js').ProjectConfigRecord]>;
  return configuredProjects
    .flatMap(([projectId, project]) => (project.modules ?? [])
      .filter((moduleConfig) => typeof moduleConfig.backendRouter === 'string')
      .map((moduleConfig) => ({
        projectId,
        moduleId: moduleConfig.moduleId,
        frontendBasePath: moduleConfig.basePath,
        frontendEntrypoint: '',
        loadRouter: async () => {
          const moduleUrl = resolveProjectModuleImportUrl(moduleConfig.backendRouter as string);
          const mod = await import(moduleUrl);
          const exportedCreateRouter = Object.entries(mod).find(([key, value]) =>
            key.startsWith('create') && key.endsWith('Router') && typeof value === 'function');
          if (!exportedCreateRouter) {
            throw new Error(`No router factory export found for ${moduleConfig.backendRouter}`);
          }
          const [, createRouter] = exportedCreateRouter;
          return (createRouter as () => Map<string, BffHandler>)();
        },
      })));
}

export function getModuleBffRegistrations() {
  return getConfiguredModuleRegistrations();
}

export function resolveRoutineResolution(routine: string): RoutineResolution {
  const [moduleId, ...rest] = routine.split('.');
  const routineName = rest.join('.');

  if (!moduleId || !routineName) {
    throw new AppError('INVALID_REQUEST', 'routine must include a module and command', 400, {
      routine,
    });
  }

  const registration = getModuleBffRegistrations().find((entry) => entry.moduleId === moduleId);
  if (!registration) {
    throw new AppError('MODULE_NOT_REGISTERED', 'Module is not registered', 404, {
      routine,
      moduleId,
    });
  }

  return {
    moduleId,
    routineName,
    registration,
  };
}

export async function loadModuleRouter(
  registration: ModuleBffRegistration,
): Promise<Map<string, BffHandler>> {
  const cacheKey = `${registration.projectId}:${registration.moduleId}`;
  const cached = routerCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = registration.loadRouter()
    .then((router) => {
      if (!(router instanceof Map)) {
        throw new AppError('MODULE_ROUTER_NOT_FOUND', 'Module router did not return a Map', 500, {
          moduleId: registration.moduleId,
          projectId: registration.projectId,
        });
      }
      return router;
    })
    .catch((error: unknown) => {
      routerCache.delete(cacheKey);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('MODULE_ROUTER_NOT_FOUND', 'Module router could not be loaded', 500, {
        moduleId: registration.moduleId,
        projectId: registration.projectId,
        cause: error instanceof Error ? error.message : String(error),
      });
    });

  routerCache.set(cacheKey, pending);
  return pending;
}

export function resetModuleRouterCache() {
  routerCache.clear();
}
