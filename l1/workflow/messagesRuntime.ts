/// <mls fileReference="_102034_/l1/workflow/messagesRuntime.ts" enhancement="_blank"/>
import {
  createServerMessagesClient,
  type ServerMessagesClient,
} from '/_102034_/l1/server/layer_1_external/collabMessages/client.js';
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
}

/** Production task port. projectId and moduleId come from the server bootstrap. */
export function createRuntimeMessagesTaskPort(options: RuntimeMessagesTaskPortOptions): TaskOccurrencePort {
  const projectId = options.projectId;
  const client = options.client ?? createServerMessagesClient({ projectId });
  const identities = createMessagesWorkflowIdentities({ projectId, client });
  return createMessagesTaskOccurrencePort({
    projectId,
    moduleId: options.moduleId,
    asUserId: `app:${projectId}`,
    identities,
    client,
  });
}
