/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/seedPolicy.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectMode } from '/_102034_/l1/server/layer_1_external/config/projectMode.js';
import {
  assertInitialSeed,
  completeUniqueKeys,
  isPlatformSeedTable,
  isTestSeedEligible,
  readSeedPurpose,
  seedModeFor,
  selectEligibleSeedRows,
  type SeedPolicyTable,
} from '/_102034_/l1/server/layer_1_external/persistence/seedPolicy.js';

const MODES: readonly ProjectMode[] = ['production', 'homologation', 'development', 'presentation'];

function countryTable(overrides: Partial<SeedPolicyTable> = {}): SeedPolicyTable {
  return {
    tableName: 'mls900111_geo_country',
    logicalTableName: 'country',
    storageProfile: 'postgres',
    columns: [
      { name: 'orgId' },
      { name: 'code' },
      { name: 'email' },
      { name: 'name', nullable: true },
    ],
    primaryKey: ['orgId', 'code'],
    indexes: [{ name: 'ux_email', unique: true, columns: ['email'] }],
    ...overrides,
  };
}

test('readSeedPurpose defaults an absent mark to test and rejects an unknown mark', () => {
  const origin = { source: 'file:///tmp/seeds.ts', seedFor: 'country' };
  assert.equal(readSeedPurpose(undefined, origin), 'test');
  assert.equal(readSeedPurpose('initial', origin), 'initial');
  assert.equal(readSeedPurpose('test', origin), 'test');
  assert.throws(
    () => readSeedPurpose('fixture', origin),
    (error: { code?: string; message?: string; details?: { purpose?: unknown } }) =>
      error.code === 'PERSISTENCE_SEED_INVALID'
      && /unknown seed purpose/.test(error.message ?? '')
      && error.details?.purpose === 'fixture',
  );
});

test('client seeds follow projectMode and platform seeds follow serverMode in all four modes', () => {
  for (const projectMode of MODES) {
    for (const serverMode of MODES) {
      const clientTable = { tableName: 'mls900111_geo_country', logicalTableName: 'country' };
      const platformTable = { tableName: 'mdm_person', logicalTableName: 'mdm_person' };
      assert.equal(isPlatformSeedTable(clientTable), false);
      assert.equal(isPlatformSeedTable(platformTable), true);
      const client = seedModeFor({ ...clientTable, projectMode, serverMode });
      const platform = seedModeFor({ ...platformTable, projectMode, serverMode });
      assert.equal(client.mode, projectMode);
      assert.equal(platform.mode, serverMode);
      assert.equal(isTestSeedEligible({ ...clientTable, projectMode, serverMode }), projectMode === 'development' || projectMode === 'presentation');
      assert.equal(isTestSeedEligible({ ...platformTable, projectMode, serverMode }), serverMode === 'development' || serverMode === 'presentation');
    }
  }
});

