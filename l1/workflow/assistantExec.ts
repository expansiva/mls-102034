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
 * The assistant's `exec` request, queries only (commands arrive in R3). It runs the same operation the screen runs,
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
  if (code === 'CONCURRENCY_CONFLICT') return { outcome: 'stale_version', error: { code, message } };
  if (statusCode === 400 || statusCode === 422 || code === 'VALIDATION_ERROR') return { outcome: 'invalid_input', error: { code, message } };
  if (statusCode >= 400 && statusCode < 500) return { outcome: 'refused_rule', error: { code, message } };
  return { outcome: 'unavailable', error: { code, message: FIXED_UNAVAILABLE } };
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
  // Commands arrive in R3. Refused before any reservation, so nothing is kept for them.
  if (item.kind !== 'qry') {
    return { outcome: 'invalid_input', error: { code: 'ASSISTANT_COMMAND_NOT_YET', message: 'commands arrive in R3' } };
  }

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
      params: input.input,
      meta: { requestId: input.commandId, verifiedEmail: email, userId: email, actorScope: held },
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
