import { randomUUID } from 'node:crypto';
import type { BffRequest, BffResponse, RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { mapBffResult, type AssistantOutcome } from '/_102034_/l1/workflow/assistantExec.js';
import type { DefsReader } from '/_102034_/l1/workflow/assistantCatalogDefs.js';
import type {
  ConnectionCatalog,
  ConnectionContext,
  ConnectionErrorCode,
  ConnectionResult,
} from '/_102034_/l4/ontology/connections/types.defs.js';

/**
 * The operations of a connection that the module SERVES (the connections contract (conexoes.md) §2): the outside system calls
 * the module. Who answers an operation is the route of the release that carries the mark `serves: '<connectionId>.<operationId>'`
 * in its request def (the L1 generates it from the L4); the list is read from the defs of the release and kept per release.
 * The route is run through the internal path, as the assistant's actions are, under the technical identity of the connection
 * (`connection:<connectionId>`), with the person only in the `context`; the authorization of the route is not skipped.
 * No module name lives here.
 */
export interface ServeRoute {
  moduleId: string;
  route: string;
}

export interface ServeIndex {
  /** `<connectionId>.<operationId>` -> the routes that carry the mark. */
  byOperation: Map<string, ServeRoute[]>;
  issues: string[];
}

const MARK = /^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/;

function isRec(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Reads the marks from the request defs of the modules of the release. A def that cannot be read is a line in `issues`, never silence. */
export async function buildServeIndex(reader: DefsReader, moduleIds: readonly string[]): Promise<ServeIndex> {
  const byOperation = new Map<string, ServeRoute[]>();
  const issues: string[] = [];
  for (const moduleId of moduleIds) {
    const folder = `l1/${moduleId}/layer_2_application/requests`;
    for (const name of reader.list(folder)) {
      let definition: unknown;
      try {
        definition = await reader.read(`${folder}/${name}`, 'definition');
      } catch (error) {
        issues.push(`DEF_UNREADABLE: ${folder}/${name}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      const requests = isRec(definition) && isRec(definition.data) && Array.isArray(definition.data.requests) ? definition.data.requests : [];
      for (const request of requests) {
        if (!isRec(request) || request.serves === undefined) continue;
        const route = typeof request.route === 'string' ? request.route : '';
        const mark = typeof request.serves === 'string' ? request.serves : '';
        if (!route || !MARK.test(mark)) {
          issues.push(`SERVES_INVALID: ${route || `${folder}/${name}`}`);
          continue;
        }
        byOperation.set(mark, [...(byOperation.get(mark) ?? []), { moduleId, route }]);
      }
    }
  }
  for (const [mark, routes] of byOperation) {
    if (routes.length > 1) issues.push(`SERVES_DUPLICATE: ${mark}: ${routes.map((entry) => entry.route).join(', ')}`);
  }
  return { byOperation, issues };
}

export interface ConnectionServeInput {
  connectionId: string;
  operationId: string;
  input: unknown;
  context: ConnectionContext;
  idempotencyKey?: string;
}

export interface ConnectionServerDeps {
  catalogOf(connectionId: string): Promise<ConnectionCatalog | undefined>;
  index(): Promise<ServeIndex>;
  execMessage(request: BffRequest, ctx: RequestContext): Promise<{ response: BffResponse; statusCode: number }>;
  newContext(): RequestContext;
  /** The mdm id of a person known by the id in the cm, read only. Throws when the person has no link. */
  toMdmId?(ctx: RequestContext, cmUserId: string): Promise<string>;
  /** One line per call. Default: `console.info`. */
  log?: (line: string) => void;
}

const CODE_OF: Record<Exclude<AssistantOutcome, 'done'>, ConnectionErrorCode> = {
  refused_rule: 'refused',
  forbidden: 'forbidden',
  no_person: 'forbidden',
  not_found: 'not_found',
  stale_version: 'conflict',
  invalid_input: 'invalid',
  unavailable: 'unavailable',
};

export function createConnectionServer(deps: ConnectionServerDeps): (input: ConnectionServeInput) => Promise<ConnectionResult> {
  const log = deps.log ?? ((line: string): void => console.info(line));
  return async (input) => {
    const started = Date.now();
    const name = `${String(input?.connectionId)}.${String(input?.operationId)}`;
    const done = (result: ConnectionResult, reason?: string): ConnectionResult => {
      log(`[connection] serve ${name} ${result.ok ? 'ok=true' : `ok=false code=${result.code}`}${reason ? ` reason=${reason}` : ''} ms=${Date.now() - started}`);
      return result;
    };
    const fail = (code: ConnectionErrorCode, message: string, reason?: string): ConnectionResult => done({ ok: false, code, message }, reason);

    if (typeof input?.connectionId !== 'string' || input.connectionId === '' || typeof input.operationId !== 'string' || input.operationId === '') {
      return fail('invalid', 'connectionId and operationId are required', 'ids');
    }
    if (typeof input.context?.organizationId !== 'string' || input.context.organizationId === '') {
      return fail('invalid', 'context.organizationId is required', 'context');
    }

    let catalog: ConnectionCatalog | undefined;
    try {
      catalog = await deps.catalogOf(input.connectionId);
    } catch (error) {
      return fail('unavailable', 'the connection catalog cannot be read', `catalog-unreadable:${error instanceof Error ? error.name : 'error'}`);
    }
    const operation = catalog?.operations.find((item) => item.operationId === input.operationId);
    if (!operation) return fail('invalid', `unknown operation ${name}`, 'unknown-operation');
    if (operation.direction !== 'serve') return fail('invalid', `${name} is not a serve operation`, 'direction');

    let served: ServeRoute[];
    try {
      served = (await deps.index()).byOperation.get(name) ?? [];
    } catch (error) {
      return fail('unavailable', 'the routes that serve connections cannot be listed', `index-unreadable:${error instanceof Error ? error.name : 'error'}`);
    }
    if (served.length === 0) return fail('not_found', `no route of this release serves ${name}`, 'no-route');
    if (served.length > 1) return fail('invalid', `more than one route serves ${name}`, 'duplicate-mark');
    const { moduleId, route } = served[0];

    const ctx = deps.newContext();
    // The module only sees the mdm id of the person, from the link; one that came in the body is never believed.
    const { actorMdmId: _claimed, ...received } = input.context;
    let context: ConnectionContext = received;
    if (received.actorUserId && deps.toMdmId) {
      try {
        const actorMdmId = await deps.toMdmId(ctx, received.actorUserId);
        if (typeof actorMdmId === 'string' && actorMdmId !== '') context = { ...received, actorMdmId };
      } catch {
        // No link: the call goes on without the mdm id; the module treats the person as unknown. It never guesses and never refuses for this.
      }
    }

    const technical = `connection:${input.connectionId}`;
    let result: ConnectionResult;
    try {
      const answer = await deps.execMessage({
        routine: route,
        params: input.input,
        meta: {
          requestId: input.idempotencyKey ?? randomUUID(),
          userId: technical,
          actorId: technical,
          actorScope: [`${moduleId}:${technical}`],
          connection: {
            connectionId: input.connectionId,
            operationId: input.operationId,
            context,
            ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
          },
        },
      }, ctx);
      const mapped = mapBffResult(answer.response, answer.statusCode, { actors: [] });
      result = mapped.outcome === 'done'
        ? { ok: true, output: mapped.data }
        : { ok: false, code: CODE_OF[mapped.outcome], message: mapped.error?.message || mapped.error?.code || mapped.outcome };
    } catch {
      return fail('unavailable', `${name} could not be served now`, 'exec-failed');
    }
    return done(result);
  };
}
