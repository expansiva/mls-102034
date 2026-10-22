/// <mls fileReference="_102034_/l1/server/layer_1_external/data/moduleDataRuntime.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFindManyWindow,
  buildCountSql,
  buildFindManySql,
  createMemoryTableRepository,
  DEFAULT_PAGE_SIZE,
  type IFindManyInput,
  MAX_PAGE_SIZE,
  resolveListPage,
} from '/_102034_/l1/server/layer_1_external/data/moduleDataRuntime.js';

type Row = { id: string; name: string; status: string };

const ROWS: Row[] = [
  { id: '1', name: 'alpha', status: 'open' },
  { id: '2', name: 'beta', status: 'open' },
  { id: '3', name: 'gamma', status: 'done' },
  { id: '4', name: 'delta', status: 'open' },
  { id: '5', name: 'epsilon', status: 'open' },
];

test('resolveListPage defaults to page 1 / size 20 and caps at 200, declaring the cut', () => {
  assert.deepEqual(resolveListPage(), { page: 1, pageSize: DEFAULT_PAGE_SIZE, limit: DEFAULT_PAGE_SIZE, offset: 0 });
  assert.deepEqual(resolveListPage({}), { page: 1, pageSize: DEFAULT_PAGE_SIZE, limit: DEFAULT_PAGE_SIZE, offset: 0 });
  assert.deepEqual(resolveListPage({ page: 0, pageSize: 0 }), { page: 1, pageSize: DEFAULT_PAGE_SIZE, limit: DEFAULT_PAGE_SIZE, offset: 0 });
  assert.deepEqual(resolveListPage({ page: 2, pageSize: 20 }), { page: 2, pageSize: 20, limit: 20, offset: 20 });
  assert.deepEqual(resolveListPage({ page: 1, pageSize: 200 }), { page: 1, pageSize: 200, limit: 200, offset: 0 });
  const cut = resolveListPage({ page: 1, pageSize: 500 });
  assert.equal(cut.pageSize, MAX_PAGE_SIZE);
  assert.equal(cut.limit, MAX_PAGE_SIZE);
  assert.equal(cut.pageSize, 200);
});

test('findMany without limit/offset returns every matching row (byte-identical to the unpaged path)', async () => {
  const repo = createMemoryTableRepository(ROWS);
  const all = await repo.findMany();
  assert.deepEqual(all.map((row) => row.id), ['1', '2', '3', '4', '5']);
  const filtered = await repo.findMany({ where: { status: 'open' } });
  assert.deepEqual(filtered.map((row) => row.id), ['1', '2', '4', '5']);
});

test('memory and postgres agree: offset windows the page, count is the filter total', async () => {
  const repo = createMemoryTableRepository(ROWS);
  const filter: IFindManyInput<Row> = { where: { status: 'open' }, ilike: { name: 'ta' }, orderBy: { field: 'id', direction: 'asc' } };
  // open + name contains 'ta': beta, delta (gamma is done). → 2, 4
  const total = await repo.count(filter);
  assert.equal(total, 2, 'total is matching rows, not the page length');
  const page = await repo.findMany({ ...filter, limit: 1, offset: 1 });
  assert.deepEqual(page.map((row) => row.id), ['4']);

  const findSql = buildFindManySql('task', { ...filter, limit: 1, offset: 1 });
  const countSql = buildCountSql('task', filter);
  assert.match(findSql.sql, /OFFSET 1/);
  assert.match(findSql.sql, /LIMIT 1/);
  assert.match(countSql.sql, /COUNT\(\*\)::int AS count/);
  assert.deepEqual(countSql.params, findSql.params, 'COUNT uses the same WHERE params as SELECT');
  assert.equal(countSql.sql.includes('OFFSET'), false);
  assert.equal(countSql.sql.includes('LIMIT'), false);
});

