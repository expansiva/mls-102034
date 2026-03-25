/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/numberSequenceUsecases.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { nextSequence } from '/_102034_/l1/mdm/layer_3_usecases/numberSequenceUsecases.js';

test('numberSequence next creates and increments formatted sequence', async () => {
  const runtime = createMemoryDataRuntime();
  const ctx = createRequestContext(runtime);

  const first = await nextSequence(ctx, {
    sequenceKey: 'purchasing.PurchaseOrder.global',
    prefix: 'PO-',
    scopeType: 'global',
    padding: 4,
  });
  const second = await nextSequence(ctx, {
    sequenceKey: 'purchasing.PurchaseOrder.global',
    prefix: 'PO-',
    scopeType: 'global',
    padding: 4,
  });

  assert.equal(first.value, 'PO-0001');
  assert.equal(second.value, 'PO-0002');
  assert.equal(second.record.currentValue, 2);
});
