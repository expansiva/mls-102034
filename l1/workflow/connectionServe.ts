import { randomUUID } from 'node:crypto';
import type { BffRequest, BffResponse, RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { mapBffResult, type AssistantOutcome } from '/_102034_/l1/workflow/assistantExec.js';
import type { DefsReader } from '/_102034_/l1/workflow/assistantCatalogDefs.js';
import type {
  ConnectionCatalog,
  ConnectionContext,
  ConnectionErrorCode,
  ConnectionResult,
} from '/_102034_/l2/shared/contracts/connections/types.js';

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

/**
 * An operation the PLATFORM answers (`servedBy: 'platform'` in the catalog): there is no route of a module behind it.
 * Registered by whoever owns the data the operation touches, under `<connectionId>.<operationId>`; the engine knows no name.
 */
export type PlatformAnswer = (ctx: RequestContext, input: unknown, context: ConnectionContext) => Promise<ConnectionResult>;
export type PlatformServeRegistry = ReadonlyMap<string, PlatformAnswer>;

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
  /** The answers of the operations marked `servedBy: 'platform'`. Without one for an operation, the call is `unavailable`. */
  platform?: PlatformServeRegistry;
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
    let serveIssues: string[];
    try {
      const listed = await deps.index();
      served = listed.byOperation.get(name) ?? [];
      serveIssues = listed.issues;
    } catch (error) {
      return fail('unavailable', 'the routes that serve connections cannot be listed', `index-unreadable:${error instanceof Error ? error.name : 'error'}`);
    }
    if (operation.servedBy === 'platform') {
      // The platform answers; a route of a module that carries the mark is a mistake of the module and is never run.
      const say = (line: string): void => {
        if (!serveIssues.includes(line)) serveIssues.push(line);
      };
      for (const entry of served) say(`SERVES_INVALID: ${entry.route}: ${name} is answered by the platform`);
      const answer = deps.platform?.get(name);
      if (!answer) {
        say(`PLATFORM_ANSWER_MISSING: ${name}`);
        return fail('unavailable', `${name} has no answer registered`, 'platform-answer-missing');
      }
      const platformCtx = deps.newContext();
      const technicalId = `connection:${input.connectionId}`;
      platformCtx.requestMeta = { requestId: input.idempotencyKey ?? randomUUID(), userId: technicalId, source: 'message', actorType: 'system', connection: { connectionId: input.connectionId, operationId: input.operationId, context: input.context } };
      try {
        return done(await answer(platformCtx, input.input, input.context));
      } catch {
        return fail('unavailable', `${name} could not be answered now`, 'platform-failed');
      }
    }
    if (served.length === 0) return fail('not_found', `no route of this release serves ${name}`, 'no-route');
    if (served.length > 1) return fail('invalid', `more than one route serves ${name}`, 'duplicate-mark');
    const { moduleId, route } = served[0];

    const ctx = deps.newContext();
    // The module only sees the mdm id of the person, from the link; one that came in the body is never believed.
    const { actorMdmId: _claimedActor, requestedByMdmId: _claimedRequester, ...received } = input.context;
    let context: ConnectionContext = received;
    // Both the person of the action and, for an agent in its own name, whoever asked it (without authority).
    for (const [from, to] of [['actorUserId', 'actorMdmId'], ['requestedBy', 'requestedByMdmId']] as const) {
      const cmUserId = received[from];
      if (!cmUserId || !deps.toMdmId) continue;
      try {
        const mdmId = await deps.toMdmId(ctx, cmUserId);
        if (typeof mdmId === 'string' && mdmId !== '') context = { ...context, [to]: mdmId };
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
          // The same value in both: `actorScope` is read by the engine, `verifiedAuthorities` by the `authorize` the route carries.
          actorScope: [`${moduleId}:${technical}`],
          verifiedAuthorities: [`${moduleId}:${technical}`],
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

/**
 * A route that RECEIVES a module event carries `consumes: '<module>.<eventId>'` in the same request def that
 * carries `serves`. Delivery (a later step) runs as `module:<publisher>` with the route's own authorize:
 * `actorScope` and `verifiedAuthorities` are `${consumerModule}:${moduleEventTechnicalId(publisher)}`.
 */
export interface ConsumesIndex {
  /** `<module>.<eventId>` -> the routes that carry the mark. */
  byMark: Map<string, ServeRoute[]>;
  issues: string[];
}

export async function buildConsumesIndex(reader: DefsReader, moduleIds: readonly string[]): Promise<ConsumesIndex> {
  const byMark = new Map<string, ServeRoute[]>();
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
        if (!isRec(request) || request.consumes === undefined) continue;
        const route = typeof request.route === 'string' ? request.route : '';
        const mark = typeof request.consumes === 'string' ? request.consumes : '';
        if (!route || !MARK.test(mark)) {
          issues.push(`CONSUMES_INVALID: ${route || `${folder}/${name}`}`);
          continue;
        }
        byMark.set(mark, [...(byMark.get(mark) ?? []), { moduleId, route }]);
      }
    }
  }
  for (const [mark, routes] of byMark) {
    const seen = new Map<string, number>();
    for (const entry of routes) seen.set(entry.moduleId, (seen.get(entry.moduleId) ?? 0) + 1);
    for (const [owner, count] of seen) {
      if (count > 1) issues.push(`CONSUMES_DUPLICATE: ${mark}: ${owner}`);
    }
  }
  return { byMark, issues };
}

/** The one route of `moduleId` that carries `mark`. None, or more than one, is undefined. */
export function findConsumesRoute(index: ConsumesIndex, moduleId: string, mark: string): ServeRoute | undefined {
  const routes = (index.byMark.get(mark) ?? []).filter((entry) => entry.moduleId === moduleId);
  if (routes.length !== 1) return undefined;
  return routes[0];
}

/** Technical actor of a delivery. Authorization of the route is not skipped. */
export function moduleEventTechnicalId(publisherModule: string): string {
  return `module:${publisherModule}`;
}
