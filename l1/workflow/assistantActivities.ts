/// <mls fileReference="_102034_/l1/workflow/assistantActivities.ts" enhancement="_blank"/>
import { AppError, type BffRequest, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type {
  WorkflowActivityListItem,
  WorkflowActivityStore,
} from '/_102034_/l1/workflow/activitiesStore.js';

/**
 * The assistant's `activities` request (cm → app): the activity projection of ONE person, across every module of
 * the app. Same for every module: no module name lives here. The person is found through the cm user link,
 * never through anything the body declares; the module authorities are the ones of the snapshot (raw, from the
 * person's login token), plus the alpha's when the project runs under it, by the same function the screen uses.
 */
export interface AssistantOnBehalfOf {
  cmUserId: string;
  /** Raw authorities of the person, `<moduleId>:<actorId>`. */
  authorities: readonly string[];
  snapshotAt: string;
  via: string;
}

export interface AssistantActivitiesInput {
  onBehalfOf: AssistantOnBehalfOf;
  includeNonActionable?: boolean;
  cursor?: string;
}

export interface AssistantModuleRef {
  moduleId: string;
  /** Where the module's authority map is read for the alpha (same value the screen uses). */
  backendControllers?: string;
}

export interface AssistantActivitiesDeps {
  projectId: string;
  /** The modules of the release that keep an activity projection, in release order. */
  modules: readonly AssistantModuleRef[];
  identities: { toMdmId(ctx: RequestContext, cmUserId: string): Promise<string> };
  storeFor(moduleId: string): WorkflowActivityStore;
  /** `withAlphaAuthorities` of the screen's path. It returns the meta with the alpha's authorities merged in. */
  withAlpha(
    meta: BffRequest['meta'],
    moduleId: string,
    projectId: string,
    controllersDir: string | undefined,
  ): Promise<BffRequest['meta']>;
}

export interface AssistantActivitiesResult {
  outcome: 'done' | 'no_person';
  items: WorkflowActivityListItem[];
  /** Opaque, composite: one cursor per module that has more. Absent when nothing is left. */
  cursor?: string;
  /** Modules that did not answer, with the code. The others answered. */
  partial: Array<{ moduleId: string; code: string }>;
}

const NO_PERSON_CODES = new Set(['WORKFLOW_IDENTITY_UNLINKED', 'WORKFLOW_IDENTITY_REMOVED']);

export function encodeAssistantCursor(perModule: Readonly<Record<string, string>>): string | undefined {
  const keys = Object.keys(perModule);
  if (keys.length === 0) return undefined;
  return Buffer.from(JSON.stringify(Object.fromEntries(keys.map((key) => [key, perModule[key]]))), 'utf8').toString('base64url');
}

/** Throws a 400 for anything that is not a cursor this module produced. */
export function decodeAssistantCursor(cursor: string): Record<string, string> {
  const invalid = (): never => {
    throw new AppError('ASSISTANT_CURSOR_INVALID', 'The cursor is not valid.', 400);
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return invalid();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return invalid();
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string' || value === '') return invalid();
    out[key] = value;
  }
  if (Object.keys(out).length === 0) return invalid();
  return out;
}

/** The actor ids the person holds in a module: its authorities with the `<moduleId>:` prefix taken off. */
function actorRefsOf(authorities: readonly string[], moduleId: string): string[] {
  const prefix = `${moduleId}:`;
  const refs: string[] = [];
  for (const authority of authorities) {
    if (typeof authority !== 'string' || !authority.startsWith(prefix) || authority.length === prefix.length) continue;
    const ref = authority.slice(prefix.length);
    if (!refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

function failureCode(error: unknown): string {
  if (error instanceof AppError && typeof error.code === 'string' && error.code !== '') return error.code;
  return 'ASSISTANT_MODULE_FAILED';
}

function newestFirst(left: WorkflowActivityListItem, right: WorkflowActivityListItem): number {
  if (left.syncedAt !== right.syncedAt) return left.syncedAt < right.syncedAt ? 1 : -1;
  if (left.moduleId !== right.moduleId) return left.moduleId < right.moduleId ? -1 : 1;
  if (left.taskId !== right.taskId) return left.taskId < right.taskId ? -1 : 1;
  return 0;
}

export async function listAssistantActivities(
  ctx: RequestContext,
  deps: AssistantActivitiesDeps,
  input: AssistantActivitiesInput,
): Promise<AssistantActivitiesResult> {
  const { onBehalfOf } = input;
  let personMdmId: string;
  try {
    personMdmId = await deps.identities.toMdmId(ctx, onBehalfOf.cmUserId);
  } catch (error) {
    if (error instanceof AppError && NO_PERSON_CODES.has(error.code)) {
      return { outcome: 'no_person', items: [], partial: [] };
    }
    throw error;
  }

  const wanted = input.cursor === undefined ? undefined : decodeAssistantCursor(input.cursor);
  const known = new Set(deps.modules.map((entry) => entry.moduleId));
  if (wanted) {
    for (const moduleId of Object.keys(wanted)) {
      if (!known.has(moduleId)) throw new AppError('ASSISTANT_CURSOR_INVALID', 'The cursor is not valid.', 400);
    }
  }
  // A module of the cursor that no longer answers is asked again; one that was done is not asked again.
  const asked = wanted ? deps.modules.filter((entry) => entry.moduleId in wanted) : deps.modules;

  const items: WorkflowActivityListItem[] = [];
  const next: Record<string, string> = {};
  const partial: Array<{ moduleId: string; code: string }> = [];
  const meta: BffRequest['meta'] = {
    source: 'http',
    verifiedUserId: onBehalfOf.cmUserId,
    verifiedAuthorities: [...onBehalfOf.authorities],
  };

  const answers = await Promise.all(asked.map(async (entry) => {
    try {
      const withAlpha = await deps.withAlpha(meta, entry.moduleId, deps.projectId, entry.backendControllers);
      const actorRefs = actorRefsOf(withAlpha?.verifiedAuthorities ?? [], entry.moduleId);
      const page = await deps.storeFor(entry.moduleId).list(ctx, {
        subject: { personMdmId, actorRefs },
        ...(wanted?.[entry.moduleId] !== undefined ? { cursor: wanted[entry.moduleId] } : {}),
        ...(input.includeNonActionable === true ? { includeNonActionable: true } : {}),
      });
      return { moduleId: entry.moduleId, page };
    } catch (error) {
      return { moduleId: entry.moduleId, code: failureCode(error) };
    }
  }));

  for (const answer of answers) {
    if ('code' in answer) {
      partial.push({ moduleId: answer.moduleId, code: answer.code });
      continue;
    }
    items.push(...answer.page.items);
    if (answer.page.cursor !== undefined) next[answer.moduleId] = answer.page.cursor;
  }
  items.sort(newestFirst);
  const cursor = encodeAssistantCursor(next);
  return { outcome: 'done', items, ...(cursor === undefined ? {} : { cursor }), partial };
}