test('applyFindManyWindow: limit without offset is the old slice; offset without limit skips then returns the rest', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(applyFindManyWindow(ids, { limit: 2 }), ['a', 'b']);
  assert.deepEqual(applyFindManyWindow(ids, { offset: 2 }), ['c', 'd']);
  assert.deepEqual(applyFindManyWindow(ids, { limit: 2, offset: 1 }), ['b', 'c']);
  assert.deepEqual(applyFindManyWindow(ids), ids);
});

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import type { ProjectMode } from '/_102034_/l1/server/layer_1_external/config/projectMode.js';
import { resetResolvedTableDefinitionsCache } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { createMemoryModuleDataRuntime } from '/_102034_/l1/server/layer_1_external/data/moduleDataRuntime.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';

const previousCwd = process.cwd();
const previousProjectId = process.env.PROJECT_ID;

function writeSeedWorkspace(workspace: string, clientId: string, serverId: string, clientMode: ProjectMode, serverMode: ProjectMode) {
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, 'config.json'), JSON.stringify({
    defaultProjectId: clientId,
    projects: {
      [clientId]: {
        root: './client',
        type: 'client',
        persistenceModules: [{ moduleId: 'demo', tableDefsDir: `/_${clientId}_/l1/demo` }],
      },
      '102029': { root: './fe', type: 'master frontend' },
      [serverId]: {
        root: './be',
        type: 'master backend',
        persistenceModules: [{ moduleId: 'mdm', tableDefsDir: `/_${serverId}_/l1/mdm` }],
      },
    },
  }));
  const table = {
    purpose: 'cadastro',
    description: 'fixture',
    backupHot: false,
    storageProfile: 'postgres',
    writeMode: 'sync',
    columns: [
      { name: 'id', postgresType: 'TEXT' },
      { name: 'name', postgresType: 'TEXT', nullable: true },
    ],
    primaryKey: ['id'],
    version: 1,
  };
  const seeds = (seedFor: string, key: string) => `
export const initialRows = ${JSON.stringify({
    seedFor,
    purpose: 'initial',
    rows: [{ [key]: 'shared', name: 'initial' }],
  })};
export const testRows = ${JSON.stringify({
    seedFor,
    purpose: 'test',
    rows: [
      { [key]: 'shared', name: 'test-overwrite' },
      { [key]: 'only-test', name: 'test' },
    ],
  })};
`;
  const clientDir = join(workspace, `mls-${clientId}`, 'l1', 'demo');
  const serverDir = join(workspace, `mls-${serverId}`, 'l1', 'mdm');
  mkdirSync(clientDir, { recursive: true });
  mkdirSync(join(workspace, `mls-${clientId}`, 'l5'), { recursive: true });
  mkdirSync(serverDir, { recursive: true });
  mkdirSync(join(workspace, `mls-${serverId}`, 'l5'), { recursive: true });
  writeFileSync(join(clientDir, 'widget.ts'), `
export const tableDefinition = ${JSON.stringify({
    ...table,
    moduleId: 'demo',
    repositoryName: 'widget',
    tableName: 'widget',
  })};
${seeds('widget', 'id')}
`);
  writeFileSync(join(serverDir, 'entityIndex.ts'), `
export const tableDefinition = ${JSON.stringify({
    ...table,
    moduleId: 'mdm',
    repositoryName: 'mdmEntityIndex',
    tableName: 'mdm_entity_index',
    columns: [
      { name: 'mdmId', postgresType: 'TEXT' },
      { name: 'name', postgresType: 'TEXT', nullable: true },
    ],
    primaryKey: ['mdmId'],
  })};
${seeds('mdmEntityIndex', 'mdmId')}
`);
  writeFileSync(join(workspace, `mls-${clientId}`, 'l5', 'project.json'), JSON.stringify({ appEnv: clientMode }));
  writeFileSync(join(workspace, `mls-${serverId}`, 'l5', 'project.json'), JSON.stringify({ appEnv: serverMode }));
}

async function namesFrom(rows: Array<{ id: string; name: string }>): Promise<Record<string, string>> {
  return Object.fromEntries(rows.map((row) => [row.id, row.name]));
}

