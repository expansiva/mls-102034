/// <mls fileReference="_102034_/l1/mdm/layer_2_controllers/relationshipHandlers.ts" enhancement="_blank" />
import { AppError, ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type {
  CreateRelationshipParams,
  ListRelationshipsParams,
  UpdateRelationshipParams,
} from '/_102034_/l1/mdm/module.js';

export const relationshipCreateHandler: BffHandler = async ({ ctx, request }) =>
  ok(await ctx.mdm.entity.link(request.params as CreateRelationshipParams));

export const relationshipListHandler: BffHandler = async ({ ctx, request }) => {
  const params = ((request.params as ListRelationshipsParams | undefined) ?? {});
  if (!params.entityId) {
    throw new AppError('INVALID_MDM_RELATIONSHIP_LIST_INPUT', 'mdm.relationship.list requires entityId', 400);
  }
  if (params.scope && params.scope !== 'entity') {
    throw new AppError('INVALID_RELATIONSHIP_SCOPE', 'Public relationship list supports entity scope only', 400);
  }

  return ok(await ctx.mdm.collection.relatedOfMany({
    mdmIds: [params.entityId],
    type: params.type,
    status: params.status,
  }));
};

export const relationshipUpdateHandler: BffHandler = async ({ ctx, request }) => {
  const params = request.params as UpdateRelationshipParams;
  if (params.patch?.status !== 'Inactive') {
    throw new AppError('INVALID_MDM_RELATIONSHIP_UPDATE', 'Use mdm.entity.unlink for public relationship removal', 400);
  }

  return ok(await ctx.mdm.entity.unlink({ relationshipId: params.id }));
};
