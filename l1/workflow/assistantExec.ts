/// <mls fileReference="_102034_/l1/workflow/assistantExec.ts" enhancement="_blank"/>
import type { BffRequest, BffResponse, RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { AssistantOnBehalfOf } from '/_102034_/l1/workflow/assistantActivities.js';
import {
  assistantModuleAuthorities,
  assistantPerson,
  type AssistantAccessDeps,
} from '/_102034_/l1/workflow/assistantAccess.js';
import type { AssistantCatalogItem, AssistantCatalogSource } from '/_102034_/l1/workflow/assistantCatalog.js';

/**
 * The assistant's `exec` request, commands and queries alike. It runs the same operation the screen runs,
 * through the server entry (`execMessage`), as the person: their login e-mail from the register and their module
 * authorities, never anything the body claims. A `commandId` is taken once, by an insert that fails on a repeat,
 * BEFORE anything runs; repeating it returns what was kept and never runs again. No module name lives here.
 */
export type AssistantOutcome =
  | 'done' | 'refused_rule' | 'forbidden' | 'no_person' | 'not_found' | 'stale_version' | 'invalid_input' | 'unavailable';

export interface AssistantExecInput {
  onBehalfOf: AssistantOnBehalfOf;
  actionId: string;
  input: unknown;
  commandId: string;
  expectVersion?: number;
}

export interface AssistantExecError {
  code: string;
  message: string;
  /** For `forbidden`: the actors that may run the action. */
  required?: string[];
}

export interface AssistantExecResult {
  outcome: AssistantOutcome;
  data?: unknown;
  error?: AssistantExecError;
}

export interface AssistantExecDeps extends AssistantAccessDeps {
  catalogs: AssistantCatalogSource;
  /** The login e-mail of the person, from the register. */
  loginEmailOf(ctx: RequestContext, personMdmId: string): Promise<string | null>;
  execMessage(request: BffRequest, ctx: RequestContext): Promise<{ response: BffResponse; statusCode: number }>;
  kv: {
    reserve(ctx: RequestContext, params: { key: string; value: Record<string, unknown> }): Promise<
      { reserved: true } | { reserved: false; record: { value?: unknown } | null }
    >;
    put(ctx: RequestContext, params: { key: string; value: Record<string, unknown> }): Promise<unknown>;
  };
  now?: () => string;
}

const KEY_PREFIX = 'assistant:';
const FIXED_UNAVAILABLE = 'The operation could not be served now. Nothing was changed.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Maps what the module's entry answered to the contract's `outcome`. The module's own code and message pass for 4xx. */
export function mapBffResult(response: BffResponse, statusCode: number, item: Pick<AssistantCatalogItem, 'actors'>): AssistantExecResult {
  if (response.ok) return { outcome: 'done', data: response.data };
  const code = response.error?.code || 'MODULE_ERROR';
  const message = response.error?.message || '';
  if (statusCode === 403) return { outcome: 'forbidden', error: { code, message, required: [...item.actors] } };
  if (statusCode === 404) {
    if (code === 'MODULE_NOT_REGISTERED' || code === 'ROUTINE_NOT_FOUND') {
      return { outcome: 'unavailable', error: { code, message: FIXED_UNAVAILABLE } };
    }
    return { outcome: 'not_found', error: { code, message } };
  }
  if (code === 'VERSION_CONFLICT' || code === 'CONCURRENCY_CONFLICT') return { outcome: 'stale_version', error: { code, message } };
  if (statusCode === 400 || code === 'VALIDATION_ERROR' || code === 'INVALID_INPUT') return { outcome: 'invalid_input', error: { code, message } };
  // Every other 4xx of the module is its own rule saying no (422 and a 409 of a rule included), with its code and message.
  if (statusCode >= 400 && statusCode < 500) return { outcome: 'refused_rule', error: { code, message } };
  return { outcome: 'unavailable', error: { code, message: FIXED_UNAVAILABLE } };
}

/**
 * `expectVersion` goes where the catalog says the version lives: the input whose `role` is `version`. An action with
 * no such input cannot be given one; an `expectVersion` that arrives for it is the caller's mistake, not ignored.
 */
function withExpectedVersion(
  item: AssistantCatalogItem,
  value: unknown,
  expectVersion: number | undefined,
): { value: unknown } | { error: AssistantExecError } {
  if (expectVersion === undefined) return { value };
  const inputs = Array.isArray(item.inputs) ? (item.inputs as Array<{ path?: unknown; role?: unknown }>) : [];
  const field = inputs.find((entry) => entry?.role === 'version' && typeof entry.path === 'string' && entry.path.length > 0);
  if (!field || typeof field.path !== 'string') {
    return { error: { code: 'ASSISTANT_NO_VERSION_FIELD', message: 'The action has no version field to set expectVersion in.' } };
  }
  if (!isRecord(value)) {
    return { error: { code: 'ASSISTANT_INPUT_NOT_OBJECT', message: 'The input must be an object to carry expectVersion.' } };
  }
  const copy: Record<string, unknown> = structuredClone(value);
  const parts = field.path.split('.');
  let cursor = copy;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (next !== undefined && !isRecord(next)) {
      return { error: { code: 'ASSISTANT_INPUT_NOT_OBJECT', message: 'The input does not fit the version field path.' } };
    }
    const child: Record<string, unknown> = isRecord(next) ? next : {};
    cursor[part] = child;
    cursor = child;
  }
  cursor[parts[parts.length - 1]] = expectVersion;
  return { value: copy };
}

