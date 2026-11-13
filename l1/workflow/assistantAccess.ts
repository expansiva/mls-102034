/// <mls fileReference="_102034_/l1/workflow/assistantAccess.ts" enhancement="_blank"/>
import { AppError, type BffRequest, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { AssistantModuleRef, AssistantOnBehalfOf } from '/_102034_/l1/workflow/assistantActivities.js';

/**
 * What every assistant request needs before it touches a module: who the person is (by the cm user link, never by
 * the body) and which authorities that person holds in a module (the snapshot's, raw, plus the alpha's when the
 * project runs under it, by the same function the screen uses).
 */
export interface AssistantAccessDeps {
  projectId: string;
  /** The modules of the release, in release order. */
  modules: readonly AssistantModuleRef[];
  identities: { toMdmId(ctx: RequestContext, cmUserId: string): Promise<string> };
  withAlpha(
    meta: BffRequest['meta'],
    moduleId: string,
    projectId: string,
    controllersDir: string | undefined,
  ): Promise<BffRequest['meta']>;
}

const NO_PERSON_CODES = new Set(['WORKFLOW_IDENTITY_UNLINKED', 'WORKFLOW_IDENTITY_REMOVED']);

/** The person of the cm user, or null when there is none. Any other identity failure is raised, not hidden. */
export async function assistantPerson(ctx: RequestContext, deps: AssistantAccessDeps, cmUserId: string): Promise<string | null> {
  try {
    return await deps.identities.toMdmId(ctx, cmUserId);
  } catch (error) {
    if (error instanceof AppError && NO_PERSON_CODES.has(error.code)) return null;
    throw error;
  }
}

/** `<moduleId>:<actorId>` held in the module, after the alpha. Authorities of other modules never enter. */
export async function assistantModuleAuthorities(
  deps: AssistantAccessDeps,
  onBehalfOf: AssistantOnBehalfOf,
  entry: AssistantModuleRef,
): Promise<string[]> {
  const meta: BffRequest['meta'] = {
    source: 'http',
    verifiedUserId: onBehalfOf.cmUserId,
    verifiedAuthorities: [...onBehalfOf.authorities],
  };
  const merged = await deps.withAlpha(meta, entry.moduleId, deps.projectId, entry.backendControllers);
  const prefix = `${entry.moduleId}:`;
  const held: string[] = [];
  for (const authority of merged?.verifiedAuthorities ?? []) {
    if (typeof authority === 'string' && authority.startsWith(prefix) && authority.length > prefix.length && !held.includes(authority)) {
      held.push(authority);
    }
  }
  return held;
}