test('selectEligibleSeedRows keeps initial in every mode and test only in test modes', () => {
  const initial = [{ orgId: 'acme', code: 'BR', email: 'br@geo.test', name: 'Brasil' }];
  const testRows = [
    { orgId: 'acme', code: 'BR', email: 'other@geo.test', name: 'collides-pk' },
    { orgId: 'acme', code: 'PT', email: 'br@geo.test', name: 'collides-email' },
    { orgId: 'acme', code: 'AR', email: 'ar@geo.test', name: 'kept' },
  ];
  const table = countryTable({
    seedRows: testRows,
    initialSeedRows: initial,
  });
  const frozenInitial = table.initialSeedRows;
  const frozenTest = table.seedRows;

  for (const projectMode of MODES) {
    const selected = selectEligibleSeedRows(table, {
      tableName: table.tableName,
      logicalTableName: table.logicalTableName,
      projectMode,
      serverMode: 'production',
    });
    assert.deepEqual(selected[0], initial[0]);
    if (projectMode === 'development' || projectMode === 'presentation') {
      assert.deepEqual(selected, [initial[0], testRows[2]]);
    } else {
      assert.deepEqual(selected, [initial[0]]);
    }
  }

  const platform = countryTable({
    tableName: 'mdm_person',
    logicalTableName: 'mdm_person',
    primaryKey: ['orgId'],
    columns: [{ name: 'orgId' }, { name: 'name', nullable: true }],
    indexes: [],
    initialSeedRows: [{ orgId: 'p1', name: 'Initial' }],
    seedRows: [{ orgId: 'p2', name: 'Test' }],
  });
  const platformRows = selectEligibleSeedRows(platform, {
    tableName: platform.tableName,
    logicalTableName: platform.logicalTableName,
    projectMode: 'production',
    serverMode: 'presentation',
  });
  assert.deepEqual(platformRows, [
    { orgId: 'p1', name: 'Initial' },
    { orgId: 'p2', name: 'Test' },
  ]);
  const platformProduction = selectEligibleSeedRows(platform, {
    tableName: platform.tableName,
    logicalTableName: platform.logicalTableName,
    projectMode: 'presentation',
    serverMode: 'homologation',
  });
  assert.deepEqual(platformProduction, [{ orgId: 'p1', name: 'Initial' }]);

  assert.equal(frozenInitial, table.initialSeedRows);
  assert.equal(frozenTest, table.seedRows);
  assert.deepEqual(table.initialSeedRows, initial);
  assert.deepEqual(table.seedRows, testRows);
  const edited = selectEligibleSeedRows(table, {
    tableName: table.tableName,
    logicalTableName: table.logicalTableName,
    projectMode: 'development',
    serverMode: 'development',
  });
  edited.push({ orgId: 'new', code: 'ZZ', email: 'z@geo.test' });
  assert.deepEqual(table.initialSeedRows, initial);
  assert.equal(table.seedRows?.length, 3);
  assert.notEqual(edited, table.initialSeedRows);
});

test('assertInitialSeed accepts a composite primary key or a secondary unique key and refuses the rest', () => {
  const origin = {
    purpose: 'initial' as const,
    source: 'file:///tmp/geo/country.ts',
    projectId: '900111',
    moduleId: 'geo',
    seedFor: 'country',
  };
  const table = countryTable();
  assert.deepEqual(completeUniqueKeys(table), [['orgId', 'code'], ['email']]);
  assert.doesNotThrow(() => assertInitialSeed(table, [
    { orgId: 'acme', code: 'BR', email: 'br@geo.test', name: 'Brasil' },
  ], origin));
  assert.doesNotThrow(() => assertInitialSeed(table, [
    { email: 'only-unique@geo.test' },
  ], origin));

  const partial = countryTable({
    indexes: [{ name: 'ux_email_partial', unique: true, where: 'name IS NOT NULL', columns: ['email'] }],
  });
  assert.deepEqual(completeUniqueKeys(partial), [['orgId', 'code']]);

  assert.throws(
    () => assertInitialSeed(table, [{ orgId: 'acme', name: 'no-code' }], origin),
    (error: { code?: string; message?: string }) =>
      error.code === 'PERSISTENCE_SEED_INVALID' && /complete non-null unique key/.test(error.message ?? ''),
  );
  assert.throws(
    () => assertInitialSeed(table, [{ orgId: 'acme', code: 'BR', missing: true }], origin),
    (error: { code?: string; details?: { column?: string } }) => error.details?.column === 'missing',
  );

  const noKey = countryTable({
    columns: [{ name: 'id', nullable: true }, { name: 'name', nullable: true }],
    primaryKey: ['id'],
    indexes: [{ name: 'ux_name_nullable', unique: true, columns: ['name'] }],
  });
  assert.deepEqual(completeUniqueKeys(noKey), []);
  assert.throws(
    () => assertInitialSeed(noKey, [{ id: '1' }], origin),
    (error: { message?: string }) => /complete non-null unique key/.test(error.message ?? ''),
  );

  const dynamo = countryTable({ storageProfile: 'dynamoOnly', primaryKey: [], indexes: [] });
  assert.throws(
    () => assertInitialSeed(dynamo, [{ orgId: 'acme', code: 'BR' }], origin),
    (error: { code?: string; message?: string; details?: { purpose?: string; table?: string } }) =>
      error.code === 'PERSISTENCE_SEED_INVALID'
      && /dynamoOnly/.test(error.message ?? '')
      && error.details?.purpose === 'initial'
      && error.details?.table === dynamo.tableName,
  );
});
