/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/tagUsecases.ts" enhancement="_blank" />
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  AuditLogService,
  runMonitoredWrite,
} from '/_102034_/l1/mdm/layer_3_usecases/core/DataRecordService.js';
import type {
  AddTagParams,
  FindTagsByEntityParams,
  FindTagsByTagParams,
  MdmOutboxRecord,
  MdmTagRecord,
  RemoveTagParams,
} from '/_102034_/l1/mdm/module.js';
import { moduleConfig } from '/_102034_/l1/mdm/module.js';

function normalizeTagValue(value: string): string {
  return value.trim().toLowerCase();
}

function validateTagValue(tag: string): void {
  if (!tag) {
    throw new AppError('VALIDATION_ERROR', 'tag is required', 400, { field: 'tag' });
  }
  if (tag.length > 50) {
    throw new AppError('VALIDATION_ERROR', 'tag exceeds 50 chars', 400, { field: 'tag' });
  }
  if (/\s/u.test(tag)) {
    throw new AppError('VALIDATION_ERROR', 'tag cannot contain spaces', 400, { field: 'tag' });
  }
}

function buildTagOutbox(
  ctx: RequestContext,
  record: MdmTagRecord,
): MdmOutboxRecord {
  const nowIso = ctx.clock.nowIso();
  return {
    id: ctx.idGenerator.newId(),
    topic: 'mdm.tag.write-behind',
    aggregateType: 'MdmTag',
    aggregateId: record.id,
    eventType: 'UpsertTag',
    payload: record as unknown as Record<string, unknown>,
    attemptCount: 0,
    processedAt: null,
    lastError: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export async function addTag(
  ctx: RequestContext,
  params: AddTagParams,
) {
  const normalizedTag = normalizeTagValue(params.tag);
  validateTagValue(normalizedTag);

  return runMonitoredWrite(ctx, {
    entityType: params.entityType,
    entityId: params.entityId,
    module: params.module,
    routine: 'mdm.tag.add',
    action: 'create',
    actorId: params.createdBy,
    actorType: params.createdByType,
  }, async () => {
    const existing = await ctx.data.mdmTag.findOne({
      where: {
        entityType: params.entityType,
        entityId: params.entityId,
        tag: normalizedTag,
        module: params.module,
      },
    });

    if (existing) {
      return {
        alreadyExists: true,
        tag: existing,
      };
    }

    const actorId = params.createdBy ?? ctx.requestMeta?.userId ?? 'system';
    const actorType = params.createdByType ?? (ctx.requestMeta?.userId ? 'user' : 'system');
    const record: MdmTagRecord = {
      id: ctx.idGenerator.newId(),
      entityType: params.entityType,
      entityId: params.entityId,
      tag: normalizedTag,
      namespace: params.namespace ?? null,
      module: params.module,
      createdBy: actorId,
      createdByType: actorType,
      createdAt: ctx.clock.nowIso(),
    };

    await ctx.data.runInTransaction(async (runtime) => {
      await runtime.mdmTag.insert({ record });
      await AuditLogService.record(ctx, runtime, {
        entityType: 'MdmTag',
        entityId: record.id,
        action: 'create',
        module: params.module,
        routine: 'mdm.tag.add',
        before: null,
        after: record as unknown as Record<string, unknown>,
        actor: {
          actorId,
          actorType,
        },
      });
      if (moduleConfig.persistence.writeMode === 'writeBehind') {
        await runtime.mdmOutbox.insert({
          record: buildTagOutbox(ctx, record),
        });
      }
    });

    return {
      alreadyExists: false,
      tag: record,
    };
  });
}

export async function removeTag(
  ctx: RequestContext,
  params: RemoveTagParams,
) {
  const normalizedTag = normalizeTagValue(params.tag);
  validateTagValue(normalizedTag);

  return runMonitoredWrite(ctx, {
    entityType: params.entityType,
    entityId: params.entityId,
    module: params.module,
    routine: 'mdm.tag.remove',
    action: 'delete',
  }, async () => {
    const existing = await ctx.data.mdmTag.findOne({
      where: {
        entityType: params.entityType,
        entityId: params.entityId,
        tag: normalizedTag,
        module: params.module,
      },
    });

    if (!existing) {
      throw new AppError('NOT_FOUND', 'Tag not found', 404, {
        entityType: params.entityType,
        entityId: params.entityId,
        tag: normalizedTag,
        module: params.module,
      });
    }

    await ctx.data.runInTransaction(async (runtime) => {
      await runtime.mdmTag.delete({
        where: {
          entityType: params.entityType,
          entityId: params.entityId,
          tag: normalizedTag,
          module: params.module,
        },
      });
      await AuditLogService.record(ctx, runtime, {
        entityType: 'MdmTag',
        entityId: existing.id,
        action: 'delete',
        module: params.module,
        routine: 'mdm.tag.remove',
        before: existing as unknown as Record<string, unknown>,
        after: null,
      });
    });

    return {
      removed: true,
      id: existing.id,
    };
  });
}

export async function findTagsByEntity(
  ctx: RequestContext,
  params: FindTagsByEntityParams,
) {
  const records = await ctx.data.mdmTag.findMany({
    where: {
      entityType: params.entityType,
      entityId: params.entityId,
    },
    orderBy: {
      field: 'createdAt',
      direction: 'asc',
    },
  });

  return records;
}

export async function findTagsByTag(
  ctx: RequestContext,
  params: FindTagsByTagParams,
) {
  const normalizedTag = normalizeTagValue(params.tag);
  validateTagValue(normalizedTag);
  const records = await ctx.data.mdmTag.findMany({
    where: {
      entityType: params.entityType,
      tag: normalizedTag,
      module: params.module,
      namespace: params.namespace ?? undefined,
    },
    orderBy: {
      field: 'createdAt',
      direction: 'asc',
    },
  });

  return records;
}
