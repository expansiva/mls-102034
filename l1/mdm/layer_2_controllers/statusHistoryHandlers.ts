/// <mls fileReference="_102034_/l1/mdm/layer_2_controllers/statusHistoryHandlers.ts" enhancement="_blank" />
import { ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  findLatestStatusByEntity,
  findStatusHistoryByEntity,
} from '/_102034_/l1/mdm/layer_3_usecases/statusHistoryUsecases.js';
import type {
  FindLatestStatusByEntityParams,
  FindStatusHistoryByEntityParams,
} from '/_102034_/l1/mdm/module.js';

export const statusHistoryFindByEntityHandler: BffHandler = async ({ ctx, request }) =>
  ok(await findStatusHistoryByEntity(ctx, request.params as FindStatusHistoryByEntityParams));

export const statusHistoryFindLatestHandler: BffHandler = async ({ ctx, request }) =>
  ok(await findLatestStatusByEntity(ctx, request.params as FindLatestStatusByEntityParams));
