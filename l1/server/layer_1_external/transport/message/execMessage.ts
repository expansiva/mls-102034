/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/message/execMessage.ts" enhancement="_blank" />
import { createDefaultRequestContext, execBff } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { BffRequest, RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

export async function execMessage(request: BffRequest, ctx?: RequestContext) {
  return execBff(
    {
      ...request,
      meta: {
        ...request.meta,
        source: request.meta?.source ?? 'message',
      },
    },
    ctx ?? createDefaultRequestContext(),
  );
}
