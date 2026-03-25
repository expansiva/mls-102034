/// <mls fileReference="_102034_/l1/mdm/layer_4_entities/MdmRecordEntity.ts" enhancement="_blank" />
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { MdmDocumentEntity } from '/_102034_/l1/mdm/layer_4_entities/MdmDocumentEntity.js';
import type {
  MdmEntityIndexRecord,
  MdmProspectIndexRecord,
} from '/_102034_/l1/mdm/module.js';

export class MdmRecordEntity {
  public static async getEntityIndex(
    ctx: RequestContext,
    mdmId: string,
  ): Promise<MdmEntityIndexRecord> {
    const record = await ctx.data.mdmEntityIndex.findOne({ where: { mdmId } });
    if (!record) {
      throw new AppError('NOT_FOUND', 'Entity index not found', 404, { mdmId });
    }

    return record;
  }

  public static async getProspectIndex(
    ctx: RequestContext,
    mdmId: string,
  ): Promise<MdmProspectIndexRecord> {
    const record = await ctx.data.mdmProspectIndex.findOne({ where: { mdmId } });
    if (!record) {
      throw new AppError('NOT_FOUND', 'Prospect index not found', 404, { mdmId });
    }

    return record;
  }

  public static async findEntityByDocument(
    ctx: RequestContext,
    docType?: string | null,
    docId?: string | null,
  ): Promise<MdmEntityIndexRecord | null> {
    if (!docType || !docId) {
      return null;
    }

    const records = await ctx.data.mdmEntityIndex.findMany();
    return records.find((record) => record.docType === docType && record.docId === docId) ?? null;
  }

  public static async findEntityByContact(
    ctx: RequestContext,
    contactType?: string | null,
    value?: string | null,
  ): Promise<MdmEntityIndexRecord | null> {
    if (!contactType || !value) {
      return null;
    }

    const entityIndexes = await ctx.data.mdmEntityIndex.findMany({ where: { subtype: 'ContactChannel' } });
    const documents = await ctx.data.mdmDocument.getMany({
      mdmIds: entityIndexes.map((entityIndex) => entityIndex.mdmId),
    });
    const documentsById = new Map(documents.map((document) => [document.mdmId, document]));

    for (const entityIndex of entityIndexes) {
      const document = documentsById.get(entityIndex.mdmId);
      if (!document) {
        continue;
      }

      const details = MdmDocumentEntity.parseDetails(document) as Record<string, unknown>;
      if (details.contactType === contactType && details.value === value) {
        return entityIndex;
      }
    }

    return null;
  }
}
