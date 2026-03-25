/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/recordUsecases.ts" enhancement="_blank" />
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { MdmDocumentEntity } from '/_102034_/l1/mdm/layer_4_entities/MdmDocumentEntity.js';
import { MdmRecordEntity } from '/_102034_/l1/mdm/layer_4_entities/MdmRecordEntity.js';
import {
  applyPatchToDetail,
  buildEntityIndex,
  buildProspectIndex,
  migrateProspectRelationships,
  normalizeDetailInput,
  normalizeEntityStatus,
  normalizeStatus,
  refreshRelationshipRefs,
  toDocumentRecord,
} from '/_102034_/l1/mdm/layer_3_usecases/mdmSupport.js';
import {
  AuditLogService,
  DataRecordService,
  runMonitoredWrite,
  StatusHistoryService,
} from '/_102034_/l1/mdm/layer_3_usecases/core/DataRecordService.js';
import {
  mdmEntityDef,
  mdmProspectDef,
} from '/_102034_/l1/mdm/layer_3_usecases/core/mdmEntityDefs.js';
import type {
  CreateRecordParams,
  ListRecordsParams,
  MergeEntityParams,
  MdmDocumentRecord,
  MdmOutboxRecord,
  MdmRelationshipDocumentRecord,
  PromoteProspectParams,
  RecordDetailResponse,
  UpdateRecordParams,
} from '/_102034_/l1/mdm/module.js';
import { moduleConfig } from '/_102034_/l1/mdm/module.js';

