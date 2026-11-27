/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/cm/serveCm.ts" enhancement="_blank" />
/**
 * `serveCm(operationId, decide)`: the body of a route that the cm calls (`serves: 'cm.<operation>'` in the def). The module only
 * decides; the platform does the origin, the check of the input against the catalog type, the transaction and the shape of a refusal.
 */
import { AppError, type ControllerRoute, type IRequestEnvelope, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { callerModuleOf } from '/_102034_/l1/server/layer_1_external/connections/callerModule.js';
import { checkCmServeInput } from '/_102034_/l1/server/layer_1_external/connections/cm/cmInputCheck.js';
import type { CmServeId, CmServeOperations } from '/_102034_/l2/shared/contracts/connections/cm.js';

/** The decision of the module. A refusal is an answer, not an error: it is committed and returned to the cm. */
export type CmServeAnswer<O> =
  | { ok: true; output: O }
  | {
    ok: false;
    code: 'refused' | 'invalid' | 'not_found' | 'conflict' | 'forbidden';
    message: string;
    /** The module's own reason, lowerCamel (e.g. `conversationBlocked`). Goes to the cm as the start of the message. */
    reason?: string;
  };

/**
 * The status and the error code that `mapBffResult` turns back into the same `code` at the cm. `conflict` rides a 409 with a
 * version-conflict code: any other 409 is read as a refusal of a rule.
 */
const REFUSAL: Record<Exclude<CmServeAnswer<unknown>, { ok: true }>['code'], { status: number; code: string }> = {
  refused: { status: 422, code: 'CM_REFUSED' },
  invalid: { status: 400, code: 'VALIDATION_ERROR' },
  not_found: { status: 404, code: 'NOT_FOUND' },
  conflict: { status: 409, code: 'VERSION_CONFLICT' },
  forbidden: { status: 403, code: 'FORBIDDEN' },
};

export function serveCm<K extends CmServeId>(
  operationId: K,
  decide: (input: CmServeOperations[K]['input'], ctx: RequestContext) => Promise<CmServeAnswer<CmServeOperations[K]['output']>>,
): ControllerRoute['handler'] {
  return async (envelope: IRequestEnvelope) => {
    const { request, ctx } = envelope;
    // 1. Origin: only the connectionServe of the platform, for this operation, as the technical actor of the cm in this module.
    const connection = request.meta?.connection;
    const running = callerModuleOf();
    const authority = running === undefined ? undefined : `${running}:connection:cm`;
    const authorities = request.meta?.verifiedAuthorities ?? [];
    const held = authority === undefined ? authorities.some((item) => item.endsWith(':connection:cm')) : authorities.includes(authority);
    if (connection?.connectionId !== 'cm' || connection.operationId !== operationId || !held) {
      throw new AppError('FORBIDDEN_ACTOR', 'Only the cm may call this routine.', 403);
    }
    // 2. The input, by the type of the catalog.
    const params = request.params;
    const wrong = checkCmServeInput(operationId, params);
    if (wrong !== null) throw new AppError('VALIDATION_ERROR', wrong, 400);
    // 3. The transaction: an answer (a refusal too) commits, an exception undoes everything.
    const answer = await ctx.data.moduleData.runInTransaction((tx) =>
      decide(params as CmServeOperations[K]['input'], { ...ctx, data: { ...ctx.data, moduleData: tx } } as RequestContext));
    if (answer.ok) return { ok: true, data: answer.output, error: null };
    // 4. The refusal has one shape. It is thrown AFTER the commit.
    const shape = REFUSAL[answer.code];
    const message = answer.reason !== undefined && answer.reason !== '' ? `${answer.reason}: ${answer.message}` : answer.message;
    throw new AppError(shape.code, message, shape.status);
  };
}
