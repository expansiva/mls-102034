/// <mls fileReference="_102034_/l1/audit/layer_3_usecases/auditUsecases.ts" enhancement="_blank" />
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { createPostgresDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/postgres/MdmDataRuntimePostgres.js';
import { MdmAuditLogRemoteRuntimeDynamo } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmAuditLogRemoteRuntimeDynamo.js';
import type {
  MdmAuditLogIndexRecord,
  MdmStatusHistoryRecord,
} from '/_102034_/l1/mdm/module.js';
import {
  AppError,
  type RequestContext,
} from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type {
  AuditHomeResponse,
  AuditLogDetailsParams,
  AuditLogDetailsResponse,
  AuditLogEventRecord,
  AuditLogLoadParams,
  AuditLogResponse,
  AuditNamedCount,
  AuditStatusEventRecord,
  AuditStatusHistoryLoadParams,
  AuditStatusHistoryResponse,
} from '/_102034_/l1/audit/module.js';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function normalizePage(value: number | undefined) {
  if (!value || value < 1) {
    return 1;
  }
  return Math.floor(value);
}

function normalizePageSize(value: number | undefined) {
  if (!value || value < 1) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(MAX_PAGE_SIZE, Math.floor(value));
}

function isWithinRange(createdAt: string, from?: string, to?: string) {
  if (from && createdAt < from) {
    return false;
  }
  if (to && createdAt > to) {
    return false;
  }
  return true;
}

function toAuditLogEvent(record: MdmAuditLogIndexRecord): AuditLogEventRecord {
  return {
    id: record.id,
    entityType: record.entityType,
    entityId: record.entityId,
    action: record.action,
    actorId: record.actorId,
    actorType: record.actorType,
    module: record.module,
    routine: record.routine,
    createdAt: record.createdAt,
    hasRemoteDiff: record.action === 'update',
  };
}

function toStatusEvent(record: MdmStatusHistoryRecord): AuditStatusEventRecord {
  return {
    id: record.id,
    entityType: record.entityType,
    entityId: record.entityId,
    fromStatus: record.fromStatus ?? null,
    toStatus: record.toStatus,
    reason: record.reason ?? null,
    reasonCode: record.reasonCode ?? null,
    actorId: record.actorId,
    actorType: record.actorType,
    module: record.module,
    routine: record.routine,
    metadata: record.metadata ?? null,
    createdAt: record.createdAt,
  };
}

function buildTopCounts(values: string[], limit = 6): AuditNamedCount[] {
  const counts = new Map<string, number>();
  values
    .filter((value) => value.trim().length > 0)
    .forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function paginate<TValue>(rows: TValue[], page: number, pageSize: number) {
  const offset = (page - 1) * pageSize;
  return rows.slice(offset, offset + pageSize);
}

function parseTransitionLabel(record: MdmStatusHistoryRecord) {
  return `${record.fromStatus ?? 'null'} -> ${record.toStatus}`;
}

function getCurrentStatusCounts(records: MdmStatusHistoryRecord[]) {
  const latestByEntity = new Map<string, MdmStatusHistoryRecord>();
  records.forEach((record) => {
    const key = `${record.entityType}::${record.entityId}`;
    const current = latestByEntity.get(key);
    if (!current || current.createdAt < record.createdAt) {
      latestByEntity.set(key, record);
    }
  });
  return buildTopCounts([...latestByEntity.values()].map((record) => record.toStatus));
}

function matchesAuditLogFilters(record: MdmAuditLogIndexRecord, filters: Required<AuditLogLoadParams>) {
  return (!filters.module || record.module === filters.module)
    && (!filters.entityType || record.entityType === filters.entityType)
    && (!filters.entityId || record.entityId === filters.entityId)
    && (!filters.actorId || record.actorId === filters.actorId)
    && (!filters.actorType || record.actorType === filters.actorType)
    && (!filters.action || record.action === filters.action)
    && isWithinRange(record.createdAt, filters.from || undefined, filters.to || undefined);
}

function matchesStatusFilters(record: MdmStatusHistoryRecord, filters: Required<AuditStatusHistoryLoadParams>) {
  return (!filters.module || record.module === filters.module)
    && (!filters.entityType || record.entityType === filters.entityType)
    && (!filters.entityId || record.entityId === filters.entityId)
    && (!filters.fromStatus || (record.fromStatus ?? '') === filters.fromStatus)
    && (!filters.toStatus || record.toStatus === filters.toStatus)
    && (!filters.actorId || record.actorId === filters.actorId)
    && (!filters.reasonCode || (record.reasonCode ?? '') === filters.reasonCode)
    && isWithinRange(record.createdAt, filters.from || undefined, filters.to || undefined);
}

function normalizeAuditLogFilters(input?: AuditLogLoadParams): Required<AuditLogLoadParams> {
  return {
    module: input?.module?.trim() ?? '',
    entityType: input?.entityType?.trim() ?? '',
    entityId: input?.entityId?.trim() ?? '',
    actorId: input?.actorId?.trim() ?? '',
    actorType: input?.actorType?.trim() ?? '',
    action: input?.action?.trim() ?? '',
    from: input?.from?.trim() ?? '',
    to: input?.to?.trim() ?? '',
    page: normalizePage(input?.page),
    pageSize: normalizePageSize(input?.pageSize),
  };
}

function normalizeStatusFilters(input?: AuditStatusHistoryLoadParams): Required<AuditStatusHistoryLoadParams> {
  return {
    module: input?.module?.trim() ?? '',
    entityType: input?.entityType?.trim() ?? '',
    entityId: input?.entityId?.trim() ?? '',
    fromStatus: input?.fromStatus?.trim() ?? '',
    toStatus: input?.toStatus?.trim() ?? '',
    actorId: input?.actorId?.trim() ?? '',
    reasonCode: input?.reasonCode?.trim() ?? '',
    from: input?.from?.trim() ?? '',
    to: input?.to?.trim() ?? '',
    page: normalizePage(input?.page),
    pageSize: normalizePageSize(input?.pageSize),
  };
}

async function loadAuditLogRows(ctx: RequestContext) {
  return ctx.data.mdmAuditLog.findMany({
    orderBy: {
      field: 'createdAt',
      direction: 'desc',
    },
  });
}

async function loadStatusRows(ctx: RequestContext) {
  return ctx.data.mdmStatusHistory.findMany({
    orderBy: {
      field: 'createdAt',
      direction: 'desc',
    },
  });
}

export async function loadAuditHome(ctx: RequestContext): Promise<AuditHomeResponse> {
  const env = readAppEnv();
  const [auditRows, statusRows] = await Promise.all([
    loadAuditLogRows(ctx),
    loadStatusRows(ctx),
  ]);
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  return {
    generatedAt: new Date().toISOString(),
    system: {
      appEnv: env.appEnv,
      runtimeMode: env.runtimeMode,
      writeBehindEnabled: env.writeBehindEnabled,
      awsRegion: env.awsRegion,
    },
    summary: {
      auditLog: {
        total: auditRows.length,
        last24h: auditRows.filter((row) => row.createdAt >= sinceIso).length,
        uniqueModules: new Set(auditRows.map((row) => row.module)).size,
        uniqueActors: new Set(auditRows.map((row) => row.actorId)).size,
      },
      statusHistory: {
        total: statusRows.length,
        last24h: statusRows.filter((row) => row.createdAt >= sinceIso).length,
        uniqueEntities: new Set(statusRows.map((row) => `${row.entityType}::${row.entityId}`)).size,
        uniqueTransitions: new Set(statusRows.map(parseTransitionLabel)).size,
      },
    },
    explanation: {
      auditLog: 'Audit log captures immutable create, update, delete and restore operations, showing who changed what and when.',
      statusHistory: 'Status history captures lifecycle transitions, showing how an entity moved between statuses and why that transition happened.',
    },
    distribution: {
      byModule: buildTopCounts([...auditRows.map((row) => row.module), ...statusRows.map((row) => row.module)]),
      byEntityType: buildTopCounts([...auditRows.map((row) => row.entityType), ...statusRows.map((row) => row.entityType)]),
      byActorId: buildTopCounts([...auditRows.map((row) => row.actorId), ...statusRows.map((row) => row.actorId)]),
    },
    recentEvents: {
      auditLog: auditRows.slice(0, 8).map(toAuditLogEvent),
      statusHistory: statusRows.slice(0, 8).map(toStatusEvent),
    },
  };
}

export async function loadAuditLog(
  ctx: RequestContext,
  input?: AuditLogLoadParams,
): Promise<AuditLogResponse> {
  const filters = normalizeAuditLogFilters(input);
  const rows = (await loadAuditLogRows(ctx)).filter((row) => matchesAuditLogFilters(row, filters));
  const pageRows = paginate(rows, filters.page, filters.pageSize);

  return {
    generatedAt: new Date().toISOString(),
    filters,
    summary: {
      total: rows.length,
      page: filters.page,
      pageSize: filters.pageSize,
      totalPages: Math.max(1, Math.ceil(rows.length / filters.pageSize)),
      uniqueModules: new Set(rows.map((row) => row.module)).size,
      uniqueActors: new Set(rows.map((row) => row.actorId)).size,
      createCount: rows.filter((row) => row.action === 'create').length,
      updateCount: rows.filter((row) => row.action === 'update').length,
      deleteCount: rows.filter((row) => row.action === 'delete').length,
      restoreCount: rows.filter((row) => row.action === 'restore').length,
    },
    groups: {
      byModule: buildTopCounts(rows.map((row) => row.module)),
      byRoutine: buildTopCounts(rows.map((row) => row.routine)),
      byActorId: buildTopCounts(rows.map((row) => row.actorId)),
      byAction: buildTopCounts(rows.map((row) => row.action)),
    },
    events: pageRows.map(toAuditLogEvent),
  };
}

export async function loadAuditLogDetails(
  ctx: RequestContext,
  input: AuditLogDetailsParams,
): Promise<AuditLogDetailsResponse> {
  if (!input.id || input.id.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'id is required', 400);
  }

  const row = await ctx.data.mdmAuditLog.findOne({
    where: {
      id: input.id.trim(),
    },
  });

  if (!row) {
    return {
      generatedAt: new Date().toISOString(),
      event: null,
    };
  }

  const env = readAppEnv();
  let diff: unknown[] | null = null;
  try {
    const remoteRuntime = new MdmAuditLogRemoteRuntimeDynamo(env);
    diff = (await remoteRuntime.get(row.id))?.diff ?? null;
  } catch {
    diff = null;
  }

  return {
    generatedAt: new Date().toISOString(),
    event: {
      ...toAuditLogEvent(row),
      diff,
    },
  };
}

export async function loadAuditStatusHistory(
  ctx: RequestContext,
  input?: AuditStatusHistoryLoadParams,
): Promise<AuditStatusHistoryResponse> {
  const filters = normalizeStatusFilters(input);
  const rows = (await loadStatusRows(ctx)).filter((row) => matchesStatusFilters(row, filters));
  const pageRows = paginate(rows, filters.page, filters.pageSize);

  return {
    generatedAt: new Date().toISOString(),
    filters,
    summary: {
      total: rows.length,
      page: filters.page,
      pageSize: filters.pageSize,
      totalPages: Math.max(1, Math.ceil(rows.length / filters.pageSize)),
      uniqueModules: new Set(rows.map((row) => row.module)).size,
      uniqueEntities: new Set(rows.map((row) => `${row.entityType}::${row.entityId}`)).size,
      uniqueTransitions: new Set(rows.map(parseTransitionLabel)).size,
    },
    groups: {
      byModule: buildTopCounts(rows.map((row) => row.module)),
      byEntityType: buildTopCounts(rows.map((row) => row.entityType)),
      byTransition: buildTopCounts(rows.map(parseTransitionLabel)),
      currentStatuses: getCurrentStatusCounts(rows),
    },
    events: pageRows.map(toStatusEvent),
  };
}
