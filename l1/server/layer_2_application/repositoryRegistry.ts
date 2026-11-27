/// <mls fileReference="_102034_/l1/server/layer_2_application/repositoryRegistry.ts" enhancement="_blank" />
import { callerModuleOf } from '/_102034_/l1/server/layer_1_external/connections/callerModule.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

// Generic, client-agnostic repository registry for the hexagonal model.
//
// The application layer (usecases) depends ONLY on a repository PORT interface and resolves the
// concrete adapter through this registry — it never imports the adapter. Client modules register
// their adapter factories at boot (their own registration file calls registerRepository). This file
// is platform infrastructure and MUST NOT import any client project.

export type RepositoryFactory<T> = (ctx: RequestContext) => T;

const factories = new Map<string, RepositoryFactory<unknown>>();
// The same port name may be bound by more than one module (two modules of an app that both need a `CmGateway`): the module is SAID at the registration.
const byModule = new Map<string, Map<string, RepositoryFactory<unknown>>>();

/**
 * Bind a repository port name to the factory that builds its concrete adapter for a request ctx.
 * With `module` the binding is that module's own; without it, it is global and the last one wins (older modules).
 */
export function registerRepository<T>(portName: string, factory: RepositoryFactory<T>, options?: { module?: string }): void {
  const moduleId = options?.module;
  if (moduleId === undefined || moduleId === '') {
    factories.set(portName, factory as RepositoryFactory<unknown>);
    return;
  }
  let own = byModule.get(moduleId);
  if (!own) {
    own = new Map();
    byModule.set(moduleId, own);
  }
  own.set(portName, factory as RepositoryFactory<unknown>);
}

function factoryOf(portName: string): RepositoryFactory<unknown> | undefined {
  const running = callerModuleOf();
  return (running === undefined ? undefined : byModule.get(running)?.get(portName)) ?? factories.get(portName);
}

/** Resolve the concrete repository adapter for a port name, bound to the current request ctx. The running module's binding first, then the global one. */
export function resolveRepository<T>(ctx: RequestContext, portName: string): T {
  const factory = factoryOf(portName);
  if (!factory) {
    const owners = [...byModule.entries()].filter(([, own]) => own.has(portName)).map(([moduleId]) => moduleId).sort();
    if (owners.length > 0) {
      // Never pick one module in silence.
      throw new Error(`[repositoryRegistry] port "${portName}" is registered by modules ${owners.join(', ')}; running module: ${callerModuleOf() ?? 'none'}`);
    }
    throw new Error(`[repositoryRegistry] no repository registered for port "${portName}"`);
  }
  return factory(ctx) as T;
}

export function hasRepository(portName: string): boolean {
  return factoryOf(portName) !== undefined;
}

/** Test/boot helper: clear all registered factories. */
export function clearRepositories(): void {
  factories.clear();
  byModule.clear();
}
