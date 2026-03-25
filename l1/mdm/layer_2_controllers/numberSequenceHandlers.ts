/// <mls fileReference="_102034_/l1/mdm/layer_2_controllers/numberSequenceHandlers.ts" enhancement="_blank" />
import { ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { nextSequence } from '/_102034_/l1/mdm/layer_3_usecases/numberSequenceUsecases.js';
import type { NumberSequenceNextParams } from '/_102034_/l1/mdm/module.js';

export const numberSequenceNextHandler: BffHandler = async ({ ctx, request }) =>
  ok(await nextSequence(ctx, request.params as NumberSequenceNextParams));
