/// <mls fileReference="_102034_/l1/mdm/layer_2_controllers/commentHandlers.ts" enhancement="_blank" />
import { ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  addComment,
  editComment,
  findCommentsByEntity,
  removeComment,
} from '/_102034_/l1/mdm/layer_3_usecases/commentUsecases.js';
import type {
  AddCommentParams,
  EditCommentParams,
  FindCommentsByEntityParams,
  RemoveCommentParams,
} from '/_102034_/l1/mdm/module.js';

export const commentAddHandler: BffHandler = async ({ ctx, request }) =>
  ok(await addComment(ctx, request.params as AddCommentParams));

export const commentEditHandler: BffHandler = async ({ ctx, request }) =>
  ok(await editComment(ctx, request.params as EditCommentParams));

export const commentRemoveHandler: BffHandler = async ({ ctx, request }) =>
  ok(await removeComment(ctx, request.params as RemoveCommentParams));

export const commentFindByEntityHandler: BffHandler = async ({ ctx, request }) =>
  ok(await findCommentsByEntity(ctx, request.params as FindCommentsByEntityParams));
