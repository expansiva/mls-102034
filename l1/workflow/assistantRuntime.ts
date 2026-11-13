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

/** Production wiring of the `activities` request: the real cm identities, the Postgres stores, the screen's alpha. */
export function createAssistantActivitiesRunner(projectId: string): AssistantActivitiesRunner {
  const identities = createMessagesWorkflowIdentities({ projectId, client: createServerMessagesClient({ projectId }) });
  const stores = new Map<string, WorkflowActivityStore>();
  return async (input) => {
    const companyId = getResolvedOrganizationCompanyId();
    const ctx: RequestContext = createRequestContext(getSharedDataRuntime(), {
      cache: getSharedIdentityCache(),
      moduleId: 'assistant',
      ...(companyId ? { sessionContext: { activeCompanyId: companyId } } : {}),
    });
    ctx.sessionContext.project = { ...ctx.sessionContext.project, projectId };
    return listAssistantActivities(ctx, {
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
      withAlpha: (meta, moduleId, project, controllersDir) => withAlphaAuthorities(meta, moduleId, project, controllersDir),
    }, input);
  };
}
