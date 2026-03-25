/// <mls fileReference="_102034_/l1/mdm/layer_2_controllers/kvHandlers.ts" enhancement="_blank" />
import { ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { getMdmKv, putMdmKv } from '/_102034_/l1/mdm/layer_3_usecases/kvUsecases.js';
import type { GetMdmKvParams, PutMdmKvParams } from '/_102034_/l1/mdm/module.js';

export const kvGetHandler: BffHandler = async ({ ctx, request }) =>
  ok(await getMdmKv(ctx, request.params as GetMdmKvParams));

export const kvPutHandler: BffHandler = async ({ ctx, request }) =>
  ok(await putMdmKv(ctx, request.params as PutMdmKvParams));
