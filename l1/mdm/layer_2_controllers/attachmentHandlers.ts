/// <mls fileReference="_102034_/l1/mdm/layer_2_controllers/attachmentHandlers.ts" enhancement="_blank" />
import { ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  attachFile,
  detachFile,
  findAttachmentsByEntity,
} from '/_102034_/l1/mdm/layer_3_usecases/attachmentUsecases.js';
import type {
  AttachFileParams,
  DetachFileParams,
  FindAttachmentsByEntityParams,
} from '/_102034_/l1/mdm/module.js';

export const attachmentAttachHandler: BffHandler = async ({ ctx, request }) =>
  ok(await attachFile(ctx, request.params as AttachFileParams));

export const attachmentDetachHandler: BffHandler = async ({ ctx, request }) =>
  ok(await detachFile(ctx, request.params as DetachFileParams));

export const attachmentFindByEntityHandler: BffHandler = async ({ ctx, request }) =>
  ok(await findAttachmentsByEntity(ctx, request.params as FindAttachmentsByEntityParams));
