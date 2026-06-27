/// <mls fileReference="_102034_/l1/server/layer_2_application/repositoryRegistry.ts" enhancement="_blank" />
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

// Generic, client-agnostic repository registry for the hexagonal model.
//
// The application layer (usecases) depends ONLY on a repository PORT interface and resolves the
// concrete adapter through this registry — it never imports the adapter. Client modules register
// their adapter factories at boot (their own registration file calls registerRepository). This file
// is platform infrastructure and MUST NOT import any client project.

export type RepositoryFactory<T> = (ctx: RequestContext) => T;

const factories = new Map<string, RepositoryFactory<unknown>>();

/** Bind a repository port name to the factory that builds its concrete adapter for a request ctx. */
export function registerRepository<T>(portName: string, factory: RepositoryFactory<T>): void {
  factories.set(portName, factory as RepositoryFactory<unknown>);
}

/** Resolve the concrete repository adapter for a port name, bound to the current request ctx. */
export function resolveRepository<T>(ctx: RequestContext, portName: string): T {
  const factory = factories.get(portName);
  if (!factory) {
    throw new Error(`[repositoryRegistry] no repository registered for port "${portName}"`);
  }
  return factory(ctx) as T;
}

export function hasRepository(portName: string): boolean {
  return factories.has(portName);
}

/** Test/boot helper: clear all registered factories. */
export function clearRepositories(): void {
  factories.clear();
}