function buildWriteBehindOutbox(
  ctx: RequestContext,
  document: MdmDocumentRecord,
): MdmOutboxRecord {
  const nowIso = ctx.clock.nowIso();
  return {
    id: ctx.idGenerator.newId(),
    topic: 'mdm.document.write-behind',
    aggregateType: 'MdmDocument',
    aggregateId: document.mdmId,
    eventType: 'UpsertDocument',
    payload: document as unknown as Record<string, unknown>,
    attemptCount: 0,
    processedAt: null,
    lastError: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function buildRelationshipWriteBehindOutbox(
  ctx: RequestContext,
  relationship: MdmRelationshipDocumentRecord,
): MdmOutboxRecord {
  const nowIso = ctx.clock.nowIso();
  return {
    id: ctx.idGenerator.newId(),
    topic: 'mdm.relationship.write-behind',
    aggregateType: 'MdmRelationship',
    aggregateId: relationship.id,
    eventType: 'UpsertRelationship',
    payload: relationship as unknown as Record<string, unknown>,
    attemptCount: 0,
    processedAt: null,
    lastError: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export async function enqueueWriteBehind(
  ctx: RequestContext,
  runtime: RequestContext['data'],
  document: MdmDocumentRecord,
): Promise<void> {
  if (!moduleConfig.persistence.writeMode || moduleConfig.persistence.writeMode !== 'writeBehind') {
    return;
  }

  await runtime.mdmOutbox.insert({
    record: buildWriteBehindOutbox(ctx, document),
  });
}

export async function enqueueRelationshipWriteBehind(
  ctx: RequestContext,
  runtime: RequestContext['data'],
  relationship: MdmRelationshipDocumentRecord,
): Promise<void> {
  if (!moduleConfig.persistence.writeMode || moduleConfig.persistence.writeMode !== 'writeBehind') {
    return;
  }

  await runtime.mdmOutbox.insert({
    record: buildRelationshipWriteBehindOutbox(ctx, relationship),
  });
}

async function getExistingDuplicate(
  ctx: RequestContext,
  detail: ReturnType<typeof normalizeDetailInput>,
) {
  if (detail.subtype === 'Person' || detail.subtype === 'Company') {
    return MdmRecordEntity.findEntityByDocument(ctx, detail.docType, detail.docId);
  }

  if (detail.subtype === 'ContactChannel') {
    return MdmRecordEntity.findEntityByContact(
      ctx,
      (detail.contactType as string | undefined) ?? null,
      (detail.value as string | undefined) ?? null,
    );
  }

  return null;
}

export async function createEntity(
  ctx: RequestContext,
  params: CreateRecordParams,
) {
  const mdmId = ctx.idGenerator.newId();
  const detail = normalizeDetailInput(
    {
      ...params.detail,
      status: (params.detail.status as CreateRecordParams['detail']['status']) ?? 'Active',
    },
    ctx,
    mdmId,
  );
  const duplicate = await getExistingDuplicate(ctx, detail);
  if (duplicate) {
    return {
      alreadyExists: true,
      mdmId: duplicate.mdmId,
    };
  }

  const document = toDocumentRecord(detail, 1);
  await DataRecordService.create(ctx, mdmEntityDef, {
    after: detail,
    afterPersist: async (runtime, state) => {
      await enqueueWriteBehind(ctx, runtime, state.document);
    },
    meta: {
      module: 'mdm',
      routine: 'mdm.entity.create',
    },
  });

  return {
    alreadyExists: false,
    mdmId,
    version: 1,
  };
}

export async function createProspect(
  ctx: RequestContext,
  params: CreateRecordParams,
) {
  const mdmId = ctx.idGenerator.newId();
  const detail = normalizeDetailInput(
    {
      ...params.detail,
      status: (params.detail.status as CreateRecordParams['detail']['status']) ?? 'New',
    },
    ctx,
    mdmId,
  );
  const document = toDocumentRecord(detail, 1);
  await DataRecordService.create(ctx, mdmProspectDef, {
    after: detail,
    afterPersist: async (runtime, state) => {
      await enqueueWriteBehind(ctx, runtime, state.document);
    },
    meta: {
      module: 'mdm',
      routine: 'mdm.prospect.create',
    },
  });

  return {
    mdmId,
    version: 1,
  };
}

export async function getEntity(
  ctx: RequestContext,
  mdmId: string,
): Promise<RecordDetailResponse> {
  const index = await MdmRecordEntity.getEntityIndex(ctx, mdmId);
  const document = await MdmDocumentEntity.get(ctx, mdmId);
  return {
    index,
    document,
    details: MdmDocumentEntity.parseDetails(document),
  };
}

export async function getProspect(
  ctx: RequestContext,
  mdmId: string,
): Promise<RecordDetailResponse> {
  const index = await MdmRecordEntity.getProspectIndex(ctx, mdmId);
  const document = await MdmDocumentEntity.get(ctx, mdmId);
  return {
    index,
    document,
    details: MdmDocumentEntity.parseDetails(document),
  };
}

export async function listEntities(
  ctx: RequestContext,
  params: ListRecordsParams,
) {
  const records = await ctx.data.mdmEntityIndex.findMany({
    limit: params.limit,
    orderBy: params.orderBy,
  });
  return records.filter((record) => {
    if (params.subtype && record.subtype !== params.subtype) {
      return false;
    }
    if (params.status && record.status !== params.status) {
      return false;
    }
    if (params.countryCode && record.countryCode !== params.countryCode) {
      return false;
    }
    return true;
  });
}

export async function listProspects(
  ctx: RequestContext,
  params: ListRecordsParams,
) {
  const records = await ctx.data.mdmProspectIndex.findMany({
    limit: params.limit,
    orderBy: params.orderBy,
  });
  return records.filter((record) => {
    if (params.subtype && record.subtype !== params.subtype) {
      return false;
    }
    if (params.status && record.status !== params.status) {
      return false;
    }
    if (params.countryCode && record.countryCode !== params.countryCode) {
      return false;
    }
    return true;
  });
}

export async function updateEntity(
  ctx: RequestContext,
  params: UpdateRecordParams,
) {
  const currentDocument = await MdmDocumentEntity.get(ctx, params.mdmId);
  const currentDetail = MdmDocumentEntity.parseDetails(currentDocument);
  const nextDetail = applyPatchToDetail(currentDetail, params.patch, ctx);

  if (
    currentDetail.subtype === 'Person' ||
    currentDetail.subtype === 'Company'
  ) {
    const duplicate = await MdmRecordEntity.findEntityByDocument(
      ctx,
      nextDetail.docType,
      nextDetail.docId,
    );
    if (duplicate && duplicate.mdmId !== params.mdmId) {
      throw new AppError('DUPLICATE_RECORD', 'Document already exists', 409, {
        mdmId: duplicate.mdmId,
      });
    }
  }

  if (currentDetail.subtype === 'ContactChannel') {
    const contactDetail = nextDetail as Record<string, unknown>;
    const duplicate = await MdmRecordEntity.findEntityByContact(
      ctx,
      (contactDetail.contactType as string | undefined) ?? null,
      (contactDetail.value as string | undefined) ?? null,
    );
    if (duplicate && duplicate.mdmId !== params.mdmId) {
      throw new AppError('DUPLICATE_CONTACT', 'Contact channel already exists', 409, {
        mdmId: duplicate.mdmId,
      });
    }
  }

  const nextDocument = toDocumentRecord(nextDetail, currentDocument.version + 1);
  await DataRecordService.update(ctx, mdmEntityDef, {
    id: params.mdmId,
    before: currentDocument,
    expectedVersion: params.expectedVersion,
    after: nextDetail,
    meta: {
      module: 'mdm',
      routine: 'mdm.entity.update',
    },
    afterPersist: async (runtime, state) => {
      await enqueueWriteBehind(ctx, runtime, state.document);
    },
  });

  return {
    mdmId: params.mdmId,
    version: nextDocument.version,
    status: normalizeEntityStatus(nextDetail),
  };
}

export async function updateProspect(
  ctx: RequestContext,
  params: UpdateRecordParams,
) {
  const currentDocument = await MdmDocumentEntity.get(ctx, params.mdmId);
  const currentDetail = MdmDocumentEntity.parseDetails(currentDocument);
  const nextDetail = applyPatchToDetail(currentDetail, params.patch, ctx);
  const nextDocument = toDocumentRecord(nextDetail, currentDocument.version + 1);

  await DataRecordService.update(ctx, mdmProspectDef, {
    id: params.mdmId,
    before: currentDocument,
    expectedVersion: params.expectedVersion,
    after: nextDetail,
    meta: {
      module: 'mdm',
      routine: 'mdm.prospect.update',
    },
    afterPersist: async (runtime, state) => {
      await enqueueWriteBehind(ctx, runtime, state.document);
    },
  });

  return {
    mdmId: params.mdmId,
    version: nextDocument.version,
    status: normalizeStatus(nextDetail),
  };
}

export async function promoteProspect(
  ctx: RequestContext,
  params: PromoteProspectParams,
) {
  const prospectIndex = await MdmRecordEntity.getProspectIndex(ctx, params.mdmId);
  const document = await MdmDocumentEntity.get(ctx, params.mdmId);
  const detail = MdmDocumentEntity.parseDetails(document);
  const duplicate = await getExistingDuplicate(ctx, detail);

  if (duplicate) {
    const nextDetail = applyPatchToDetail(
      detail,
      {
        status: 'PendingMerge',
        promotedTo: duplicate.mdmId,
      },
      ctx,
    );
    const nextDocument = toDocumentRecord(nextDetail, document.version + 1);
    return runMonitoredWrite(ctx, {
      entityType: 'MdmProspect',
      entityId: params.mdmId,
      module: 'mdm',
      routine: 'mdm.prospect.promote',
      action: 'transitionStatus',
    }, async () => {
      await ctx.data.runInTransaction(async (runtime) => {
        await runtime.mdmDocument.put({
          record: nextDocument,
          expectedVersion: document.version,
        });
        await runtime.mdmProspectIndex.update({
          where: { mdmId: params.mdmId },
          patch: buildProspectIndex(nextDetail),
        });
        await enqueueWriteBehind(ctx, runtime, nextDocument);
        await runtime.pgQueue.publish({
          topic: 'mdm.pending-merge',
          payload: {
            prospectMdmId: params.mdmId,
            entityMdmId: duplicate.mdmId,
          },
        });
        await StatusHistoryService.record(ctx, runtime, {
          entityType: 'MdmProspect',
          entityId: params.mdmId,
          fromStatus: String(detail.status),
          toStatus: 'PendingMerge',
          module: 'mdm',
          routine: 'mdm.prospect.promote',
        });
        await AuditLogService.record(ctx, runtime, {
          entityType: 'MdmProspect',
          entityId: params.mdmId,
          action: 'transitionStatus',
          module: 'mdm',
          routine: 'mdm.prospect.promote',
          before: mdmProspectDef.getAuditSnapshot(detail, buildProspectIndex(detail)),
          after: mdmProspectDef.getAuditSnapshot(nextDetail, buildProspectIndex(nextDetail)),
        });
      });

      return {
        promoted: false,
        status: 'PendingMerge',
        mdmId: params.mdmId,
        prospectMdmId: params.mdmId,
        candidateMdmId: duplicate.mdmId,
      };
    });
  }

  const nextDetail = applyPatchToDetail(
    detail,
    {
      status: normalizeEntityStatus({
        ...detail,
        status: 'Active',
      }),
      promotedTo: params.mdmId,
    },
    ctx,
  );
  const nextDocument = toDocumentRecord(nextDetail, document.version + 1);

  return runMonitoredWrite(ctx, {
    entityType: 'MdmProspect',
    entityId: params.mdmId,
    module: 'mdm',
    routine: 'mdm.prospect.promote',
    action: 'transitionStatus',
  }, async () => {
    await ctx.data.runInTransaction(async (runtime) => {
      await runtime.mdmDocument.put({
        record: nextDocument,
        expectedVersion: document.version,
      });
      await runtime.mdmEntityIndex.insert({
        record: buildEntityIndex(nextDetail),
      });
      await runtime.mdmProspectIndex.delete({ where: { mdmId: prospectIndex.mdmId } });
      await enqueueWriteBehind(ctx, runtime, nextDocument);
      const { affectedIds, migratedRelationships } = await migrateProspectRelationships(
        { ...ctx, data: runtime },
        prospectIndex.mdmId,
      );
      for (const relationship of migratedRelationships) {
        await enqueueRelationshipWriteBehind(ctx, runtime, {
          ...relationship,
          scope: 'entity',
        });
      }
      await refreshRelationshipRefs(
        { ...ctx, data: runtime },
        'entity',
        affectedIds,
        async (documentToWrite) => enqueueWriteBehind(ctx, runtime, documentToWrite),
      );
      await StatusHistoryService.record(ctx, runtime, {
        entityType: 'MdmProspect',
        entityId: params.mdmId,
        fromStatus: String(detail.status),
        toStatus: normalizeEntityStatus(nextDetail),
        module: 'mdm',
        routine: 'mdm.prospect.promote',
      });
      await AuditLogService.record(ctx, runtime, {
        entityType: 'MdmProspect',
        entityId: params.mdmId,
        action: 'transitionStatus',
        module: 'mdm',
        routine: 'mdm.prospect.promote',
        before: mdmProspectDef.getAuditSnapshot(detail, buildProspectIndex(detail)),
        after: mdmEntityDef.getAuditSnapshot(nextDetail, buildEntityIndex(nextDetail)),
      });
    });

    return {
      promoted: true,
      status: normalizeEntityStatus(nextDetail),
      mdmId: params.mdmId,
    };
  });
}

export async function mergeEntity(
  ctx: RequestContext,
  params: MergeEntityParams,
) {
  if (params.winnerMdmId === params.loserMdmId) {
    throw new AppError('VALIDATION_ERROR', 'winnerMdmId must differ from loserMdmId', 400);
  }

  await MdmRecordEntity.getEntityIndex(ctx, params.winnerMdmId);
  const loserIndex = await MdmRecordEntity.getEntityIndex(ctx, params.loserMdmId);
  const loserDocument = await MdmDocumentEntity.get(ctx, params.loserMdmId);
  const loserDetail = MdmDocumentEntity.parseDetails(loserDocument);

  const nextLoserDetail = applyPatchToDetail(
    loserDetail,
    {
      status: 'Merged',
      mergedInto: params.winnerMdmId,
    },
    ctx,
  );
  const nextDocument = toDocumentRecord(nextLoserDetail, loserDocument.version + 1);
  return runMonitoredWrite(ctx, {
    entityType: 'MdmEntity',
    entityId: params.loserMdmId,
    module: 'mdm',
    routine: 'mdm.entity.merge',
    action: 'transitionStatus',
  }, async () => {
    await ctx.data.runInTransaction(async (runtime) => {
      await runtime.mdmDocument.put({
        record: nextDocument,
        expectedVersion: loserDocument.version,
      });
      await runtime.mdmEntityIndex.update({
        where: { mdmId: loserIndex.mdmId },
        patch: buildEntityIndex(nextLoserDetail),
      });
      await enqueueWriteBehind(ctx, runtime, nextDocument);
      await StatusHistoryService.record(ctx, runtime, {
        entityType: 'MdmEntity',
        entityId: params.loserMdmId,
        fromStatus: String(loserDetail.status),
        toStatus: 'Merged',
        module: 'mdm',
        routine: 'mdm.entity.merge',
      });
      await AuditLogService.record(ctx, runtime, {
        entityType: 'MdmEntity',
        entityId: params.loserMdmId,
        action: 'transitionStatus',
        module: 'mdm',
        routine: 'mdm.entity.merge',
        before: mdmEntityDef.getAuditSnapshot(loserDetail, buildEntityIndex(loserDetail)),
        after: mdmEntityDef.getAuditSnapshot(nextLoserDetail, buildEntityIndex(nextLoserDetail)),
      });
    });

    return {
      winnerMdmId: params.winnerMdmId,
      loserMdmId: params.loserMdmId,
      status: 'Merged',
    };
  });
}
