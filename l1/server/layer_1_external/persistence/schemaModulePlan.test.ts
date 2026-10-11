/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/schemaModulePlan.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SchemaSnapshot } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import {
  formatMigrationReport,
  moduleHashes,
  parseStateKey,
  planModuleRebuild,
  stateKey,
} from '/_102034_/l1/server/layer_1_external/persistence/schemaModulePlan.js';

const CLIENT = '900001';
const MASTER = '102034';
const OTHER = '102047';
const ownProjects = [CLIENT, MASTER];

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
    [stateKey(CLIENT, 'agendaClinica'), 'h1'],
    [stateKey(CLIENT, 'comandaRestaurante'), 'h2'],
  ]);
  const plan = planModuleRebuild({
    current,
    applied: new Map(current),
    lastSnapshotId: 'registry:abc',
    currentSnapshotId: 'registry:abc',
    ownProjects,
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
      [stateKey(CLIENT, 'controleEstoque'), 'new'],
      [stateKey(CLIENT, 'comandaRestaurante'), 'same'],
      [stateKey(MASTER, 'mdm'), 'same'],
    ]),
    applied: new Map([
      [stateKey(CLIENT, 'controleEstoque'), 'old'],
      [stateKey(CLIENT, 'comandaRestaurante'), 'same'],
      [stateKey(MASTER, 'mdm'), 'same'],
    ]),
    lastSnapshotId: 'registry:old',
    currentSnapshotId: 'registry:new',
    ownProjects,
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
      [stateKey(CLIENT, 'agendaClinica'), 'h1'],
      [stateKey(CLIENT, 'novoModulo'), 'h2'],
    ]),
    applied: new Map([[stateKey(CLIENT, 'agendaClinica'), 'h1']]),
    lastSnapshotId: 'registry:a',
    currentSnapshotId: 'registry:b',
    ownProjects,
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
    current: new Map([[stateKey(MASTER, 'mdm'), 'h1']]),
    applied: new Map([
      [stateKey(MASTER, 'mdm'), 'h1'],
      [stateKey(CLIENT, 'legado'), 'h2'],
    ]),
    lastSnapshotId: 'registry:a',
    currentSnapshotId: 'registry:b',
    ownProjects,
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
      [stateKey(MASTER, 'mdm'), 'h1'],
      [stateKey(MASTER, 'monitor'), 'h2'],
    ]),
    applied: null,
    lastSnapshotId: 'registry:same',
    currentSnapshotId: 'registry:same',
    ownProjects,
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
      [stateKey(MASTER, 'mdm'), 'h1'],
      [stateKey(MASTER, 'monitor'), 'h2'],
    ]),
    applied: null,
    lastSnapshotId: 'registry:old',
    currentSnapshotId: 'registry:new',
    ownProjects,
  });
  assert.deepEqual(plan, {
    mode: 'full',
    rebuild: ['mdm', 'monitor'],
    untouched: [],
    removed: [],
  });
});

test('another client in applied is neither rebuilt nor removed', () => {
  const plan = planModuleRebuild({
    current: new Map([
      [stateKey(CLIENT, 'agendaClinica'), 'h1'],
      [stateKey(MASTER, 'mdm'), 'h2'],
    ]),
    applied: new Map([
      [stateKey(CLIENT, 'agendaClinica'), 'h1'],
      [stateKey(MASTER, 'mdm'), 'h2'],
      [stateKey(OTHER, 'controleChamados'), 'other'],
      [stateKey(OTHER, 'sumiu'), 'gone'],
    ]),
    lastSnapshotId: 'registry:other-app',
    currentSnapshotId: 'registry:this-app',
    ownProjects,
  });
  assert.deepEqual(plan, {
    mode: 'none',
    rebuild: [],
    untouched: ['agendaClinica', 'mdm'],
    removed: [],
  });
  assert.equal(plan.rebuild.includes(stateKey(OTHER, 'controleChamados')), false);
  assert.equal(plan.removed.includes(stateKey(OTHER, 'controleChamados')), false);
  assert.equal(plan.removed.includes(stateKey(OTHER, 'sumiu')), false);
});

test('different lastSnapshotId with equal own hashes is none', () => {
  const current = new Map([
    [stateKey(CLIENT, 'agendaClinica'), 'h1'],
    [stateKey(MASTER, 'mdm'), 'h2'],
  ]);
  const plan = planModuleRebuild({
    current,
    applied: new Map(current),
    lastSnapshotId: 'registry:previous-app',
    currentSnapshotId: 'registry:this-app',
    ownProjects,
  });
  assert.deepEqual(plan, {
    mode: 'none',
    rebuild: [],
    untouched: ['agendaClinica', 'mdm'],
    removed: [],
  });
});

test('a missing module of the own client is removed and equal mdm stays', () => {
  const plan = planModuleRebuild({
    current: new Map([
      [stateKey(CLIENT, 'agendaClinica'), 'h1'],
      [stateKey(MASTER, 'mdm'), 'same'],
    ]),
    applied: new Map([
      [stateKey(CLIENT, 'agendaClinica'), 'h1'],
      [stateKey(CLIENT, 'moduloSumido'), 'h9'],
      [stateKey(MASTER, 'mdm'), 'same'],
      [stateKey(MASTER, 'platform'), 'old-master'],
    ]),
    lastSnapshotId: 'registry:old',
    currentSnapshotId: 'registry:new',
    ownProjects,
  });
  assert.deepEqual(plan, {
    mode: 'modules',
    rebuild: [],
    untouched: ['agendaClinica', 'mdm'],
    removed: ['moduloSumido'],
  });
});

test('no own-client row keeps the snapshot transition rule', () => {
  const current = new Map([
    [stateKey(CLIENT, 'agendaClinica'), 'h1'],
    [stateKey(MASTER, 'mdm'), 'h2'],
  ]);
  const applied = new Map([
    [stateKey(MASTER, 'mdm'), 'different'],
    [stateKey(OTHER, 'controleChamados'), 'x'],
  ]);
  const full = planModuleRebuild({
    current,
    applied,
    lastSnapshotId: 'registry:old',
    currentSnapshotId: 'registry:new',
    ownProjects,
  });
  assert.deepEqual(full, {
    mode: 'full',
    rebuild: ['agendaClinica', 'mdm'],
    untouched: [],
    removed: [],
  });
  const recordOnly = planModuleRebuild({
    current,
    applied,
    lastSnapshotId: 'registry:same',
    currentSnapshotId: 'registry:same',
    ownProjects,
  });
  assert.equal(recordOnly.mode, 'recordOnly');
  assert.deepEqual(recordOnly.removed, []);
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

  assert.equal(first.get(stateKey('900001', 'estoque')), second.get(stateKey('900001', 'estoque')));
  assert.equal(first.get(stateKey('900001', 'mdm')), second.get(stateKey('900001', 'mdm')));
  assert.equal(first.size, 2);
  assert.deepEqual(parseStateKey(stateKey('900001', 'estoque')), { projectId: '900001', moduleId: 'estoque' });
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
