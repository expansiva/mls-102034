/// <mls fileReference="_102034_/l1/mdm/layer_2_controllers/tagHandlers.ts" enhancement="_blank" />
import { ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  addTag,
  findTagsByEntity,
  findTagsByTag,
  removeTag,
} from '/_102034_/l1/mdm/layer_3_usecases/tagUsecases.js';
import type {
  AddTagParams,
  FindTagsByEntityParams,
  FindTagsByTagParams,
  RemoveTagParams,
} from '/_102034_/l1/mdm/module.js';

export const tagAddHandler: BffHandler = async ({ ctx, request }) =>
  ok(await addTag(ctx, request.params as AddTagParams));

export const tagRemoveHandler: BffHandler = async ({ ctx, request }) =>
  ok(await removeTag(ctx, request.params as RemoveTagParams));

export const tagFindByEntityHandler: BffHandler = async ({ ctx, request }) =>
  ok(await findTagsByEntity(ctx, request.params as FindTagsByEntityParams));

export const tagFindByTagHandler: BffHandler = async ({ ctx, request }) =>
  ok(await findTagsByTag(ctx, request.params as FindTagsByTagParams));
