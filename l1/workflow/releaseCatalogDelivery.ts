import { createHash } from 'node:crypto';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { AssistantCatalog, AssistantCatalogSource } from '/_102034_/l1/workflow/assistantCatalog.js';
import type { ConnectionServeInput } from '/_102034_/l1/workflow/connectionServe.js';
import type { ConnectionResult } from '/_102034_/l1/server/layer_1_external/connections/catalogs/types.js';

/**
 * The catalog of actions of every module of the release, delivered ONCE per change to the module that serves
 * `platform.releaseCatalogChanged` (the connection of the platform). It runs at boot, after the catalogs are warm; it
 * calls the serve dispatch from inside (no HTTP) and never makes the boot wait or fail. No module name lives here.
 */
export const RELEASE_CATALOG_CONNECTION = 'platform';
export const RELEASE_CATALOG_OPERATION = 'releaseCatalogChanged';
const KEY_PREFIX = 'release-catalog:';

export type ReleaseCatalogDelivery = 'delivered' | 'unchanged' | 'no_module' | 'failed' | 'skipped';

export interface ReleaseCatalogDeliveryDeps {
  projectId: string;
  /** Id of the release running now; `null` outside a release (nothing is delivered then). */
  releaseId: () => string | null;
  moduleIds: () => readonly string[];
  catalogs: AssistantCatalogSource;
  /** The serve dispatch of `/exec/connection`. */
  serve: (input: ConnectionServeInput) => Promise<ConnectionResult>;
  /** The organization of the app (the connection context asks for it). */
  organizationId: () => string | undefined;
  kv: {
    get(ctx: RequestContext, params: { key: string }): Promise<{ value?: unknown } | null>;
    put(ctx: RequestContext, params: { key: string; value: Record<string, unknown> }): Promise<unknown>;
  };
  newContext: () => RequestContext;
  log?: { info: (message: string) => void; error: (message: string) => void };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

/** The hash of the catalogs: the same catalogs give the same hash, whatever the order of the keys. */
export function hashCatalogs(catalogs: readonly AssistantCatalog[]): string {
  return createHash('sha256').update(JSON.stringify(stable([...catalogs].sort((a, b) => (a.module < b.module ? -1 : a.module > b.module ? 1 : 0))))).digest('hex');
}

export async function deliverReleaseCatalog(deps: ReleaseCatalogDeliveryDeps): Promise<ReleaseCatalogDelivery> {
  const log = deps.log ?? console;
  try {
    const releaseId = deps.releaseId();
    if (releaseId === null) return 'skipped';
    const organizationId = deps.organizationId();
    if (!organizationId) {
      log.error('[release-catalog] not delivered: the app has no organization configured');
      return 'skipped';
    }

    const loaded = await Promise.all(deps.moduleIds().map(async (moduleId) => {
      try {
        return await deps.catalogs.get(moduleId);
      } catch {
        return { ok: false as const, code: 'ASSISTANT_CATALOG_UNAVAILABLE' };
      }
    }));
    const catalogs = loaded.flatMap((entry) => (entry.ok ? [entry.catalog] : []));
    if (catalogs.length === 0) {
      log.info('[release-catalog] nothing to deliver: no module has a catalog');
      return 'skipped';
    }
    const hash = hashCatalogs(catalogs);

    const ctx = deps.newContext();
    const key = `${KEY_PREFIX}${deps.projectId}`;
    const last = await deps.kv.get(ctx, { key });
    const delivered = last?.value !== null && typeof last?.value === 'object' ? (last.value as { hash?: unknown }).hash : undefined;
    if (delivered === hash) {
      log.info(`[release-catalog] unchanged (release ${releaseId}): not delivered again`);
      return 'unchanged';
    }

    const result = await deps.serve({
      connectionId: RELEASE_CATALOG_CONNECTION,
      operationId: RELEASE_CATALOG_OPERATION,
      input: { releaseId, hash, catalogs },
      context: { organizationId },
      idempotencyKey: `${releaseId}:${hash}`,
    });
    if (!result.ok) {
      if (result.code === 'not_found') {
        log.info(`[release-catalog] no module serves ${RELEASE_CATALOG_CONNECTION}.${RELEASE_CATALOG_OPERATION}: nothing delivered`);
        return 'no_module';
      }
      log.error(`[release-catalog] not delivered: ${result.code}`);
      return 'failed';
    }
    // The hash is kept only after the module said ok: a failure is tried again at the next boot.
    await deps.kv.put(ctx, { key, value: { hash, releaseId, at: new Date().toISOString() } });
    log.info(`[release-catalog] delivered: release ${releaseId}, ${catalogs.length} module(s)`);
    return 'delivered';
  } catch (error) {
    log.error(`[release-catalog] not delivered: ${error instanceof Error ? error.name : 'error'}`);
    return 'failed';
  }
}
