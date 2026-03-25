/// <mls fileReference="_102034_/l1/mdm/layer_4_entities/MdmDocumentEntity.ts" enhancement="_blank" />
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { MdmDetailRecord, MdmDocumentRecord } from '/_102034_/l1/mdm/module.js';

export class MdmDocumentEntity {
  public static async get(
    ctx: RequestContext,
    mdmId: string,
  ): Promise<MdmDocumentRecord> {
    const document = await ctx.data.mdmDocument.get({ mdmId });
    if (!document) {
      throw new AppError('NOT_FOUND', 'Document not found', 404, { mdmId });
    }

    return document;
  }

  public static parseDetails(document: MdmDocumentRecord): MdmDetailRecord {
    if (typeof document.details === 'string') {
      return JSON.parse(document.details) as MdmDetailRecord;
    }

    return document.details;
  }

  public static async create(
    ctx: RequestContext,
    record: MdmDocumentRecord,
  ): Promise<void> {
    await ctx.data.mdmDocument.put({ record });
  }

  public static async replace(
    ctx: RequestContext,
    record: MdmDocumentRecord,
    expectedVersion: number,
  ): Promise<void> {
    await ctx.data.mdmDocument.put({ record, expectedVersion });
  }
}
