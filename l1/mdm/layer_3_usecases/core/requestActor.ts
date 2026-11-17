import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { MdmActorType } from '/_102034_/l1/mdm/module.js';

/**
 * The type of the author of a write: what the server-side caller declared (`agent`: a virtual employee acting in its own name,
 * with its id as `requestMeta.userId`), else a user when there is an author id, else the system. The same table columns
 * hold it; nothing about them changes.
 */
export function requestActorType(ctx: RequestContext): MdmActorType {
  return ctx.requestMeta?.actorType ?? (ctx.requestMeta?.userId ? 'user' : 'system');
}
