/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/commentUsecases.ts" enhancement="_blank" />
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { AuditLogService, runMonitoredWrite } from '/_102034_/l1/mdm/layer_3_usecases/core/DataRecordService.js';
import type {
  AddCommentParams,
  EditCommentParams,
  FindCommentsByEntityParams,
  MdmCommentRecord,
  MdmOutboxRecord,
  RemoveCommentParams,
} from '/_102034_/l1/mdm/module.js';
import { moduleConfig } from '/_102034_/l1/mdm/module.js';

const EDIT_WINDOW_MS = 15 * 60 * 1000;

function validateText(text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    throw new AppError('VALIDATION_ERROR', 'text is required', 400, { field: 'text' });
  }
  if (normalized.length > 4000) {
    throw new AppError('VALIDATION_ERROR', 'text exceeds 4000 chars', 400, { field: 'text' });
  }
  return normalized;
}

function buildCommentOutbox(ctx: RequestContext, record: MdmCommentRecord): MdmOutboxRecord {
  const nowIso = ctx.clock.nowIso();
  return {
    id: ctx.idGenerator.newId(),
    topic: 'mdm.comment.write-behind',
    aggregateType: 'MdmComment',
    aggregateId: record.id,
    eventType: 'UpsertComment',
    payload: record as unknown as Record<string, unknown>,
    attemptCount: 0,
    processedAt: null,
    lastError: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export async function addComment(ctx: RequestContext, params: AddCommentParams) {
  const text = validateText(params.text);
  return runMonitoredWrite(ctx, {
    entityType: params.entityType,
    entityId: params.entityId,
    module: params.module,
    routine: 'mdm.comment.add',
    action: 'create',
    actorId: params.authorId,
    actorType: params.authorType,
  }, async () => {
    if (params.parentCommentId) {
      const parent = await ctx.data.mdmComment.findOne({ where: { id: params.parentCommentId } });
      if (!parent) {
        throw new AppError('NOT_FOUND', 'Parent comment not found', 404, { id: params.parentCommentId });
      }
      if (parent.parentCommentId) {
        throw new AppError('VALIDATION_ERROR', 'Replies to replies are not allowed', 400);
      }
    }
    const authorId = params.authorId ?? ctx.requestMeta?.userId ?? 'system';
    const authorType = params.authorType ?? (ctx.requestMeta?.userId ? 'user' : 'system');
    const record: MdmCommentRecord = {
      id: ctx.idGenerator.newId(),
      entityType: params.entityType,
      entityId: params.entityId,
      parentCommentId: params.parentCommentId ?? null,
      text,
      authorId,
      authorType,
      module: params.module,
      isSystemGenerated: params.isSystemGenerated ?? false,
      editedAt: null,
      deletedAt: null,
      createdAt: ctx.clock.nowIso(),
    };
    await ctx.data.runInTransaction(async (runtime) => {
      await runtime.mdmComment.insert({ record });
      await AuditLogService.record(ctx, runtime, {
        entityType: 'MdmComment',
        entityId: record.id,
        action: 'create',
        module: params.module,
        routine: 'mdm.comment.add',
        before: null,
        after: record as unknown as Record<string, unknown>,
        actor: { actorId: authorId, actorType: authorType },
      });
      if (moduleConfig.persistence.writeMode === 'writeBehind') {
        await runtime.mdmOutbox.insert({ record: buildCommentOutbox(ctx, record) });
      }
    });
    return record;
  });
}

export async function editComment(ctx: RequestContext, params: EditCommentParams) {
  const text = validateText(params.text);
  return runMonitoredWrite(ctx, {
    entityType: 'MdmComment',
    entityId: params.id,
    module: 'mdm',
    routine: 'mdm.comment.edit',
    action: 'update',
    actorId: params.editorId,
  }, async () => {
    const existing = await ctx.data.mdmComment.findOne({ where: { id: params.id } });
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Comment not found', 404, { id: params.id });
    }
    if (existing.deletedAt) {
      throw new AppError('VALIDATION_ERROR', 'Deleted comment cannot be edited', 400);
    }
    const editorId = params.editorId ?? ctx.requestMeta?.userId ?? 'system';
    if (existing.authorId !== editorId) {
      throw new AppError('FORBIDDEN', 'Only the author may edit the comment', 403);
    }
    const createdAtMs = Date.parse(existing.createdAt);
    if (Number.isFinite(createdAtMs) && Date.now() - createdAtMs > EDIT_WINDOW_MS) {
      throw new AppError('FORBIDDEN', 'Comment edit window expired', 403);
    }
    const updated: MdmCommentRecord = {
      ...existing,
      text,
      editedAt: ctx.clock.nowIso(),
    };
    await ctx.data.runInTransaction(async (runtime) => {
      await runtime.mdmComment.update({ where: { id: params.id }, patch: updated });
      await AuditLogService.record(ctx, runtime, {
        entityType: 'MdmComment',
        entityId: params.id,
        action: 'update',
        module: existing.module,
        routine: 'mdm.comment.edit',
        before: existing as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
        actor: { actorId: editorId, actorType: existing.authorType },
      });
      if (moduleConfig.persistence.writeMode === 'writeBehind') {
        await runtime.mdmOutbox.insert({ record: buildCommentOutbox(ctx, updated) });
      }
    });
    return updated;
  });
}

export async function removeComment(ctx: RequestContext, params: RemoveCommentParams) {
  return runMonitoredWrite(ctx, {
    entityType: 'MdmComment',
    entityId: params.id,
    module: 'mdm',
    routine: 'mdm.comment.remove',
    action: 'delete',
  }, async () => {
    const existing = await ctx.data.mdmComment.findOne({ where: { id: params.id } });
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Comment not found', 404, { id: params.id });
    }
    const updated: MdmCommentRecord = {
      ...existing,
      text: '[removed]',
      deletedAt: ctx.clock.nowIso(),
    };
    await ctx.data.runInTransaction(async (runtime) => {
      await runtime.mdmComment.update({ where: { id: params.id }, patch: updated });
      await AuditLogService.record(ctx, runtime, {
        entityType: 'MdmComment',
        entityId: params.id,
        action: 'delete',
        module: existing.module,
        routine: 'mdm.comment.remove',
        before: existing as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
      });
      if (moduleConfig.persistence.writeMode === 'writeBehind') {
        await runtime.mdmOutbox.insert({ record: buildCommentOutbox(ctx, updated) });
      }
    });
    return updated;
  });
}

export async function findCommentsByEntity(ctx: RequestContext, params: FindCommentsByEntityParams) {
  return ctx.data.mdmComment.findMany({
    where: { entityType: params.entityType, entityId: params.entityId },
    orderBy: { field: 'createdAt', direction: 'asc' },
  });
}
