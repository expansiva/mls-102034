/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/kvUsecases.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { getMdmKv, putMdmKv } from '/_102034_/l1/mdm/layer_3_usecases/kvUsecases.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

test('mdm kv put upserts and get returns the latest json value', async () => {
  const runtime = createMemoryDataRuntime();
  const ctx = createRequestContext(runtime);

  const first = await putMdmKv(ctx, {
    key: 'shared.monitor.filters',
    value: {
      section: 'postgres',
      pageSize: 50,
    },
  });
  const second = await putMdmKv(ctx, {
    key: 'shared.monitor.filters',
    value: {
      section: 'dynamodb',
      pageSize: 100,
    },
  });

  assert.deepEqual(first, {
    key: 'shared.monitor.filters',
    value: {
      section: 'postgres',
      pageSize: 50,
    },
  });

  const loaded = await getMdmKv(ctx, {
    key: 'shared.monitor.filters',
  });

  assert.deepEqual(second, {
    key: 'shared.monitor.filters',
    value: {
      section: 'dynamodb',
      pageSize: 100,
    },
  });
  assert.deepEqual(loaded, second);
});

test('mdm kv get returns null for missing key', async () => {
  const runtime = createMemoryDataRuntime();
  const ctx = createRequestContext(runtime);

  const loaded = await getMdmKv(ctx, {
    key: 'shared.missing.key',
  });

  assert.equal(loaded, null);
});

test('mdm kv rejects empty key on get and put', async () => {
  const runtime = createMemoryDataRuntime();
  const ctx = createRequestContext(runtime);

  await assert.rejects(
    () => getMdmKv(ctx, { key: '   ' }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'VALIDATION_ERROR',
  );

  await assert.rejects(
    () => putMdmKv(ctx, { key: '', value: { enabled: true } }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'VALIDATION_ERROR',
  );
});
