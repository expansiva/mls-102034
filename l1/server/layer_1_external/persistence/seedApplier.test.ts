/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/seedApplier.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ResolvedTableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import { applySeedRows, buildSeedInsertSql, serializeSeedValue } from '/_102034_/l1/server/layer_1_external/persistence/seedApplier.js';

function table(partial: Partial<ResolvedTableDefinition> & Pick<ResolvedTableDefinition, 'tableName' | 'columns' | 'primaryKey'>): ResolvedTableDefinition {
  return {
    moduleId: 'geo',
    projectId: '900111',
    repositoryName: partial.tableName,
    logicalTableName: partial.logicalTableName ?? 'country',
    description: 'fixture',
    purpose: 'cadastro',
    backupHot: false,
    storageProfile: 'postgres',
    writeMode: 'sync',
    version: 1,
    dynamoResolvedTableName: null,
    ...partial,
  };
}

test('initial insert is parameterized and does not stringify arrays', () => {
  const sql = buildSeedInsertSql('mls_country', ['org_id', 'code', 'meta', 'tags'], 'initial');
  assert.equal(
    sql,
    'INSERT INTO "mls_country" ("org_id", "code", "meta", "tags") VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
  );
  assert.equal(buildSeedInsertSql('t', ['id'], 'test').includes('ON CONFLICT'), false);
  assert.equal(serializeSeedValue('jsonb', { a: 1 }), '{"a":1}');
  assert.deepEqual(serializeSeedValue('text[]', ['x', 'y']), ['x', 'y']);
  assert.equal(serializeSeedValue('text', 'plain'), 'plain');
  assert.equal(buildSeedInsertSql('odd"name', ['a"b'], 'initial').includes('"odd""name"'), true);
});

test('composite primary key and secondary unique count conflict then a new row', async () => {
  const country = table({
    tableName: 'mls900111_geo_country',
    columns: [
      { name: 'org_id', postgresType: 'text' },
      { name: 'code', postgresType: 'text' },
      { name: 'email', postgresType: 'text' },
      { name: 'meta', postgresType: 'jsonb' },
      { name: 'tags', postgresType: 'text[]' },
    ],
    primaryKey: ['org_id', 'code'],
    indexes: [{ name: 'uq_email', columns: ['email'], unique: true }],
    initialSeedRows: [
      { org_id: 'acme', code: 'BR', email: 'br@geo.test', meta: { k: 1 }, tags: ['a'] },
      { org_id: 'acme', code: 'BR', email: 'other@geo.test', meta: { k: 2 }, tags: ['b'] },
      { org_id: 'acme', code: 'PT', email: 'br@geo.test', meta: { k: 3 }, tags: ['c'] },
      { org_id: 'acme', code: 'AR', email: 'ar@geo.test', meta: { k: 4 }, tags: ['d'] },
    ],
    seedRows: [
      { org_id: 'acme', code: 'BR', email: 'test@geo.test', meta: { k: 9 }, tags: [] },
      { org_id: 'acme', code: 'CL', email: 'cl@geo.test', meta: {}, tags: ['t'] },
    ],
    seedOrigins: [{
      purpose: 'initial',
      source: 'geo/seeds.ts',
      projectId: '900111',
      moduleId: 'geo',
      seedFor: 'country',
    }],
  });
  const seenPk = new Set<string>();
  const seenEmail = new Set<string>();
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const pool = {
    async query(sql: string, values?: unknown[]) {
      const bound = values ?? [];
      calls.push({ sql, values: bound });
      if (!sql.includes('ON CONFLICT')) {
        return { rowCount: 1 };
      }
      const pk = `${String(bound[0])}\u0000${String(bound[1])}`;
      const email = String(bound[2]);
      if (seenPk.has(pk) || seenEmail.has(email)) {
        return { rowCount: 0 };
      }
      seenPk.add(pk);
      seenEmail.add(email);
      return { rowCount: 1 };
    },
  };

  const counts = await applySeedRows(pool, [country], {
    projectMode: () => 'development',
    serverMode: 'development',
    rebuiltTableNames: new Set([country.tableName]),
  });

  assert.equal(counts.initialInserted, 2);
  assert.equal(counts.initialConflicts, 2);
  assert.equal(counts.testInserted, 1);
  const initialCalls = calls.filter((call) => call.sql.includes('ON CONFLICT DO NOTHING'));
  assert.equal(initialCalls.length, 4);
  assert.deepEqual(initialCalls[0].values, ['acme', 'BR', 'br@geo.test', '{"k":1}', ['a']]);
  assert.equal(initialCalls.every((call) => !call.sql.includes("'acme'")), true);
  const testCalls = calls.filter((call) => !call.sql.includes('ON CONFLICT'));
  assert.equal(testCalls.length, 1);
  assert.equal(String(testCalls[0].values[1]), 'CL');
});

test('initial SQL error is propagated with table and origin', async () => {
  const country = table({
    tableName: 'mls_country',
    logicalTableName: 'mls_country',
    columns: [{ name: 'id', postgresType: 'text' }],
    primaryKey: ['id'],
    initialSeedRows: [{ id: 'BR' }],
    seedOrigins: [{
      purpose: 'initial',
      source: 'lib/seeds.ts',
      projectId: '102034',
      moduleId: 'geo',
      seedFor: 'country',
    }],
  });
  await assert.rejects(
    () => applySeedRows({
      async query() {
        throw new Error('invalid input syntax');
      },
    }, [country], {
      projectMode: () => 'production',
      serverMode: 'production',
      rebuiltTableNames: new Set([country.tableName]),
    }),
    (error: unknown) => {
      assert.match(String(error), /mls_country/);
      assert.match(String(error), /lib\/seeds\.ts/);
      return true;
    },
  );
});

test('test rows outside a test mode produce no SQL', async () => {
  const calls: string[] = [];
  const country = table({
    tableName: 'mls_country',
    columns: [{ name: 'id', postgresType: 'text' }],
    primaryKey: ['id'],
    seedRows: [{ id: 'mock' }],
    initialSeedRows: [{ id: 'real' }],
  });
  const counts = await applySeedRows({
    async query(sql: string) {
      calls.push(sql);
      return { rowCount: 1 };
    },
  }, [country], {
    projectMode: () => 'production',
    serverMode: 'homologation',
    rebuiltTableNames: new Set([country.tableName]),
  });
  assert.deepEqual(counts, { initialInserted: 1, initialConflicts: 0, testInserted: 0 });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /ON CONFLICT DO NOTHING/);
});
