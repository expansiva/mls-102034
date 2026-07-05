/// <mls fileReference="_102034_/l1/mdm/layer_2_controllers/entityHandlers.ts" enhancement="_blank" />
import { AppError, ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type {
  CreateRecordParams,
  UpdateRecordParams,
} from '/_102034_/l1/mdm/module.js';
import type { MdmListByTypeInput } from '/_102034_/l1/mdm/layer_3_usecases/mdmFacade.js';

type LegacyEntityListParams = Omit<MdmListByTypeInput, 'type'> & {
  type?: string;
  moduleType?: string;
};

export const entityCreateHandler: BffHandler = async ({ ctx, request }) =>
  ok(await ctx.mdm.entity.create({
    details: (request.params as CreateRecordParams).detail,
  }));

export const entityGetHandler: BffHandler = async ({ ctx, request }) =>
  ok(await ctx.mdm.entity.get({ mdmId: String((request.params as { mdmId: string }).mdmId) }));

export const entityListHandler: BffHandler = async ({ ctx, request }) => {
  const params = ((request.params as LegacyEntityListParams | undefined) ?? {});
  const type = params.type ?? params.moduleType;
  if (!type) {
    throw new AppError('INVALID_MDM_LIST_INPUT', 'mdm.entity.list requires canonical type/moduleType', 400);
  }

  return ok(await ctx.mdm.collection.listByType({
    ...params,
    type,
  }));
};

export const entityUpdateHandler: BffHandler = async ({ ctx, request }) =>
  ok(await ctx.mdm.entity.update(request.params as UpdateRecordParams));
