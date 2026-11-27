/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/cm/cmClient.ts" enhancement="_blank" />
/**
 * `cm(ctx)`: the module calls the cm with the types of the catalog. It sits on top of `callConnection` (same transport, same call
 * record, same translation of people): the module does not resolve a repository to talk to the cm, and it never throws.
 */
import { callConnection, type CallConnection, type CallConnectionContext } from '/_102034_/l1/server/layer_1_external/connections/callConnection.js';
import { cm as cmCatalog, type CmCallId, type CmCallOperations } from '/_102034_/l2/shared/contracts/connections/cm.js';
import type { ConnectionResult } from '/_102034_/l2/shared/contracts/connections/types.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

export interface CmCallOptions {
  /** Default: `<key of the request in course>:<operation>`. Required when the same operation is called twice in one request. */
  idempotencyKey?: string;
  /** The `version` the cm gave when the module read the thing (a string, as the catalog types it). Passed on as it is. */
  expectVersion?: string;
}

/** Who the call is about, besides the person of `ctx` (put by the platform). */
export type CmCallContext = Omit<CallConnectionContext, 'actorMdmId' | 'organizationId' | 'callerModuleId' | 'hookParams' | 'requestedByMdmId'>;

export type CmClient = {
  [K in CmCallId]: (
    input: CmCallOperations[K]['input'],
    options?: CmCallOptions,
    context?: CmCallContext,
  ) => Promise<ConnectionResult<CmCallOperations[K]['output']>>;
};

const COMMANDS = new Set(cmCatalog.operations.filter((operation) => operation.direction === 'call' && operation.kind === 'command').map((operation) => operation.operationId));

/** The key of the request in course: the one of the arrival or of the cm's request, then the request id. Never one the model wrote. */
function requestKeyOf(ctx: RequestContext): string | undefined {
  const fromConnection = ctx.requestMeta?.connection?.idempotencyKey;
  if (typeof fromConnection === 'string' && fromConnection !== '') return fromConnection;
  const requestId = ctx.requestMeta?.requestId;
  return typeof requestId === 'string' && requestId !== '' ? requestId : undefined;
}

/** `true` only for `unavailable` (it includes the timeout): the cm did not answer, so trying again may work. The other codes are answers. */
export function isTransient(result: ConnectionResult<unknown>): boolean {
  return !result.ok && result.code === 'unavailable';
}

export function cm(ctx: RequestContext): CmClient {
  return createCmClient(ctx, callConnection);
}

/** `cm(ctx)` over a given caller. The module uses `cm`; the tests of the platform give their own caller. */
export function createCmClient(ctx: RequestContext, callConnectionImpl: CallConnection): CmClient {
  const call = async (operationId: CmCallId, input: unknown, options?: CmCallOptions, context?: CmCallContext): Promise<ConnectionResult> => {
    try {
      const requestKey = requestKeyOf(ctx);
      const idempotencyKey = options?.idempotencyKey ?? (COMMANDS.has(operationId) && requestKey !== undefined ? `${requestKey}:${operationId}` : undefined);
      const requestId = ctx.requestMeta?.requestId;
      return await callConnectionImpl('cm', operationId, input, { ...context, actorMdmId: ctx.sessionContext.person?.mdmId }, {
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        ...(options?.expectVersion !== undefined ? { expectVersion: options.expectVersion } : {}),
        ...(requestId !== undefined ? { requestId } : {}),
      });
    } catch (error) {
      return { ok: false, code: 'unavailable', message: `cm.${operationId} could not be called: ${error instanceof Error ? error.name : 'error'}` };
    }
  };
  return new Proxy({} as CmClient, {
    get: (_target, name) => (typeof name === 'string' && cmCatalog.operations.some((operation) => operation.direction === 'call' && operation.operationId === name)
      ? (input: unknown, options?: CmCallOptions, context?: CmCallContext) => call(name as CmCallId, input, options, context)
      : undefined),
  });
}
