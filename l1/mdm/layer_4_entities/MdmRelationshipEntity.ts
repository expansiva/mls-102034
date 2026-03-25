/// <mls fileReference="_102034_/l1/mdm/layer_4_entities/MdmRelationshipEntity.ts" enhancement="_blank" />
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { MdmRelationshipRecord } from '/_102034_/l1/mdm/module.js';

export class MdmRelationshipEntity {
  public static async findOne(
    ctx: RequestContext,
    id: string,
  ): Promise<{ scope: 'entity' | 'prospect'; relationship: MdmRelationshipRecord }> {
    const entityRelationship = await ctx.data.mdmRelationship.findOne({ where: { id } });
    if (entityRelationship) {
      return {
        scope: 'entity',
        relationship: entityRelationship,
      };
    }

    const prospectRelationship = await ctx.data.mdmProspectRelationship.findOne({ where: { id } });
    if (prospectRelationship) {
      return {
        scope: 'prospect',
        relationship: prospectRelationship,
      };
    }

    throw new AppError('NOT_FOUND', 'Relationship not found', 404, { id });
  }
}
