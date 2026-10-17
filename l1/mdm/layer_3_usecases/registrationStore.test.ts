/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/registrationStore.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { resetResolvedTableDefinitionsCache } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { identityCacheKey } from '/_102034_/l1/server/layer_1_external/cache/identityCache.js';
import { kvGetHandler, kvPutHandler } from '/_102034_/l1/mdm/layer_2_controllers/kvHandlers.js';
import {
  readRegistrationStore,
  registrationLockKey,
  writeRegistrationStore,
  withRegistrationTransaction,
  REGISTRATION_STORE_PREFIX,
} from '/_102034_/l1/mdm/layer_3_usecases/registrationStore.js';
import type { MdmKvRecord } from '/_102034_/l1/mdm/module.js';

const reserved = `${REGISTRATION_STORE_PREFIX}person/1`;
const previousCwd = process.cwd();
const workspace = mkdtempSync(join(tmpdir(), 'rt80-s5-'));

before(() => {
  symlinkSync(fileURLToPath(new URL('../../..', import.meta.url)), join(workspace, 'mls-102034'));
  writeFileSync(join(workspace, 'config.json'), JSON.stringify({
    defaultProjectId: '102099',
    projects: {
      '102099': {
        root: './client',
        type: 'client',
        persistenceModules: [{
          moduleId: 'mdm',
          persistenceEntrypoint: './_102034_/l1/mdm/persistence.js',
        }],
      },
      '102029': { root: './fe', type: 'master frontend' },
      '102034': { root: './be', type: 'master backend' },
    },
  }));
  process.chdir(workspace);
  resetProjectsConfigCache();
  resetResolvedTableDefinitionsCache();
});

after(() => {
  process.chdir(previousCwd);
  resetProjectsConfigCache();
  resetResolvedTableDefinitionsCache();
  rmSync(workspace, { recursive: true, force: true });
});

function isCode(error: unknown, code: string): boolean {
  return error instanceof AppError && error.code === code;
}

test('public kv handlers refuse the reserved prefix for any caller', async () => {
  const ctx = createRequestContext(createMemoryDataRuntime());
  ctx.sessionContext.actorId = 'alpha';
  const request = { routine: 'mdm.kv.get', params: { key: `  ${reserved}` } };
  await assert.rejects(() => kvGetHandler({ ctx, request }), (error: unknown) => isCode(error, 'VALIDATION_ERROR'));
  await assert.rejects(
    () => kvPutHandler({ ctx, request: { routine: 'mdm.kv.put', params: { key: reserved, value: { a: 1 } } } }),
    (error: unknown) => isCode(error, 'VALIDATION_ERROR'),
  );
  const legacy = await kvPutHandler({
    ctx,
    request: { routine: 'mdm.kv.put', params: { key: 'shared.monitor.filters', value: { pageSize: 1 } } },
  });
  assert.equal(legacy.ok, true);
  const loaded = await kvGetHandler({
    ctx,
    request: { routine: 'mdm.kv.get', params: { key: 'shared.monitor.filters' } },
  });
  assert.deepEqual(loaded.data, { key: 'shared.monitor.filters', value: { pageSize: 1 } });
});

test('registration lock key is stable per JSON tuple and changes with the scope', () => {
  const person = ['person', 'a@b.test'] as const;
  assert.equal(registrationLockKey(person), registrationLockKey(['person', 'a@b.test']));
  assert.ok(registrationLockKey(person).startsWith(REGISTRATION_STORE_PREFIX));
  assert.notEqual(registrationLockKey(person), registrationLockKey(['person', 'c@d.test']));
  assert.notEqual(registrationLockKey(person), registrationLockKey(['company', 'a@b.test']));
});

