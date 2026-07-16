/// <mls fileReference="_102034_/l1/server/layer_2_controllers/moduleRegistry.ts" enhancement="_blank" />
import { existsSync, readdirSync } from 'node:fs';
import { AppError, type BffHandler, type ControllerRoute, type ModuleBffRegistration, type RoutineResolution } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { readProjectsConfig, resolveProjectDistPath, resolveProjectModuleImportUrl } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';

const routerCache = new Map<string, Promise<Map<string, BffHandler>>>();

// Legacy model: a single generated router file exporting create*Router(): Map<routeKey, BffHandler>.
async function loadRouterFromEntrypoint(backendRouter: string): Promise<Map<string, BffHandler>> {
  const moduleUrl = resolveProjectModuleImportUrl(backendRouter);
  const mod = await import(moduleUrl);
  const exportedCreateRouter = Object.entries(mod).find(([key, value]) =>
    key.startsWith('create') && key.endsWith('Router') && typeof value === 'function');
  if (!exportedCreateRouter) {
    throw new Error(`No router factory export found for ${backendRouter}`);
  }
  const [, createRouter] = exportedCreateRouter;
  return (createRouter as () => Map<string, BffHandler>)();
}

// Hexagonal model: discover routes by enumerating the module's controllers folder and reading each
// controller's exported `routes: ControllerRoute[]`. No generated router file.
async function loadRouterFromControllers(controllersDir: string): Promise<Map<string, BffHandler>> {
  const dir = resolveProjectDistPath(controllersDir);
  const router = new Map<string, BffHandler>();
  const files = readdirSync(dir).filter((file) => file.endsWith('.js') && !file.endsWith('.defs.js'));
  for (const file of files) {
    const moduleUrl = resolveProjectModuleImportUrl(`${controllersDir.replace(/\/$/u, '')}/${file}`);
    const mod = await import(moduleUrl);
    const routes = (mod as { routes?: ControllerRoute[] }).routes;
    if (!Array.isArray(routes)) {
      continue;
    }
    for (const route of routes) {
      if (route && typeof route.key === 'string' && typeof route.handler === 'function') {
        router.set(route.key, route.handler);
      }
    }
  }
  return router;
}

// Hexagonal model: the module's composition root (registerRepositories.js inside its tableDefsDir)
// binds each repository port to its adapter factory via registerRepository(). It is discovered
// through the same config link as the table definitions (persistenceModules[].tableDefsDir), so the
// runtime never imports a client project directly — usecases resolve ports only after this ran.
async function loadCompositionRoot(tableDefsDir: string, moduleId: string): Promise<void> {
  const relativePath = `${tableDefsDir.replace(/\/$/u, '')}/registerRepositories.js`;
  if (!existsSync(resolveProjectDistPath(relativePath))) {
    console.warn(`[moduleRegistry] module "${moduleId}" has no composition root (${relativePath}) — its repository ports will not resolve`);
    return;
  }
  await import(resolveProjectModuleImportUrl(relativePath));
}

function getConfiguredModuleRegistrations(): ModuleBffRegistration[] {
  const config = readProjectsConfig();
  const configuredProjects = Object.entries(config.projects) as Array<[string, import('/_102034_/l1/server/layer_1_external/config/projectConfig.js').ProjectConfigRecord]>;
  return configuredProjects
    .flatMap(([projectId, project]) => (project.modules ?? [])
      .filter((moduleConfig) => typeof moduleConfig.backendControllers === 'string' || typeof moduleConfig.backendRouter === 'string')
      .map((moduleConfig) => {
        const tableDefsDir = (project.persistenceModules ?? [])
          .find((persistenceModule) => persistenceModule.moduleId === moduleConfig.moduleId)?.tableDefsDir;
        return {
          projectId,
          moduleId: moduleConfig.moduleId,
          frontendBasePath: moduleConfig.basePath,
          frontendEntrypoint: '',
          loadRouter: async () => {
            if (tableDefsDir) {
              await loadCompositionRoot(tableDefsDir, moduleConfig.moduleId);
            }
            return typeof moduleConfig.backendControllers === 'string'
              ? loadRouterFromControllers(moduleConfig.backendControllers)
              : loadRouterFromEntrypoint(moduleConfig.backendRouter as string);
          },
        };
      }));
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
