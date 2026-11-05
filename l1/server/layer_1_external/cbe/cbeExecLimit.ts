/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeExecLimit.ts" enhancement="_blank" />

import type { FastifyError, FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';

/** Largest body /exec takes. The nginx of the VM (client_max_body_size) must be the same value. */
export const EXEC_BODY_LIMIT = 4 * 1024 * 1024;
export const EXEC_BODY_TOO_LARGE_MSG = 'request body larger than 4 MB';
const HTTP_PAYLOAD_TOO_LARGE = 413;
const BODY_TOO_LARGE_CODE = 'FST_ERR_CTP_BODY_TOO_LARGE';

/** Route-level handler: a body over the limit answers 413 with the reason; any other error goes on as before. */
export function execErrorHandler(error: FastifyError, _request: FastifyRequest, reply: FastifyReply): void {
  if (error.code === BODY_TOO_LARGE_CODE) {
    reply.code(HTTP_PAYLOAD_TOO_LARGE).send({ statusCode: HTTP_PAYLOAD_TOO_LARGE, status: 'error', msg: EXEC_BODY_TOO_LARGE_MSG });
    return;
  }
  reply.send(error);
}

export const EXEC_ROUTE_OPTIONS: RouteShorthandOptions = {
  bodyLimit: EXEC_BODY_LIMIT,
  errorHandler: execErrorHandler,
};