test('store roundtrip and invalid payload is not a silent miss', async () => {
  const ctx = createRequestContext(createMemoryDataRuntime());
  assert.equal(await readRegistrationStore(ctx, reserved), null);
  await writeRegistrationStore(ctx, reserved, { mdmId: 'p1', email: 'a@b.test' });
  assert.deepEqual(await readRegistrationStore(ctx, reserved), { mdmId: 'p1', email: 'a@b.test' });

  const repository = await ctx.data.moduleData.getTable<MdmKvRecord>('mdmKv');
  await repository.upsert({ record: { key: reserved, value: null } });
  await assert.rejects(
    () => readRegistrationStore(ctx, reserved),
    (error: unknown) => isCode(error, 'REGISTRATION_STORE_INVALID'),
  );
  await assert.rejects(
    () => writeRegistrationStore(ctx, 'shared.ok', { a: 1 }),
    (error: unknown) => isCode(error, 'VALIDATION_ERROR'),
  );
});

test('transaction rebinds data and facade and keeps a private cache', async () => {
  const ctx = createRequestContext(createMemoryDataRuntime());
  const email = 'a@b.test';
  const key = identityCacheKey(email);
  await ctx.cache.set(key, { mdmId: 'parent', name: 'P' });

  await withRegistrationTransaction(ctx, ['person', email], async (tx) => {
    assert.notEqual(tx.data, ctx.data);
    assert.notEqual(tx.cache, ctx.cache);
    assert.notEqual(tx.mdm, ctx.mdm);
    assert.equal(tx.clock, ctx.clock);
    await tx.cache.set(key, { mdmId: 'tx', name: 'T' });
    assert.equal(await tx.mdm.identity.findByLogin(email), 'tx');
    const parent = await ctx.cache.get<{ mdmId: string }>(key);
    assert.equal(parent?.mdmId, 'parent');
  });

  const after = await ctx.cache.get<{ mdmId: string }>(key);
  assert.equal(after?.mdmId, 'parent');
});

test('a failed registration transaction does not publish the parent cache', async () => {
  const ctx = createRequestContext(createMemoryDataRuntime());
  const email = 'fail@b.test';
  const key = identityCacheKey(email);
  await ctx.cache.set(key, { mdmId: 'kept', name: 'K' });

  await assert.rejects(
    () => withRegistrationTransaction(ctx, ['person', email], async (tx) => {
      await tx.cache.set(key, { mdmId: 'leaked', name: 'L' });
      await writeRegistrationStore(tx, reserved, { mdmId: 'draft' });
      throw new Error('rollback-point');
    }),
    (error: unknown) => error instanceof Error && error.message === 'rollback-point',
  );

  const parent = await ctx.cache.get<{ mdmId: string }>(key);
  assert.equal(parent?.mdmId, 'kept');
});

test('a registration transaction cannot start another', async () => {
  const ctx = createRequestContext(createMemoryDataRuntime());
  await assert.rejects(
    () => withRegistrationTransaction(ctx, ['person', 'a'], async (tx) => {
      await withRegistrationTransaction(tx, ['person', 'a'], async () => undefined);
    }),
    (error: unknown) => isCode(error, 'NESTED_KEYED_TRANSACTION'),
  );
});

function gate() {
  let open: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { ready, open };
}

test('same scope serializes and different scopes overlap', async () => {
  const ctx = createRequestContext(createMemoryDataRuntime());
  const hold = gate();
  const inside = gate();
  const first = withRegistrationTransaction(ctx, ['person', 'same'], async () => {
    inside.open();
    await hold.ready;
  });
  await inside.ready;
  let secondStarted = false;
  const second = withRegistrationTransaction(ctx, ['person', 'same'], async () => {
    secondStarted = true;
  });
  await Promise.resolve();
  assert.equal(secondStarted, false);
  hold.open();
  await first;
  await second;
  assert.equal(secondStarted, true);

  const left = gate();
  const right = gate();
  let overlap = false;
  await Promise.all([
    withRegistrationTransaction(ctx, ['person', 'one'], async () => {
      left.open();
      await right.ready;
      overlap = true;
    }),
    withRegistrationTransaction(ctx, ['person', 'two'], async () => {
      right.open();
      await left.ready;
      overlap = true;
    }),
  ]);
  assert.equal(overlap, true);
});
