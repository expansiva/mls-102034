/// <mls fileReference="_102034_/l1/workflow/assistantRuntime.ts" enhancement="_blank"/>
import { getSharedIdentityCache } from '/_102034_/l1/server/layer_1_external/cache/identityCache.js';
import { createServerMessagesClient } from '/_102034_/l1/server/layer_1_external/collabMessages/client.js';
import { readProjectsConfig, resolveProjectsPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { getSharedDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/runtimeFactory.js';
import { getResolvedOrganizationCompanyId } from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';
import { createRequestContext, withAlphaAuthorities } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { WorkflowActivityStore } from '/_102034_/l1/workflow/activitiesStore.js';
import { createPostgresWorkflowActivityStore } from '/_102034_/l1/workflow/activitiesPostgres.js';
import {
  listAssistantActivities,
  type AssistantActivitiesInput,
  type AssistantActivitiesResult,
  type AssistantModuleRef,
} from '/_102034_/l1/workflow/assistantActivities.js';
import { createMessagesWorkflowIdentities } from '/_102034_/l1/workflow/messagesIdentities.js';
import { releaseDeclarationOf } from '/_102034_/l1/server/layer_1_external/connections/external/productionExternalSender.js';
import { catalogOfDeclaration } from '/_102034_/l1/server/layer_1_external/connections/moduleSystemsIndex.js';
import { getRunningRelease } from '/_102034_/l1/server/layer_1_external/cbe/cbeRelease.js';
import { lookupLoginEmail } from '/_102034_/l1/mdm/layer_3_usecases/identityUsecases.js';
import { putMdmKv, reserveMdmKv } from '/_102034_/l1/mdm/layer_3_usecases/kvUsecases.js';
import { execMessage } from '/_102034_/l1/server/layer_1_external/transport/message/execMessage.js';
import {
  createAssistantCatalogSource,
  listAssistantCatalog,
  warmAssistantCatalogs,
  type AssistantCatalogInput,
  type AssistantCatalogResult,
} from '/_102034_/l1/workflow/assistantCatalog.js';
import { defsCatalogImporter, distDefsReader } from '/_102034_/l1/workflow/assistantCatalogDefs.js';
import { execAssistantAction, type AssistantAgentAccess, type AssistantExecInput, type AssistantExecResult } from '/_102034_/l1/workflow/assistantExec.js';
import { deliverReleaseCatalog, fingerprintCompiledJs, RELEASE_CATALOG_CONNECTION, RELEASE_CATALOG_OPERATION, type ReleaseCatalogDelivery } from '/_102034_/l1/workflow/releaseCatalogDelivery.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { getSharedPgPool } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import { readMessagesIntegration } from '/_102034_/l1/server/layer_1_external/config/messagesIntegration.js';
import { getMdmKv } from '/_102034_/l1/mdm/layer_3_usecases/kvUsecases.js';
import { findAgentMember } from '/_102034_/l1/mdm/layer_3_usecases/agentMember.js';
import { mdmPlatformServes } from '/_102034_/l1/mdm/layer_3_usecases/platformServes.js';
import { buildServeIndex, createConnectionServer, type ConnectionServeInput, type ServeIndex } from '/_102034_/l1/workflow/connectionServe.js';
import { connectionCatalogs } from '/_102034_/l1/server/layer_1_external/connections/connectionCatalogs.js';
import type { ConnectionResult } from '/_102034_/l2/shared/contracts/connections/types.js';

export type AssistantActivitiesRunner = (input: AssistantActivitiesInput) => Promise<AssistantActivitiesResult>;

/** Modules of the release that keep a workflow projection (listed and with persistence), in release order. */
export function assistantModules(projectId: string): AssistantModuleRef[] {
  const project = readProjectsConfig().projects[projectId];
  const persisted = new Set(
    (project?.persistenceModules ?? [])
      .filter((entry) => typeof entry.tableDefsDir === 'string' && entry.tableDefsDir.length > 0)
      .map((entry) => entry.moduleId),
  );
  return (project?.modules ?? [])
    .filter((entry) => persisted.has(entry.moduleId))
    .map((entry) => ({
      moduleId: entry.moduleId,
      ...(typeof entry.backendControllers === 'string' ? { backendControllers: entry.backendControllers } : {}),
    }));
}

/** Modules of the release that can run an operation (they have a router): the ones that offer a catalog. */
export function assistantExecModules(projectId: string): AssistantModuleRef[] {
  const project = readProjectsConfig().projects[projectId];
  return (project?.modules ?? [])
    .filter((entry) => typeof entry.backendControllers === 'string' || typeof entry.backendRouter === 'string')
    .map((entry) => ({
      moduleId: entry.moduleId,
      ...(typeof entry.backendControllers === 'string' ? { backendControllers: entry.backendControllers } : {}),
    }));
}

export interface AssistantRunners {
  activities: AssistantActivitiesRunner;
  catalog: (input: AssistantCatalogInput) => Promise<AssistantCatalogResult>;
  exec: (input: AssistantExecInput) => Promise<AssistantExecResult>;
  /** An operation of a connection that the module serves (`/exec/connection`). Never throws: every failure is a code. */
  connection: (input: ConnectionServeInput) => Promise<ConnectionResult>;
  /** Delivers the catalogs of the release to the module that serves `platform.releaseCatalogChanged`, once per change. Never throws. */
  deliverReleaseCatalog: () => Promise<ReleaseCatalogDelivery>;
  /** Builds the catalog of every module of the release now, inside the cache the `catalog` request uses; never throws. */
  warmCatalogs: () => Promise<void>;
}

/** The context a server-side caller of the app runs with (no person, no module): the assistant's requests and the connections. */
export function createAssistantContext(projectId: string): RequestContext {
  const companyId = getResolvedOrganizationCompanyId();
  const ctx: RequestContext = createRequestContext(getSharedDataRuntime(), {
    cache: getSharedIdentityCache(),
    moduleId: 'assistant',
    ...(companyId ? { sessionContext: { activeCompanyId: companyId } } : {}),
  });
  ctx.sessionContext.project = { ...ctx.sessionContext.project, projectId };
  return ctx;
}

/**
 * Runs `run` while this process holds the session advisory lock `name` of the shared database, so the processes of a cluster
 * run it one at a time (the delivery of the release catalog only runs in `postgres` mode). A session lock is released when its
 * connection ends, so a process that dies inside does not hold it; the connection error is not swallowed.
 */
async function withProcessLock<T>(name: string, run: () => Promise<T>): Promise<T> {
  const client = await getSharedPgPool(readAppEnv()).connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [name]);
    locked = true;
    return await run();
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [name]);
    } finally {
      client.release();
    }
  }
}

