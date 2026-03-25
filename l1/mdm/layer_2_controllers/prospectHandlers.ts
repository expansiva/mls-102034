/// <mls fileReference="_102034_/l1/mdm/layer_2_controllers/prospectHandlers.ts" enhancement="_blank" />
import { ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  createProspect,
  getProspect,
  listProspects,
  promoteProspect,
  updateProspect,
} from '/_102034_/l1/mdm/layer_3_usecases/recordUsecases.js';
import type {
  CreateRecordParams,
  ListRecordsParams,
  PromoteProspectParams,
  UpdateRecordParams,
} from '/_102034_/l1/mdm/module.js';

export const prospectCreateHandler: BffHandler = async ({ ctx, request }) =>
  ok(await createProspect(ctx, request.params as CreateRecordParams));

export const prospectGetHandler: BffHandler = async ({ ctx, request }) =>
  ok(await getProspect(ctx, String((request.params as { mdmId: string }).mdmId)));

export const prospectListHandler: BffHandler = async ({ ctx, request }) =>
  ok(await listProspects(ctx, (request.params as ListRecordsParams) ?? {}));

export const prospectUpdateHandler: BffHandler = async ({ ctx, request }) =>
  ok(await updateProspect(ctx, request.params as UpdateRecordParams));

export const prospectPromoteHandler: BffHandler = async ({ ctx, request }) =>
  ok(await promoteProspect(ctx, request.params as PromoteProspectParams));
