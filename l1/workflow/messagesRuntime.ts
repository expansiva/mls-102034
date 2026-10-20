/// <mls fileReference="_102034_/l1/workflow/messagesRuntime.ts" enhancement="_blank"/>
import {
  createServerMessagesClient,
  type ServerMessagesClient,
} from '/_102034_/l1/server/layer_1_external/collabMessages/client.js';
import type { WorkflowActivityStore } from '/_102034_/l1/workflow/activitiesStore.js';
import { createPostgresWorkflowActivityStore } from '/_102034_/l1/workflow/activitiesPostgres.js';
import { withWorkflowActivityProjection } from '/_102034_/l1/workflow/activitiesSync.js';
import type { TaskOccurrencePort } from '/_102034_/l1/workflow/contracts.js';
import { createMessagesWorkflowIdentities } from '/_102034_/l1/workflow/messagesIdentities.js';
import { createMessagesTaskOccurrencePort } from '/_102034_/l1/workflow/messagesOccurrence.js';

/** Methods the production composition calls. Tests may pass the real client. */
export type RuntimeMessagesClient = Pick<
  ServerMessagesClient,
  'openModuleTask' | 'getModuleTask' | 'advanceModuleTask' | 'linkModulePerson' | 'resolveModulePeople'
>;

export interface RuntimeMessagesTaskPortOptions {
  projectId: string;
  moduleId: string;
  /** Test seam for the real client. There is no memory or stand-in identity. */
  client?: RuntimeMessagesClient;
  /** Server test seam. Production always uses the Postgres projection. */
  projectionStore?: WorkflowActivityStore;
}

/** Production task port. projectId and moduleId come from the server bootstrap. */
export function createRuntimeMessagesTaskPort(options: RuntimeMessagesTaskPortOptions): TaskOccurrencePort {
  const projectId = options.projectId;
  const moduleId = options.moduleId;
  const client = options.client ?? createServerMessagesClient({ projectId });
  const identities = createMessagesWorkflowIdentities({ projectId, client });
  const base = createMessagesTaskOccurrencePort({
    projectId,
    moduleId,
    asUserId: `app:${projectId}`,
    identities,
    client,
  });
  const store = options.projectionStore ?? lazyPostgresProjection(projectId, moduleId);
  return withWorkflowActivityProjection(base, store);
}

/** Pool and table definitions are read on the first refresh or list, not at construction. */
function lazyPostgresProjection(projectId: string, moduleId: string): WorkflowActivityStore {
  let inner: WorkflowActivityStore | undefined;
  function store(): WorkflowActivityStore {
    inner ??= createPostgresWorkflowActivityStore({ projectId, moduleId });
    return inner;
  }
  return {
    projectId,
    moduleId,
    refresh(ctx, key, loadOccurrence) {
      return store().refresh(ctx, key, loadOccurrence);
    },
    list(ctx, query) {
      return store().list(ctx, query);
    },
  };
}