test('memory stores follow seed purpose: initial in every mode, test only in test modes', async () => {
  const cases: Array<{ clientMode: ProjectMode; serverMode: ProjectMode; clientTest: boolean; serverTest: boolean }> = [
    { clientMode: 'production', serverMode: 'production', clientTest: false, serverTest: false },
    { clientMode: 'homologation', serverMode: 'homologation', clientTest: false, serverTest: false },
    { clientMode: 'presentation', serverMode: 'presentation', clientTest: true, serverTest: true },
    { clientMode: 'development', serverMode: 'development', clientTest: true, serverTest: true },
    { clientMode: 'production', serverMode: 'presentation', clientTest: false, serverTest: true },
  ];
  let index = 0;
  for (const item of cases) {
    const clientId = `91${index}11`;
    const serverId = `81${index}11`;
    index += 1;
    const workspace = mkdtempSync(join(tmpdir(), 'rt118-s4-'));
    writeSeedWorkspace(workspace, clientId, serverId, item.clientMode, item.serverMode);
    process.chdir(workspace);
    process.env.PROJECT_ID = serverId;
    resetProjectsConfigCache();
    resetResolvedTableDefinitionsCache();
    try {
      const env = readAppEnv();
      assert.equal(env.projectId, serverId);
      const moduleRuntime = createMemoryModuleDataRuntime(env);
      const table = await moduleRuntime.getTable<{ id: string; name: string }>('widget');
      const first = await table.findMany();
      const second = await table.findMany();
      assert.deepEqual(await namesFrom(second), await namesFrom(first));
      const clientNames = await namesFrom(first);
      assert.equal(clientNames.shared, 'initial');
      assert.equal('only-test' in clientNames, item.clientTest);
      assert.equal(Object.values(clientNames).includes('test-overwrite'), false);

      if (item.clientMode === 'presentation') {
        await table.update({ where: { id: 'shared' }, patch: { name: 'edited' } });
        const edited = await (await moduleRuntime.getTable<{ id: string; name: string }>('widget')).findMany();
        assert.equal(edited.length, first.length);
        assert.equal(edited.find((row) => row.id === 'shared')?.name, 'edited');
      }

      const mdm = createMemoryDataRuntime();
      const platform = await mdm.mdmEntityIndex.findMany();
      const platformAgain = await mdm.mdmEntityIndex.findMany();
      assert.equal(platformAgain.length, platform.length);
      const platformNames = Object.fromEntries(platform.map((row) => [row.mdmId, row.name]));
      assert.equal(platformNames.shared, 'initial');
      assert.equal('only-test' in platformNames, item.serverTest);
      if (item.serverMode === 'presentation') {
        await mdm.mdmEntityIndex.update({ where: { mdmId: 'shared' }, patch: { name: 'edited' } });
        const edited = await mdm.mdmEntityIndex.findMany();
        assert.equal(edited.length, platform.length);
        assert.equal(edited.find((row) => row.mdmId === 'shared')?.name, 'edited');
      }
    } finally {
      process.chdir(previousCwd);
      if (previousProjectId === undefined) {
        delete process.env.PROJECT_ID;
      } else {
        process.env.PROJECT_ID = previousProjectId;
      }
      resetProjectsConfigCache();
      resetResolvedTableDefinitionsCache();
      rmSync(workspace, { recursive: true, force: true });
    }
  }
});

test('a sandbox run loads initial and test rows whatever the mode; initial wins a key clash', async () => {
  const { copySandboxSeedRows } = await import('/_102034_/l1/server/layer_1_external/data/moduleDataRuntime.js');
  const definition = {
    tableName: 'mdm_entity_index',
    logicalTableName: 'mdm_entity_index',
    projectId: 'not-a-declared-project',
    storageProfile: 'postgresOnly',
    columns: [{ name: 'mdm_id', nullable: false }, { name: 'name' }],
    primaryKey: ['mdm_id'],
    seedRows: [{ mdm_id: 'actor-1', name: 'test' }, { mdm_id: 'shared', name: 'test' }],
    initialSeedRows: [{ mdm_id: 'shared', name: 'initial' }],
  } as never;
  const rows = copySandboxSeedRows(definition);
  assert.deepEqual(rows.map((row) => row.mdm_id).sort(), ['actor-1', 'shared']);
  assert.equal(rows.find((row) => row.mdm_id === 'shared')?.name, 'initial');
});
