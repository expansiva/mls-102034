/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/schemaModulePlan.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SchemaSnapshot } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import {
  formatMigrationReport,
  moduleHashes,
  planModuleRebuild,
} from '/_102034_/l1/server/layer_1_external/persistence/schemaModulePlan.js';

type SnapshotTable = SchemaSnapshot['tables'][number];

function table(overrides: Partial<SnapshotTable> & Pick<SnapshotTable, 'moduleId' | 'tableName'>): SnapshotTable {
  return {
    projectId: '900001',
    repositoryName: overrides.tableName,
    storageProfile: 'postgres',
    backupHot: false,
    dynamoTableName: null,
    version: 1,
    columns: [{ name: 'id', postgresType: 'TEXT', nullable: false, defaultSql: null }],
    ...overrides,
  };
}

test('plan is none when every applied hash matches', () => {
  const current = new Map([
    ['agendaClinica', 'h1'],
    ['comandaRestaurante', 'h2'],
  ]);
  const plan = planModuleRebuild({
    current,
    applied: new Map(current),
    lastSnapshotId: 'registry:abc',
    currentSnapshotId: 'registry:abc',
  });
  assert.deepEqual(plan, {
    mode: 'none',
    rebuild: [],
    untouched: ['agendaClinica', 'comandaRestaurante'],
    removed: [],
  });
});

test('plan is modules with only the changed module', () => {
  const plan = planModuleRebuild({
    current: new Map([
      ['controleEstoque', 'new'],
      ['comandaRestaurante', 'same'],
      ['mdm', 'same'],
    ]),
    applied: new Map([
      ['controleEstoque', 'old'],
      ['comandaRestaurante', 'same'],
      ['mdm', 'same'],
    ]),
    lastSnapshotId: 'registry:old',
    currentSnapshotId: 'registry:new',
  });
  assert.deepEqual(plan, {
    mode: 'modules',
    rebuild: ['controleEstoque'],
    untouched: ['comandaRestaurante', 'mdm'],
    removed: [],
  });
});

test('new module is rebuilt', () => {
  const plan = planModuleRebuild({
    current: new Map([
      ['agendaClinica', 'h1'],
      ['novoModulo', 'h2'],
    ]),
    applied: new Map([['agendaClinica', 'h1']]),
    lastSnapshotId: 'registry:a',
    currentSnapshotId: 'registry:b',
  });
  assert.deepEqual(plan, {
    mode: 'modules',
    rebuild: ['novoModulo'],
    untouched: ['agendaClinica'],
    removed: [],
  });
});

test('missing module is removed', () => {
  const plan = planModuleRebuild({
    current: new Map([['mdm', 'h1']]),
    applied: new Map([
      ['mdm', 'h1'],
      ['legado', 'h2'],
    ]),
    lastSnapshotId: 'registry:a',
    currentSnapshotId: 'registry:b',
  });
  assert.deepEqual(plan, {
    mode: 'modules',
    rebuild: [],
    untouched: ['mdm'],
    removed: ['legado'],
  });
});

test('no state and matching snapshot is recordOnly', () => {
  const plan = planModuleRebuild({
    current: new Map([
      ['mdm', 'h1'],
      ['monitor', 'h2'],
    ]),
    applied: null,
    lastSnapshotId: 'registry:same',
    currentSnapshotId: 'registry:same',
  });
  assert.deepEqual(plan, {
    mode: 'recordOnly',
    rebuild: [],
    untouched: ['mdm', 'monitor'],
    removed: [],
  });
});

test('no state and different snapshot is full', () => {
  const plan = planModuleRebuild({
    current: new Map([
      ['mdm', 'h1'],
      ['monitor', 'h2'],
    ]),
    applied: null,
    lastSnapshotId: 'registry:old',
    currentSnapshotId: 'registry:new',
  });
  assert.deepEqual(plan, {
    mode: 'full',
    rebuild: ['mdm', 'monitor'],
    untouched: [],
    removed: [],
  });
});

test('module hash is independent of table and module order', async () => {
  const a = table({ moduleId: 'estoque', tableName: 'item', version: 1 });
  const b = table({
    moduleId: 'estoque',
    tableName: 'movimento',
    columns: [
      { name: 'id', postgresType: 'TEXT', nullable: false, defaultSql: null },
      { name: 'qty', postgresType: 'INT', nullable: false, defaultSql: null },
    ],
  });
  const c = table({ moduleId: 'mdm', tableName: 'entity' });

  const first = await moduleHashes([c, b, a]);
  const second = await moduleHashes([a, c, b]);

  assert.equal(first.get('estoque'), second.get('estoque'));
  assert.equal(first.get('mdm'), second.get('mdm'));
  assert.equal(first.size, 2);
});

test('migration report matches the published block line by line', () => {
  const text = formatMigrationReport({
    rebuilt: [{ moduleId: 'controleEstoque', tables: 3, seedRows: 12 }],
    untouched: ['comandaRestaurante', 'agendaClinica', 'mdm', 'monitor'],
    removed: [],
  });
  assert.equal(
    text,
    [
      '[migrate] refeitos (tabelas zeradas): controleEstoque (3 tabelas, seed: 12 linhas)',
      '[migrate] intactos: comandaRestaurante, agendaClinica, mdm, monitor',
      '[migrate] removidos: —',
      '[migrate] migração real (preservar dados ao mudar esquema): ainda não existe',
    ].join('\n'),
  );
});
