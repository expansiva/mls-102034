/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/kvReserve.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { getMdmKv, putMdmKv, reserveMdmKv } from '/_102034_/l1/mdm/layer_3_usecases/kvUsecases.js';

test('a key is reserved once; the second caller gets the row that holds it', async () => {
  const ctx = createRequestContext(createMemoryDataRuntime());
  const first = await reserveMdmKv(ctx, { key: 'reserve:one', value: { by: 'first' } });
  const second = await reserveMdmKv(ctx, { key: 'reserve:one', value: { by: 'second' } });
  assert.equal(first.reserved, true);
  assert.equal(second.reserved, false);
  assert.deepEqual(second.record?.value, { by: 'first' });
  assert.deepEqual((await getMdmKv(ctx, { key: 'reserve:one' }))?.value, { by: 'first' });
});

test('many callers at once on one key: exactly one reserves', async () => {
  const ctx = createRequestContext(createMemoryDataRuntime());
  const results = await Promise.all(Array.from({ length: 25 }, (_, index) => reserveMdmKv(ctx, { key: 'reserve:race', value: { by: index } })));
  assert.equal(results.filter((entry) => entry.reserved).length, 1);
  const winner = results.find((entry) => entry.reserved)!;
  for (const entry of results) assert.deepEqual(entry.record?.value, winner.record?.value);
});

test('the reserved row is then written with the result, and another key is independent', async () => {
  const ctx = createRequestContext(createMemoryDataRuntime());
  await reserveMdmKv(ctx, { key: 'reserve:done', value: { state: 'reserved' } });
  await putMdmKv(ctx, { key: 'reserve:done', value: { state: 'done', outcome: 'done' } });
  assert.deepEqual((await getMdmKv(ctx, { key: 'reserve:done' }))?.value, { state: 'done', outcome: 'done' });
  assert.equal((await reserveMdmKv(ctx, { key: 'reserve:other', value: {} })).reserved, true);
  await assert.rejects(() => reserveMdmKv(ctx, { key: '  ', value: {} }), /key is required/);
});

test('the memory table refuses a repeated primary key like the database does', async () => {
  const ctx = createRequestContext(createMemoryDataRuntime());
  const table = await ctx.data.moduleData.getTable<{ key: string; value: unknown }>('mdmKv');
  await table.insert({ record: { key: 'dup', value: 1 } });
  await assert.rejects(() => table.insert({ record: { key: 'dup', value: 2 } }), (error: { code?: string }) => error.code === '23505');
  await table.upsert?.({ record: { key: 'dup', value: 3 } });
});
