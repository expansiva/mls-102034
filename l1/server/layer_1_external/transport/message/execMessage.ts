/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/message/execMessage.ts" enhancement="_blank" />
import { createDefaultRequestContext, execBff } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { BffRequest, RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

export async function execMessage(request: BffRequest, ctx?: RequestContext) {
  return execBff(
    {
      ...request,
      meta: {
        ...request.meta,
        // The TRANSPORT stamps the source, never the caller — same rule the HTTP transport already
        // followed by spreading the client meta first. `source` decides which identity claims execBff
        // trusts, so a caller able to choose it could call itself `test` and get the trusted branch.
        source: 'message',
      },
    },
    ctx ?? createDefaultRequestContext(),
  );
}
