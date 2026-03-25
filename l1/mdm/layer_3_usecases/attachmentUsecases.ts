/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/attachmentUsecases.ts" enhancement="_blank" />
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { AuditLogService, runMonitoredWrite } from '/_102034_/l1/mdm/layer_3_usecases/core/DataRecordService.js';
import type {
  AttachFileParams,
  DetachFileParams,
  FindAttachmentsByEntityParams,
  MdmAttachmentRecord,
  MdmOutboxRecord,
} from '/_102034_/l1/mdm/module.js';
import { moduleConfig } from '/_102034_/l1/mdm/module.js';

function buildAttachmentOutbox(ctx: RequestContext, record: MdmAttachmentRecord): MdmOutboxRecord {
  const nowIso = ctx.clock.nowIso();
  return {
    id: ctx.idGenerator.newId(),
    topic: 'mdm.attachment.write-behind',
    aggregateType: 'MdmAttachment',
    aggregateId: record.id,
    eventType: 'UpsertAttachment',
    payload: record as unknown as Record<string, unknown>,
    attemptCount: 0,
    processedAt: null,
    lastError: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export async function attachFile(ctx: RequestContext, params: AttachFileParams) {
  return runMonitoredWrite(ctx, {
    entityType: params.entityType,
    entityId: params.entityId,
    module: 'mdm',
    routine: 'mdm.attachment.attach',
    action: 'create',
    actorId: params.uploadedBy,
  }, async () => {
    if (!params.fileName.trim() || !params.storageKey.trim() || !params.mimeType.trim()) {
      throw new AppError('VALIDATION_ERROR', 'fileName, mimeType and storageKey are required', 400);
    }
    const uploadedBy = params.uploadedBy ?? ctx.requestMeta?.userId ?? 'system';
    const record: MdmAttachmentRecord = {
      id: ctx.idGenerator.newId(),
      entityType: params.entityType,
      entityId: params.entityId,
      fileName: params.fileName.trim(),
      mimeType: params.mimeType.trim(),
      sizeBytes: params.sizeBytes,
      storageKey: params.storageKey.trim(),
      storageProvider: params.storageProvider,
      category: params.category ?? null,
      uploadedBy,
      uploadedAt: ctx.clock.nowIso(),
      deletedAt: null,
      details: params.details ?? null,
    };
    await ctx.data.runInTransaction(async (runtime) => {
      await runtime.mdmAttachment.insert({ record });
      await AuditLogService.record(ctx, runtime, {
        entityType: 'MdmAttachment',
        entityId: record.id,
        action: 'create',
        module: 'mdm',
        routine: 'mdm.attachment.attach',
        before: null,
        after: record as unknown as Record<string, unknown>,
        actor: { actorId: uploadedBy, actorType: ctx.requestMeta?.userId ? 'user' : 'system' },
      });
      if (moduleConfig.persistence.writeMode === 'writeBehind') {
        await runtime.mdmOutbox.insert({ record: buildAttachmentOutbox(ctx, record) });
      }
    });
    return record;
  });
}

export async function detachFile(ctx: RequestContext, params: DetachFileParams) {
  return runMonitoredWrite(ctx, {
    entityType: 'MdmAttachment',
    entityId: params.id,
    module: 'mdm',
    routine: 'mdm.attachment.detach',
    action: 'delete',
  }, async () => {
    const existing = await ctx.data.mdmAttachment.findOne({ where: { id: params.id } });
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Attachment not found', 404, { id: params.id });
    }
    const updated: MdmAttachmentRecord = {
      ...existing,
      deletedAt: ctx.clock.nowIso(),
    };
    await ctx.data.runInTransaction(async (runtime) => {
      await runtime.mdmAttachment.update({ where: { id: params.id }, patch: updated });
      await AuditLogService.record(ctx, runtime, {
        entityType: 'MdmAttachment',
        entityId: params.id,
        action: 'delete',
        module: 'mdm',
        routine: 'mdm.attachment.detach',
        before: existing as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
      });
      if (moduleConfig.persistence.writeMode === 'writeBehind') {
        await runtime.mdmOutbox.insert({ record: buildAttachmentOutbox(ctx, updated) });
      }
    });
    return updated;
  });
}

export async function findAttachmentsByEntity(ctx: RequestContext, params: FindAttachmentsByEntityParams) {
  const records = await ctx.data.mdmAttachment.findMany({
    where: {
      entityType: params.entityType,
      entityId: params.entityId,
      category: params.category ?? undefined,
    },
    orderBy: { field: 'uploadedAt', direction: 'asc' },
  });
  return records;
}
