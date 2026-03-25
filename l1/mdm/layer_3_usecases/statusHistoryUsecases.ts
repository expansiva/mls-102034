/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/statusHistoryUsecases.ts" enhancement="_blank" />
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type {
  FindLatestStatusByEntityParams,
  FindStatusHistoryByEntityParams,
} from '/_102034_/l1/mdm/module.js';

export async function findStatusHistoryByEntity(
  ctx: RequestContext,
  params: FindStatusHistoryByEntityParams,
) {
  return ctx.data.mdmStatusHistory.findMany({
    where: {
      entityType: params.entityType,
      entityId: params.entityId,
    },
    orderBy: {
      field: 'createdAt',
      direction: 'desc',
    },
    limit: params.limit ?? 100,
  });
}

export async function findLatestStatusByEntity(
  ctx: RequestContext,
  params: FindLatestStatusByEntityParams,
) {
  const rows = await findStatusHistoryByEntity(ctx, {
    entityType: params.entityType,
    entityId: params.entityId,
    limit: 1,
  });

  return rows[0] ?? null;
}