interface Found { moduleId: string; item: AssistantCatalogItem }

async function findAction(deps: AssistantExecDeps, actionId: string): Promise<Found | 'unknown' | 'catalog_failed'> {
  let failed = false;
  for (const entry of deps.modules) {
    const loaded = await deps.catalogs.get(entry.moduleId);
    if (!loaded.ok) {
      failed = true;
      continue;
    }
    const item = [...loaded.catalog.commands, ...loaded.catalog.queries].find((candidate) => candidate.actionId === actionId);
    if (item) return { moduleId: entry.moduleId, item };
  }
  return failed ? 'catalog_failed' : 'unknown';
}

export async function execAssistantAction(
  ctx: RequestContext,
  deps: AssistantExecDeps,
  input: AssistantExecInput,
): Promise<AssistantExecResult> {
  const personMdmId = await assistantPerson(ctx, deps, input.onBehalfOf.cmUserId);
  if (personMdmId === null) return { outcome: 'no_person' };

  const found = await findAction(deps, input.actionId);
  if (found === 'catalog_failed') {
    return { outcome: 'unavailable', error: { code: 'ASSISTANT_CATALOG_UNAVAILABLE', message: FIXED_UNAVAILABLE } };
  }
  if (found === 'unknown') {
    return { outcome: 'invalid_input', error: { code: 'ASSISTANT_ACTION_UNKNOWN', message: 'The action is not in the catalog.' } };
  }
  const { moduleId, item } = found;
  if (item.assistant !== 'included') {
    return { outcome: 'invalid_input', error: { code: 'ASSISTANT_ACTION_EXCLUDED', message: 'The action is not available to the assistant.' } };
  }
  // A command follows exactly the path of a query. Nothing here depends on the item's `risk`: it is information
  // for whoever confirms with the person, and the app does not treat a sensitive action differently (decision 49).
  const params = withExpectedVersion(item, input.input, input.expectVersion);
  if ('error' in params) return { outcome: 'invalid_input', error: params.error };

  const entry = deps.modules.find((candidate) => candidate.moduleId === moduleId);
  const held = entry ? await assistantModuleAuthorities(deps, input.onBehalfOf, entry) : [];
  if (!item.actors.some((actor) => held.includes(`${moduleId}:${actor}`))) {
    return {
      outcome: 'forbidden',
      error: { code: 'FORBIDDEN_ACTOR', message: `You have no authority for ${input.actionId}.`, required: [...item.actors] },
    };
  }
  const email = await deps.loginEmailOf(ctx, personMdmId);
  if (email === null) return { outcome: 'no_person' };

  const key = `${KEY_PREFIX}${input.commandId}`;
  const at = (deps.now ?? (() => new Date().toISOString()))();
  const taken = await deps.kv.reserve(ctx, { key, value: { state: 'reserved', personMdmId, actionId: input.actionId, at } });
  if (!taken.reserved) {
    const kept = isRecord(taken.record?.value) ? taken.record.value : null;
    if (!kept || kept.personMdmId !== personMdmId || kept.actionId !== input.actionId) {
      return { outcome: 'invalid_input', error: { code: 'ASSISTANT_COMMAND_ID_REUSED', message: 'The commandId belongs to another request.' } };
    }
    if (kept.state === 'done' && typeof kept.outcome === 'string') {
      return {
        outcome: kept.outcome as AssistantOutcome,
        ...(kept.data !== undefined ? { data: kept.data } : {}),
        ...(isRecord(kept.error) ? { error: kept.error as unknown as AssistantExecError } : {}),
      };
    }
    // Reserved and never finished (the process stopped midway): it is not run again.
    return { outcome: 'unavailable', error: { code: 'ASSISTANT_COMMAND_UNRESOLVED', message: 'The earlier attempt did not finish; use a new commandId.' } };
  }

  let result: AssistantExecResult;
  try {
    const answer = await deps.execMessage({
      routine: item.route,
      params: params.value,
      meta: {
        requestId: input.commandId,
        verifiedEmail: email,
        userId: email,
        actorScope: held,
        ...(input.onBehalfOf.via === 'nora' ? { via: 'nora' as const } : {}),
      },
    }, ctx);
    result = mapBffResult(answer.response, answer.statusCode, item);
  } catch {
    result = { outcome: 'unavailable', error: { code: 'ASSISTANT_EXEC_FAILED', message: FIXED_UNAVAILABLE } };
  }
  try {
    await deps.kv.put(ctx, {
      key,
      value: { state: 'done', personMdmId, actionId: input.actionId, at, outcome: result.outcome, ...(result.data !== undefined ? { data: result.data } : {}), ...(result.error ? { error: { ...result.error } } : {}) },
    });
  } catch {
    // The result is returned anyway; the key stays reserved, so a repeat answers `unavailable` and never runs again.
  }
  return result;
}
