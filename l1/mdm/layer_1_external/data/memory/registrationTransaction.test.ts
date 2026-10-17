/// <mls fileReference="_102034_/l1/mdm/layer_1_external/data/memory/registrationTransaction.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

function createBarrier() {
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release: () => release() };
}

test('legacy runInTransaction without options still invokes callback with runtime', async () => {
  const runtime = createMemoryDataRuntime();
  const value = await runtime.runInTransaction(async (trx) => {
    assert.equal(trx.mode, 'memory');
    return 7;
  });
  assert.equal(value, 7);
});

test('same lockKey serializes two operations without overlapping', async () => {
  const runtime = createMemoryDataRuntime();
  const firstInside = createBarrier();
  const holdFirst = createBarrier();
  let secondEntered = false;
  const order: string[] = [];

  const first = runtime.runInTransaction(
    async () => {
      order.push('a-start');
      firstInside.release();
      await holdFirst.wait;
      order.push('a-end');
      return 'a';
    },
    { lockKey: 'email:one' },
  );

  await firstInside.wait;

  const second = runtime.runInTransaction(
    async () => {
      secondEntered = true;
      order.push('b');
      return 'b';
    },
    { lockKey: 'email:one' },
  );

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(secondEntered, false);

  holdFirst.release();
  assert.deepEqual(await Promise.all([first, second]), ['a', 'b']);
  assert.equal(secondEntered, true);
  assert.deepEqual(order, ['a-start', 'a-end', 'b']);
});

test('different lockKeys progress independently', async () => {
  const runtime = createMemoryDataRuntime();
  const aInside = createBarrier();
  const bInside = createBarrier();
  const holdA = createBarrier();
  const holdB = createBarrier();

  const first = runtime.runInTransaction(
    async () => {
      aInside.release();
      await holdA.wait;
      return 'a';
    },
    { lockKey: 'key-a' },
  );
  const second = runtime.runInTransaction(
    async () => {
      bInside.release();
      await holdB.wait;
      return 'b';
    },
    { lockKey: 'key-b' },
  );

  await Promise.all([aInside.wait, bInside.wait]);
  holdA.release();
  holdB.release();
  assert.deepEqual(await Promise.all([first, second]), ['a', 'b']);
});

test('failure releases the key so a waiter can run and idle queue is dropped', async () => {
  const runtime = createMemoryDataRuntime();
  const firstInside = createBarrier();

  const first = runtime.runInTransaction(
    async () => {
      firstInside.release();
      throw new Error('boom');
    },
    { lockKey: 'retry' },
  );

  await firstInside.wait;
  const second = runtime.runInTransaction(async () => 'recovered', { lockKey: 'retry' });

  await assert.rejects(first, /boom/);
  assert.equal(await second, 'recovered');

  const third = runtime.runInTransaction(async () => 'again', { lockKey: 'retry' });
  assert.equal(await third, 'again');
});

test('same lockKey on distinct runtime instances does not serialize', async () => {
  const left = createMemoryDataRuntime();
  const right = createMemoryDataRuntime();
  const leftInside = createBarrier();
  const rightInside = createBarrier();
  const hold = createBarrier();

  const first = left.runInTransaction(
    async () => {
      leftInside.release();
      await hold.wait;
      return 'left';
    },
    { lockKey: 'shared-name' },
  );
  const second = right.runInTransaction(
    async () => {
      rightInside.release();
      await hold.wait;
      return 'right';
    },
    { lockKey: 'shared-name' },
  );

  await Promise.all([leftInside.wait, rightInside.wait]);
  hold.release();
  assert.deepEqual(await Promise.all([first, second]), ['left', 'right']);
});

test('nested transaction without lockKey reuses the bound runtime', async () => {
  const runtime = createMemoryDataRuntime();
  const seen: unknown[] = [];

  await runtime.runInTransaction(async (outer) => {
    seen.push(outer);
    await outer.runInTransaction(async (inner) => {
      seen.push(inner);
      assert.equal(inner, outer);
    });
  });

  assert.equal(seen.length, 2);
});

test('bound transaction rejects a nested lockKey with NESTED_KEYED_TRANSACTION', async () => {
  const runtime = createMemoryDataRuntime();

  await runtime.runInTransaction(async (outer) => {
    await assert.rejects(
      () => outer.runInTransaction(async () => undefined, { lockKey: 'nested' }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'NESTED_KEYED_TRANSACTION');
        return true;
      },
    );
  });

  await runtime.runInTransaction(
    async (outer) => {
      await assert.rejects(
        () => outer.runInTransaction(async () => undefined, { lockKey: 'nested' }),
        (error: unknown) => error instanceof AppError && error.code === 'NESTED_KEYED_TRANSACTION',
      );
    },
    { lockKey: 'outer' },
  );
});
