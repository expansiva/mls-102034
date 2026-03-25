/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/core/DataRecordService.ts" enhancement="_blank" />
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { findResolvedTableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { microdiff } from '/_102034_/l1/mdm/layer_3_usecases/core/microdiff.js';
import type {
  EntityDef,
  MdmActorType,
  MdmAuditAction,
  MdmAuditDiffEntry,
  MdmAuditLogDocumentRecord,
  MdmAuditLogIndexRecord,
  MdmDocumentRecord,
  MdmErrorLogRecord,
  MdmMonitoringWriteRecord,
  MdmOutboxRecord,
  MdmStatusHistoryRecord,
} from '/_102034_/l1/mdm/module.js';
import { moduleConfig } from '/_102034_/l1/mdm/module.js';

export interface DataWriteActor {
  actorId?: string;
  actorType?: MdmActorType;
  source?: 'http' | 'message' | 'test' | 'system';
}

export interface DataWriteMeta extends DataWriteActor {
  module: string;
  routine: string;
  action: MdmAuditAction;
  entityType: string;
  entityId?: string | null;
}

export interface DataRecordCreateInput<TDetail> {
  after: TDetail;
  afterPersist?: (runtime: RequestContext['data'], state: {
    after: TDetail;
    document: MdmDocumentRecord;
  }) => Promise<void>;
  meta: Omit<DataWriteMeta, 'entityType' | 'entityId' | 'action'> & {
    action?: Extract<MdmAuditAction, 'create'>;
  };
}

export interface DataRecordUpdateInput<TDetail> {
  id: string;
  before: MdmDocumentRecord;
  expectedVersion: number;
  patch?: Partial<TDetail>;
  after?: TDetail;
  applyPatch?: (before: TDetail, patch: Partial<TDetail>, ctx: RequestContext) => TDetail;
  afterPersist?: (runtime: RequestContext['data'], state: {
    before: MdmDocumentRecord;
    after: TDetail;
    document: MdmDocumentRecord;
  }) => Promise<void>;
  meta: Omit<DataWriteMeta, 'entityType' | 'entityId' | 'action'> & {
    action?: Extract<MdmAuditAction, 'update'>;
  };
}

export interface DataRecordTransitionStatusInput<TDetail> {
  before: MdmDocumentRecord;
  expectedVersion: number;
  after: TDetail;
  fromStatus?: string | null;
  toStatus: string;
  reason?: string | null;
  reasonCode?: string | null;
  metadata?: Record<string, unknown> | null;
  afterPersist?: (runtime: RequestContext['data'], state: {
    before: MdmDocumentRecord;
    after: TDetail;
    document: MdmDocumentRecord;
  }) => Promise<void>;
  meta: Omit<DataWriteMeta, 'entityType' | 'entityId' | 'action'> & {
    action?: Extract<MdmAuditAction, 'transitionStatus'>;
  };
}

function normalizeActor(
  ctx: RequestContext,
  actor?: DataWriteActor,
): Required<DataWriteActor> & { actorId: string; actorType: MdmActorType } {
  return {
    actorId: actor?.actorId ?? ctx.requestMeta?.userId ?? 'system',
    actorType: actor?.actorType ?? (ctx.requestMeta?.userId ? 'user' : 'system'),
    source: actor?.source ?? ctx.requestMeta?.source ?? 'system',
  };
}

function diffEntries(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): MdmAuditDiffEntry[] | null {
  if (!before || !after) {
    return null;
  }

  return microdiff(before, after) as MdmAuditDiffEntry[];
}

function buildAuditOutbox(
  ctx: RequestContext,
  record: MdmAuditLogDocumentRecord,
): MdmOutboxRecord {
  const nowIso = ctx.clock.nowIso();
  return {
    id: ctx.idGenerator.newId(),
    topic: 'mdm.audit.write-behind',
    aggregateType: 'MdmAuditLog',
    aggregateId: record.id,
    eventType: 'UpsertAuditLog',
    payload: record as unknown as Record<string, unknown>,
    attemptCount: 0,
    processedAt: null,
    lastError: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

async function buildRegistryWriteBehindOutbox(
  ctx: RequestContext,
  repositoryName: string,
  item: Record<string, unknown>,
): Promise<MdmOutboxRecord> {
  const definition = await findResolvedTableDefinition(repositoryName, readAppEnv());
  const key = Object.fromEntries(definition.primaryKey.map((field) => [field, item[field]]));
  const nowIso = ctx.clock.nowIso();
  return {
    id: ctx.idGenerator.newId(),
    topic: `registry.${definition.repositoryName}.write-behind`,
    aggregateType: 'RegistryTable',
    aggregateId: `${definition.tableName}:${definition.primaryKey.map((field) => `${field}=${String(item[field] ?? '')}`).join('|')}`,
    eventType: 'UpsertRegistryTableRecord',
    payload: {
      tableName: definition.tableName,
      repositoryName: definition.repositoryName,
      operation: 'upsert',
      key,
      item,
    },
    attemptCount: 0,
    processedAt: null,
    lastError: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export class AuditLogService {
  public static async record(
    ctx: RequestContext,
    runtime: RequestContext['data'],
    input: {
      entityType: string;
      entityId: string;
      action: MdmAuditAction;
      module: string;
      routine: string;
      before?: Record<string, unknown> | null;
      after?: Record<string, unknown> | null;
      actor?: DataWriteActor;
      createdAt?: string;
    },
  ): Promise<MdmAuditLogIndexRecord> {
    const actor = normalizeActor(ctx, input.actor);
    const createdAt = input.createdAt ?? ctx.clock.nowIso();
    const indexRecord: MdmAuditLogIndexRecord = {
      id: ctx.idGenerator.newId(),
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actorId: actor.actorId,
      actorType: actor.actorType,
      module: input.module,
      routine: input.routine,
      createdAt,
    };
    const documentRecord: MdmAuditLogDocumentRecord = {
      ...indexRecord,
      diff: diffEntries(input.before ?? null, input.after ?? null),
    };

    await runtime.mdmAuditLog.insert({ record: indexRecord });
    if (moduleConfig.persistence.writeMode === 'writeBehind') {
      await runtime.mdmOutbox.insert({
        record: buildAuditOutbox(ctx, documentRecord),
      });
    }

    return indexRecord;
  }
}

export class MonitoringWriteService {
  public static async record(
    ctx: RequestContext,
    runtime: RequestContext['data'],
    input: DataWriteMeta & {
      success: boolean;
      startedAt: string;
      finishedAt: string;
      durationMs: number;
      errorCode?: string | null;
    },
  ): Promise<void> {
    const actor = normalizeActor(ctx, input);
    const record: MdmMonitoringWriteRecord = {
      id: ctx.idGenerator.newId(),
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      module: input.module,
      routine: input.routine,
      action: input.action,
      success: input.success,
      durationMs: input.durationMs,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      actorType: actor.actorType,
      source: actor.source,
      errorCode: input.errorCode ?? null,
    };

    await runtime.mdmMonitoringWrite.insert({ record });
  }
}

export class ErrorLogService {
  public static async record(
    ctx: RequestContext,
    runtime: RequestContext['data'],
    input: DataWriteMeta & {
      error: unknown;
    },
  ): Promise<void> {
    const error = input.error;
    const record: MdmErrorLogRecord = {
      id: ctx.idGenerator.newId(),
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      module: input.module,
      routine: input.routine,
      action: input.action,
      errorCode: error instanceof AppError ? error.code : 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : String(error),
      details:
        error instanceof AppError && error.details && typeof error.details === 'object'
          ? (error.details as Record<string, unknown>)
          : null,
      stack: error instanceof Error ? (error.stack ?? null) : null,
      createdAt: ctx.clock.nowIso(),
    };

    await runtime.mdmErrorLog.insert({ record });
    if (moduleConfig.persistence.writeMode === 'writeBehind') {
      await runtime.mdmOutbox.insert({
        record: await buildRegistryWriteBehindOutbox(ctx, 'mdmErrorLog', record as unknown as Record<string, unknown>),
      });
    }
  }
}

export class StatusHistoryService {
  public static async record(
    ctx: RequestContext,
    runtime: RequestContext['data'],
    input: {
      entityType: string;
      entityId: string;
      fromStatus?: string | null;
      toStatus: string;
      reason?: string | null;
      reasonCode?: string | null;
      module: string;
      routine: string;
      actor?: DataWriteActor;
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    const actor = normalizeActor(ctx, input.actor);
    const record: MdmStatusHistoryRecord = {
      id: ctx.idGenerator.newId(),
      entityType: input.entityType,
      entityId: input.entityId,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus,
      reason: input.reason ?? null,
      reasonCode: input.reasonCode ?? null,
      actorId: actor.actorId,
      actorType: actor.actorType,
      module: input.module,
      routine: input.routine,
      metadata: input.metadata ?? null,
      createdAt: ctx.clock.nowIso(),
    };

    await runtime.mdmStatusHistory.insert({ record });
    if (moduleConfig.persistence.writeMode === 'writeBehind') {
      await runtime.mdmOutbox.insert({
        record: await buildRegistryWriteBehindOutbox(ctx, 'mdmStatusHistory', record as unknown as Record<string, unknown>),
      });
    }
  }
}

async function recordFailure(
  ctx: RequestContext,
  meta: DataWriteMeta,
  startedAtMs: number,
  error: unknown,
): Promise<void> {
  const finishedAt = ctx.clock.nowIso();
  try {
    await ErrorLogService.record(ctx, ctx.data, {
      ...meta,
      error,
    });
  } catch (loggingError) {
    ctx.log.error('Error log recording failed', {
      cause: loggingError instanceof Error ? loggingError.message : String(loggingError),
      originalError: error instanceof Error ? error.message : String(error),
      routine: meta.routine,
    });
  }

  try {
    await MonitoringWriteService.record(ctx, ctx.data, {
      ...meta,
      success: false,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      errorCode: error instanceof AppError ? error.code : 'INTERNAL_ERROR',
    });
  } catch (monitoringError) {
    ctx.log.error('Monitoring write failure recording failed', {
      cause: monitoringError instanceof Error ? monitoringError.message : String(monitoringError),
      routine: meta.routine,
    });
  }
}

export async function runMonitoredWrite<TValue>(
  ctx: RequestContext,
  meta: DataWriteMeta,
  callback: () => Promise<TValue>,
): Promise<TValue> {
  const startedAtMs = Date.now();
  try {
    const result = await callback();
    try {
      await MonitoringWriteService.record(ctx, ctx.data, {
        ...meta,
        success: true,
        startedAt: new Date(startedAtMs).toISOString(),
        finishedAt: ctx.clock.nowIso(),
        durationMs: Math.max(0, Date.now() - startedAtMs),
        errorCode: null,
      });
    } catch (error) {
      await ErrorLogService.record(ctx, ctx.data, {
        ...meta,
        action: meta.action,
        error,
      });
    }
    return result;
  } catch (error) {
    await recordFailure(ctx, meta, startedAtMs, error);
    throw error;
  }
}

export class DataRecordService {
  public static async create<TDetail extends object, TIndex extends object>(
    ctx: RequestContext,
    def: EntityDef<TDetail, TIndex>,
    input: DataRecordCreateInput<TDetail>,
  ): Promise<{ version: number; after: TDetail; index: TIndex }> {
    const after = input.after;
    const entityId = def.getId(after);
    const meta: DataWriteMeta = {
      entityType: def.entityType,
      entityId,
      module: input.meta.module,
      routine: input.meta.routine,
      action: 'create',
      actorId: input.meta.actorId,
      actorType: input.meta.actorType,
      source: input.meta.source,
    };

    return runMonitoredWrite(ctx, meta, async () => {
      const index = def.buildIndex(after);
      const document = def.toDocument(after, 1);
      await ctx.data.runInTransaction(async (runtime) => {
        await runtime.mdmDocument.put({ record: document });
        await def.getIndexRuntime(runtime).insert({ record: index });
        await AuditLogService.record(ctx, runtime, {
          entityType: def.entityType,
          entityId,
          action: 'create',
          module: input.meta.module,
          routine: input.meta.routine,
          before: null,
          after: def.getAuditSnapshot(after, index),
          actor: input.meta,
        });
        if (input.afterPersist) {
          await input.afterPersist(runtime, {
            after,
            document,
          });
        }
      });

      return {
        version: 1,
        after,
        index,
      };
    });
  }

  public static async update<TDetail extends object, TIndex extends object>(
    ctx: RequestContext,
    def: EntityDef<TDetail, TIndex>,
    input: DataRecordUpdateInput<TDetail>,
  ): Promise<{ version: number; after: TDetail; index: TIndex }> {
    const beforeDetail = input.before.details as unknown as TDetail;
    const after = input.after
      ?? (
        input.patch && input.applyPatch
          ? input.applyPatch(beforeDetail, input.patch, ctx)
          : null
      );

    if (!after) {
      throw new AppError('INVALID_UPDATE_INPUT', 'update requires after or patch+applyPatch', 400);
    }

    const entityId = input.id;
    const meta: DataWriteMeta = {
      entityType: def.entityType,
      entityId,
      module: input.meta.module,
      routine: input.meta.routine,
      action: 'update',
      actorId: input.meta.actorId,
      actorType: input.meta.actorType,
      source: input.meta.source,
    };

    return runMonitoredWrite(ctx, meta, async () => {
      const index = def.buildIndex(after);
      const document = def.toDocument(after, input.before.version + 1);
      const beforeSnapshot = def.getAuditSnapshot(beforeDetail, def.buildIndex(beforeDetail));
      const afterSnapshot = def.getAuditSnapshot(after, index);
      await ctx.data.runInTransaction(async (runtime) => {
        await runtime.mdmDocument.put({
          record: document,
          expectedVersion: input.expectedVersion,
        });
        await def.getIndexRuntime(runtime).update({
          where: { mdmId: entityId } as unknown as Partial<TIndex>,
          patch: index,
        });
        await AuditLogService.record(ctx, runtime, {
          entityType: def.entityType,
          entityId,
          action: 'update',
          module: input.meta.module,
          routine: input.meta.routine,
          before: beforeSnapshot,
          after: afterSnapshot,
          actor: input.meta,
        });
        if (input.afterPersist) {
          await input.afterPersist(runtime, {
            before: input.before,
            after,
            document,
          });
        }
      });

      return {
        version: document.version,
        after,
        index,
      };
    });
  }

  public static async transitionStatus<TDetail extends { status?: string }, TIndex extends object>(
    ctx: RequestContext,
    def: EntityDef<TDetail, TIndex>,
    input: DataRecordTransitionStatusInput<TDetail>,
  ): Promise<{ version: number; after: TDetail; index: TIndex }> {
    const entityId = def.getId(input.after);
    const meta: DataWriteMeta = {
      entityType: def.entityType,
      entityId,
      module: input.meta.module,
      routine: input.meta.routine,
      action: 'transitionStatus',
      actorId: input.meta.actorId,
      actorType: input.meta.actorType,
      source: input.meta.source,
    };

    return runMonitoredWrite(ctx, meta, async () => {
      const index = def.buildIndex(input.after);
      const document = def.toDocument(input.after, input.before.version + 1);
      const beforeSnapshot = def.getAuditSnapshot(
        input.before.details as unknown as TDetail,
        def.buildIndex(input.before.details as unknown as TDetail),
      );
      const afterSnapshot = def.getAuditSnapshot(input.after, index);

      await ctx.data.runInTransaction(async (runtime) => {
        await runtime.mdmDocument.put({
          record: document,
          expectedVersion: input.expectedVersion,
        });
        await def.getIndexRuntime(runtime).update({
          where: { mdmId: entityId } as unknown as Partial<TIndex>,
          patch: index,
        });
        await StatusHistoryService.record(ctx, runtime, {
          entityType: def.entityType,
          entityId,
          fromStatus: input.fromStatus ?? null,
          toStatus: input.toStatus,
          reason: input.reason ?? null,
          reasonCode: input.reasonCode ?? null,
          module: input.meta.module,
          routine: input.meta.routine,
          actor: input.meta,
          metadata: input.metadata ?? null,
        });
        await AuditLogService.record(ctx, runtime, {
          entityType: def.entityType,
          entityId,
          action: 'transitionStatus',
          module: input.meta.module,
          routine: input.meta.routine,
          before: beforeSnapshot,
          after: afterSnapshot,
          actor: input.meta,
        });
        if (input.afterPersist) {
          await input.afterPersist(runtime, {
            before: input.before,
            after: input.after,
            document,
          });
        }
      });

      return {
        version: document.version,
        after: input.after,
        index,
      };
    });
  }
}
