/// <mls fileReference="_102034_/l1/mdm/layer_2_controllers/prospectFacadeHandlers.ts" enhancement="_blank" />
import { AppError, ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type {
  CreateRecordParams,
  UpdateRecordParams,
} from '/_102034_/l1/mdm/module.js';
import type { MdmProspectListByTypeInput } from '/_102034_/l1/mdm/layer_3_usecases/mdmFacade.js';

type ProspectListParams = Omit<MdmProspectListByTypeInput, 'type'> & {
  type?: string;
  moduleType?: string;
};

export const prospectCreateHandler: BffHandler = async ({ ctx, request }) =>
  ok(await ctx.mdm.prospect.create({
    details: (request.params as CreateRecordParams).detail,
  }));

export const prospectGetHandler: BffHandler = async ({ ctx, request }) =>
  ok(await ctx.mdm.prospect.get({ mdmId: String((request.params as { mdmId: string }).mdmId) }));

export const prospectListHandler: BffHandler = async ({ ctx, request }) => {
  const params = ((request.params as ProspectListParams | undefined) ?? {});
  const type = params.type ?? params.moduleType;
  if (!type) {
    throw new AppError('INVALID_MDM_PROSPECT_LIST_INPUT', 'mdm.prospect.list requires canonical type/moduleType', 400);
  }

  return ok(await ctx.mdm.prospect.listByType({
    ...params,
    type,
  }));
};

export const prospectUpdateHandler: BffHandler = async ({ ctx, request }) =>
  ok(await ctx.mdm.prospect.update(request.params as UpdateRecordParams));

export const prospectPromoteToEntityHandler: BffHandler = async ({ ctx, request }) =>
  ok(await ctx.mdm.prospect.promoteToEntity({
    mdmId: String((request.params as { mdmId: string }).mdmId),
  }));
