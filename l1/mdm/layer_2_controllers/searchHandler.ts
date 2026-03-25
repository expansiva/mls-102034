/// <mls fileReference="_102034_/l1/mdm/layer_2_controllers/searchHandler.ts" enhancement="_blank" />
import { ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { runSearch } from '/_102034_/l1/mdm/layer_3_usecases/relationshipUsecases.js';
import type { SearchParams } from '/_102034_/l1/mdm/module.js';

export const searchHandler: BffHandler = async ({ ctx, request }) =>
  ok(await runSearch(ctx, (request.params as SearchParams) ?? {}));