/** Production wiring of the assistant's requests: the real cm identities, the Postgres stores, the screen's alpha. */
export function createAssistantRunners(projectId: string): AssistantRunners {
  const identities = createMessagesWorkflowIdentities({ projectId, client: createServerMessagesClient({ projectId }) });
  const stores = new Map<string, WorkflowActivityStore>();
  const catalogs = createAssistantCatalogSource({
    projectId,
    releaseId: () => getRunningRelease()?.id ?? null,
    importCatalog: defsCatalogImporter(distDefsReader(projectId), projectId),
  });
  const withAlpha = (meta: Parameters<typeof withAlphaAuthorities>[0], moduleId: string, project: string, controllersDir: string | undefined) =>
    withAlphaAuthorities(meta, moduleId, project, controllersDir);
  const newContext = (): RequestContext => createAssistantContext(projectId);
  // The routes that serve an operation, read from the defs of the release and kept per release (none outside a release).
  let served: { releaseId: string; index: Promise<ServeIndex> } | undefined;
  const serveIndex = (): Promise<ServeIndex> => {
    const releaseId = getRunningRelease()?.id ?? null;
    const build = (): Promise<ServeIndex> => buildServeIndex(distDefsReader(projectId), assistantExecModules(projectId).map((entry) => entry.moduleId));
    if (releaseId === null) return build();
    if (!served || served.releaseId !== releaseId) served = { releaseId, index: build() };
    return served.index;
  };
  const serveConnection = createConnectionServer({
    catalogOf: connectionCatalogs(),
    moduleCatalogOf: async (connectionId, moduleId) => {
      const declaration = await releaseDeclarationOf({ projectId, moduleId, systemId: connectionId });
      return declaration ? catalogOfDeclaration(declaration) : undefined;
    },
    index: serveIndex,
    execMessage: (request, ctx) => execMessage(request, ctx),
    newContext,
    toMdmId: (ctx, cmUserId) => identities.toMdmId(ctx, cmUserId),
    platform: mdmPlatformServes,
  });
  // The tools that are ON for an agent: asked of the module that serves the description of the agent (the connection `cm.describe`),
  // from inside and with no roles: the answer is the authority of the agent.
  const agent: AssistantAgentAccess = {
    async allowedActions({ agentId, requestedBy }) {
      let organizationId: string | undefined;
      try {
        organizationId = readMessagesIntegration(projectId).organizationId;
      } catch {
        organizationId = undefined;
      }
      if (!organizationId) return { ok: false, code: 'unavailable', message: 'the app has no organization configured' };
      const described = await serveConnection({
        connectionId: 'cm',
        operationId: 'describe',
        input: { agentId, authorities: [], snapshotAt: new Date().toISOString() },
        context: { organizationId, agentId, ...(requestedBy !== undefined ? { requestedBy } : {}) },
      });
      if (!described.ok) {
        const code = described.code === 'not_found' ? 'no_module' : described.code === 'unavailable' ? 'unavailable' : 'refused';
        return { ok: false, code, message: described.message };
      }
      const allowed = (described.output as { allowed?: unknown } | null)?.allowed;
      if (!Array.isArray(allowed) || !allowed.every((item) => typeof item === 'string')) {
        return { ok: false, code: 'unavailable', message: 'the description of the agent has no list of allowed actions' };
      }
      return { ok: true, allowed };
    },
  };
  return {
    connection: serveConnection,
    deliverReleaseCatalog: () => deliverReleaseCatalog({
      projectId,
      releaseId: () => getRunningRelease()?.id ?? null,
      moduleIds: () => assistantExecModules(projectId).map((entry) => entry.moduleId),
      catalogs,
      serve: serveConnection,
      organizationId: () => {
        try {
          return readMessagesIntegration(projectId).organizationId;
        } catch {
          return undefined;
        }
      },
      kv: { get: (ctx, params) => getMdmKv(ctx, params), put: (ctx, params) => putMdmKv(ctx, params) },
      newContext,
      withLock: withProcessLock,
      consumerFingerprint: async () => {
        const index = await serveIndex();
        const routes = index.byOperation.get(`${RELEASE_CATALOG_CONNECTION}.${RELEASE_CATALOG_OPERATION}`) ?? [];
        if (routes.length === 0) return null;
        const ids = [...new Set(routes.map((route) => route.moduleId))];
        const { fingerprint, missing } = fingerprintCompiledJs(ids.map((id) => ({
          id,
          dir: resolveProjectsPath(`dist/local/_${projectId}_/l1/${id}`),
        })));
        for (const id of missing) console.info(`[release-catalog] compiled module missing: ${id}`);
        return fingerprint;
      },
    }),
    warmCatalogs: () => warmAssistantCatalogs(catalogs, assistantExecModules(projectId).map((entry) => entry.moduleId)),
    activities: (input) => listAssistantActivities(newContext(), {
      projectId,
      modules: assistantModules(projectId),
      identities,
      storeFor(moduleId) {
        let store = stores.get(moduleId);
        if (!store) {
          store = createPostgresWorkflowActivityStore({ projectId, moduleId });
          stores.set(moduleId, store);
        }
        return store;
      },
      withAlpha,
    }, input),
    catalog: (input) => listAssistantCatalog(newContext(), {
      projectId,
      modules: assistantExecModules(projectId),
      identities,
      withAlpha,
      catalogs,
      release: () => getRunningRelease()?.id ?? 'unreleased',
    }, input),
    exec: (input) => execAssistantAction(newContext(), {
      projectId,
      agent,
      modules: assistantExecModules(projectId),
      identities,
      withAlpha,
      catalogs,
      loginEmailOf: (ctx, personMdmId) => lookupLoginEmail(ctx, personMdmId),
      agentMemberOf: (ctx, agentId) => findAgentMember(ctx, agentId),
      execMessage: (request, ctx) => execMessage(request, ctx),
      kv: { reserve: (ctx, params) => reserveMdmKv(ctx, params), put: (ctx, params) => putMdmKv(ctx, params) },
    }, input),
  };
}

const sharedRunners = new Map<string, AssistantRunners>();

/** The runners of the app, built once per process: the boot warm-up and the route share one catalog cache. */
export function sharedAssistantRunners(projectId: string): AssistantRunners {
  let runners = sharedRunners.get(projectId);
  if (!runners) {
    runners = createAssistantRunners(projectId);
    sharedRunners.set(projectId, runners);
  }
  return runners;
}

/** Kept for the route's default: the `activities` runner alone. */
export function createAssistantActivitiesRunner(projectId: string): AssistantActivitiesRunner {
  return createAssistantRunners(projectId).activities;
}
