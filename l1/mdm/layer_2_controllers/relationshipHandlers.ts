/// <mls fileReference="_102034_/l1/mdm/layer_2_controllers/relationshipHandlers.ts" enhancement="_blank" />
import { ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  createRelationship,
  listRelationships,
  updateRelationship,
} from '/_102034_/l1/mdm/layer_3_usecases/relationshipUsecases.js';
import type {
  CreateRelationshipParams,
  ListRelationshipsParams,
  UpdateRelationshipParams,
} from '/_102034_/l1/mdm/module.js';

export const relationshipCreateHandler: BffHandler = async ({ ctx, request }) =>
  ok(await createRelationship(ctx, request.params as CreateRelationshipParams));

export const relationshipListHandler: BffHandler = async ({ ctx, request }) =>
  ok(await listRelationships(ctx, (request.params as ListRelationshipsParams) ?? {}));

export const relationshipUpdateHandler: BffHandler = async ({ ctx, request }) =>
  ok(await updateRelationship(ctx, request.params as UpdateRelationshipParams));
