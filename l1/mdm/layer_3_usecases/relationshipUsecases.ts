/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/relationshipUsecases.ts" enhancement="_blank" />
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { MdmRelationshipEntity } from '/_102034_/l1/mdm/layer_4_entities/MdmRelationshipEntity.js';
import {
  buildRelationshipSearchText,
  refreshRelationshipRefs,
  relationshipIsBidirectional,
} from '/_102034_/l1/mdm/layer_3_usecases/mdmSupport.js';
import {
  AuditLogService,
  runMonitoredWrite,
} from '/_102034_/l1/mdm/layer_3_usecases/core/DataRecordService.js';
import {
  enqueueRelationshipWriteBehind,
  enqueueWriteBehind,
} from '/_102034_/l1/mdm/layer_3_usecases/recordUsecases.js';
import type {
  CreateRelationshipParams,
  ListRelationshipsParams,
  SearchParams,
  UpdateRelationshipParams,
} from '/_102034_/l1/mdm/module.js';

async function inferRelationshipScope(
  ctx: RequestContext,
  fromId: string,
  toId: string,
): Promise<'entity' | 'prospect'> {
  const fromProspect = await ctx.data.mdmProspectIndex.findOne({ where: { mdmId: fromId } });
  const toProspect = await ctx.data.mdmProspectIndex.findOne({ where: { mdmId: toId } });
  if (fromProspect || toProspect) {
    return 'prospect';
  }

  const fromEntity = await ctx.data.mdmEntityIndex.findOne({ where: { mdmId: fromId } });
  const toEntity = await ctx.data.mdmEntityIndex.findOne({ where: { mdmId: toId } });
  if (!fromEntity || !toEntity) {
    throw new AppError('VALIDATION_ERROR', 'Relationship endpoints must exist', 400, {
      fromId,
      toId,
    });
  }

  return 'entity';
}

