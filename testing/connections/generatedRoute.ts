/**
 * TEST SUPPORT (outside `l1`, `l2` and `l4`: the release never carries it). A route that confirms its own authorization the way the
 * route generator emits it (`authorize` of the L1 emitter): it reads only `request.meta.verifiedAuthorities`, and outside `http`
 * with none it lets the call pass. `actorRefs` are the actors the route lists for its grants.
 */
import type { BffRequest, BffResponse } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

export function createGeneratedRoute(actorRefs: readonly string[], data: unknown = { ok: true }): (request: BffRequest) => Promise<{ response: BffResponse; statusCode: number }> {
  return async (request) => {
    const source = request.meta?.source ?? 'http';
    const authorities = request.meta?.verifiedAuthorities ?? [];
    if (source === 'http' && authorities.length === 0) {
      return { response: { ok: false, error: { code: 'FORBIDDEN_ACTOR', message: 'You have no authority to call this routine.' } } as BffResponse, statusCode: 403 };
    }
    const allowed = actorRefs.length === 0 || authorities.length === 0
      || actorRefs.some((actorRef) => authorities.some((item) => item === actorRef || item.endsWith(`:${actorRef}`)));
    if (!allowed) {
      return { response: { ok: false, error: { code: 'FORBIDDEN_ACTOR', message: 'You have no authority to call this routine.' } } as BffResponse, statusCode: 403 };
    }
    return { response: { ok: true, data } as BffResponse, statusCode: 200 };
  };
}
