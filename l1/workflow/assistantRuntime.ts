/// <mls fileReference="_102034_/l1/workflow/assistantRuntime.ts" enhancement="_blank"/>
import { getSharedIdentityCache } from '/_102034_/l1/server/layer_1_external/cache/identityCache.js';
import { createServerMessagesClient } from '/_102034_/l1/server/layer_1_external/collabMessages/client.js';
import { readProjectsConfig } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
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
import { getRunningRelease } from '/_102034_/l1/server/layer_1_external/cbe/cbeRelease.js';
import { lookupLoginEmail } from '/_102034_/l1/mdm/layer_3_usecases/identityUsecases.js';
import { putMdmKv, reserveMdmKv } from '/_102034_/l1/mdm/layer_3_usecases/kvUsecases.js';
import { execMessage } from '/_102034_/l1/server/layer_1_external/transport/message/execMessage.js';
import {
  createAssistantCatalogSource,
  distAssistantCatalogImporter,
  listAssistantCatalog,
  type AssistantCatalogInput,
  type AssistantCatalogResult,
} from '/_102034_/l1/workflow/assistantCatalog.js';
import { execAssistantAction, type AssistantExecInput, type AssistantExecResult } from '/_102034_/l1/workflow/assistantExec.js';

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
}

/** Production wiring of the assistant's requests: the real cm identities, the Postgres stores, the screen's alpha. */
export function createAssistantRunners(projectId: string): AssistantRunners {
  const identities = createMessagesWorkflowIdentities({ projectId, client: createServerMessagesClient({ projectId }) });
  const stores = new Map<string, WorkflowActivityStore>();
  const catalogs = createAssistantCatalogSource({
    projectId,
    releaseId: () => getRunningRelease()?.id ?? null,
    importCatalog: distAssistantCatalogImporter(projectId),
  });
  const withAlpha = (meta: Parameters<typeof withAlphaAuthorities>[0], moduleId: string, project: string, controllersDir: string | undefined) =>
    withAlphaAuthorities(meta, moduleId, project, controllersDir);
  function newContext(): RequestContext {
    const companyId = getResolvedOrganizationCompanyId();
    const ctx: RequestContext = createRequestContext(getSharedDataRuntime(), {
      cache: getSharedIdentityCache(),
      moduleId: 'assistant',
      ...(companyId ? { sessionContext: { activeCompanyId: companyId } } : {}),
    });
    ctx.sessionContext.project = { ...ctx.sessionContext.project, projectId };
    return ctx;
  }
  return {
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
      modules: assistantExecModules(projectId),
      identities,
      withAlpha,
      catalogs,
      loginEmailOf: (ctx, personMdmId) => lookupLoginEmail(ctx, personMdmId),
      execMessage: (request, ctx) => execMessage(request, ctx),
      kv: { reserve: (ctx, params) => reserveMdmKv(ctx, params), put: (ctx, params) => putMdmKv(ctx, params) },
    }, input),
  };
}

/** Kept for the route's default: the `activities` runner alone. */
export function createAssistantActivitiesRunner(projectId: string): AssistantActivitiesRunner {
  return createAssistantRunners(projectId).activities;
}