export async function createRelationship(
  ctx: RequestContext,
  params: CreateRelationshipParams,
) {
  const scope = await inferRelationshipScope(ctx, params.fromId, params.toId);
  const nowIso = ctx.clock.nowIso();
  const record = {
    id: ctx.idGenerator.newId(),
    fromId: params.fromId,
    toId: params.toId,
    type: params.type,
    role: params.role ?? null,
    metadata: params.metadata ?? {},
    isBidirectional: params.isBidirectional ?? relationshipIsBidirectional(params.type),
    validFrom: params.validFrom,
    validTo: params.validTo ?? null,
    status: params.status ?? 'Active',
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return runMonitoredWrite(ctx, {
    entityType: scope === 'prospect' ? 'MdmProspectRelationship' : 'MdmRelationship',
    entityId: record.id,
    module: 'mdm',
    routine: 'mdm.relationship.create',
    action: 'create',
  }, async () => {
    if (scope === 'prospect') {
      await ctx.data.runInTransaction(async (runtime) => {
        await runtime.mdmProspectRelationship.insert({ record });
        await enqueueRelationshipWriteBehind(ctx, runtime, {
          ...record,
          scope: 'prospect',
        });
        await AuditLogService.record(ctx, runtime, {
          entityType: 'MdmProspectRelationship',
          entityId: record.id,
          action: 'create',
          module: 'mdm',
          routine: 'mdm.relationship.create',
          before: null,
          after: record as unknown as Record<string, unknown>,
        });
        await refreshRelationshipRefs(
          { ...ctx, data: runtime },
          'prospect',
          [record.fromId, record.toId],
          async (document) => enqueueWriteBehind(ctx, runtime, document),
        );
      });
    } else {
      await ctx.data.runInTransaction(async (runtime) => {
        await runtime.mdmRelationship.insert({ record });
        await enqueueRelationshipWriteBehind(ctx, runtime, {
          ...record,
          scope: 'entity',
        });
        await AuditLogService.record(ctx, runtime, {
          entityType: 'MdmRelationship',
          entityId: record.id,
          action: 'create',
          module: 'mdm',
          routine: 'mdm.relationship.create',
          before: null,
          after: record as unknown as Record<string, unknown>,
        });
        await refreshRelationshipRefs(
          { ...ctx, data: runtime },
          'entity',
          [record.fromId, record.toId],
          async (document) => enqueueWriteBehind(ctx, runtime, document),
        );
      });
    }

    return {
      scope,
      relationship: record,
    };
  });
}

export async function listRelationships(
  ctx: RequestContext,
  params: ListRelationshipsParams,
) {
  const scope = params.scope ?? 'all';
  const entityRelationships =
    scope === 'prospect'
      ? []
      : params.entityId
        ? [
            ...(await ctx.data.mdmRelationship.findManyByValues({ field: 'fromId', values: [params.entityId] })),
            ...(await ctx.data.mdmRelationship.findManyByValues({ field: 'toId', values: [params.entityId] })),
          ]
        : await ctx.data.mdmRelationship.findMany();
  const prospectRelationships =
    scope === 'entity'
      ? []
      : params.entityId
        ? [
            ...(await ctx.data.mdmProspectRelationship.findManyByValues({ field: 'fromId', values: [params.entityId] })),
            ...(await ctx.data.mdmProspectRelationship.findManyByValues({ field: 'toId', values: [params.entityId] })),
          ]
        : await ctx.data.mdmProspectRelationship.findMany();

  const dedupedRelationships = [...entityRelationships, ...prospectRelationships].filter(
    (relationship, index, all) => all.findIndex((candidate) => candidate.id === relationship.id) === index,
  );

  return dedupedRelationships.filter((relationship) => {
    if (params.entityId) {
      const touchesEntity =
        relationship.fromId === params.entityId || relationship.toId === params.entityId;
      if (!touchesEntity) {
        return false;
      }
    }
    if (params.status && relationship.status !== params.status) {
      return false;
    }
    if (params.type && relationship.type !== params.type) {
      return false;
    }
    return true;
  });
}

export async function updateRelationship(
  ctx: RequestContext,
  params: UpdateRelationshipParams,
) {
    const located = await MdmRelationshipEntity.findOne(ctx, params.id);
    const nextRecord = {
      ...located.relationship,
      ...params.patch,
      updatedAt: ctx.clock.nowIso(),
    };

    return runMonitoredWrite(ctx, {
      entityType: located.scope === 'entity' ? 'MdmRelationship' : 'MdmProspectRelationship',
      entityId: params.id,
      module: 'mdm',
      routine: 'mdm.relationship.update',
      action: 'update',
    }, async () => {
      await ctx.data.runInTransaction(async (runtime) => {
        const relationshipRuntime =
          located.scope === 'entity'
            ? runtime.mdmRelationship
            : runtime.mdmProspectRelationship;

        await relationshipRuntime.update({
          where: { id: params.id },
          patch: nextRecord,
        });
        await enqueueRelationshipWriteBehind(ctx, runtime, {
          ...nextRecord,
          scope: located.scope,
        });
        await AuditLogService.record(ctx, runtime, {
          entityType: located.scope === 'entity' ? 'MdmRelationship' : 'MdmProspectRelationship',
          entityId: params.id,
          action: 'update',
          module: 'mdm',
          routine: 'mdm.relationship.update',
          before: located.relationship as unknown as Record<string, unknown>,
          after: nextRecord as unknown as Record<string, unknown>,
        });
        await refreshRelationshipRefs(
          { ...ctx, data: runtime },
          located.scope,
          [nextRecord.fromId, nextRecord.toId],
          async (document) => enqueueWriteBehind(ctx, runtime, document),
        );
      });

      return {
        scope: located.scope,
        relationship: nextRecord,
      };
    });
}

export async function runSearch(
  ctx: RequestContext,
  params: SearchParams,
) {
  const scope = params.scope ?? 'all';
  const query = params.query?.trim().toLowerCase() ?? '';
  const entityRecords =
    scope === 'prospect' ? [] : await ctx.data.mdmEntityIndex.findMany({ limit: params.limit });
  const prospectRecords =
    scope === 'entity'
      ? []
      : await ctx.data.mdmProspectIndex.findMany({ limit: params.limit });
  const relationshipRecords =
    scope === 'entity'
      ? await ctx.data.mdmRelationship.findMany()
      : scope === 'prospect'
        ? await ctx.data.mdmProspectRelationship.findMany()
        : [
            ...(await ctx.data.mdmRelationship.findMany()),
            ...(await ctx.data.mdmProspectRelationship.findMany()),
          ];

  const records = [...entityRecords, ...prospectRecords].filter((record) => {
    if (params.subtype && record.subtype !== params.subtype) {
      return false;
    }
    if (params.status && record.status !== params.status) {
      return false;
    }
    if (!query) {
      return true;
    }

    const searchable = [record.name, record.docId, ...record.tags].join(' ').toLowerCase();
    return searchable.includes(query);
  });

  const relationships = relationshipRecords.filter((relationship) => {
    if (!query) {
      return true;
    }

    return buildRelationshipSearchText(relationship).includes(query);
  });

  return {
    records: params.limit ? records.slice(0, params.limit) : records,
    relationships: params.limit ? relationships.slice(0, params.limit) : relationships,
  };
}
