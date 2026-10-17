/// <mls fileReference="_102034_/l1/mdm/layer_2_controllers/kvHandlers.ts" enhancement="_blank" />
import { ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { getMdmKv, putMdmKv } from '/_102034_/l1/mdm/layer_3_usecases/kvUsecases.js';
import { assertPublicKvKey } from '/_102034_/l1/mdm/layer_3_usecases/registrationStore.js';
import type { GetMdmKvParams, PutMdmKvParams } from '/_102034_/l1/mdm/module.js';

export const kvGetHandler: BffHandler = async ({ ctx, request }) => {
  const params = request.params as GetMdmKvParams;
  assertPublicKvKey(params?.key);
  return ok(await getMdmKv(ctx, params));
};

export const kvPutHandler: BffHandler = async ({ ctx, request }) => {
  const params = request.params as PutMdmKvParams;
  assertPublicKvKey(params?.key);
  return ok(await putMdmKv(ctx, params));
};
