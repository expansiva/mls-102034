/// <mls fileReference="_102034_/l1/mdm/layer_2_controllers/entityHandlers.ts" enhancement="_blank" />
import { ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  createEntity,
  getEntity,
  listEntities,
  mergeEntity,
  updateEntity,
} from '/_102034_/l1/mdm/layer_3_usecases/recordUsecases.js';
import type {
  CreateRecordParams,
  ListRecordsParams,
  MergeEntityParams,
  UpdateRecordParams,
} from '/_102034_/l1/mdm/module.js';

export const entityCreateHandler: BffHandler = async ({ ctx, request }) =>
  ok(await createEntity(ctx, request.params as CreateRecordParams));

export const entityGetHandler: BffHandler = async ({ ctx, request }) =>
  ok(await getEntity(ctx, String((request.params as { mdmId: string }).mdmId)));

export const entityListHandler: BffHandler = async ({ ctx, request }) =>
  ok(await listEntities(ctx, (request.params as ListRecordsParams) ?? {}));

export const entityUpdateHandler: BffHandler = async ({ ctx, request }) =>
  ok(await updateEntity(ctx, request.params as UpdateRecordParams));

export const entityMergeHandler: BffHandler = async ({ ctx, request }) =>
  ok(await mergeEntity(ctx, request.params as MergeEntityParams));
