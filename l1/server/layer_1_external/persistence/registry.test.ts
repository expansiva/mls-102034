/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/registry.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import type { ResolvedTableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import {
  loadResolvedDynamoTableDefinitions,
  loadResolvedTableDefinitions,
  resetResolvedTableDefinitionsCache,
  toSchemaSnapshotTable,
} from '/_102034_/l1/server/layer_1_external/persistence/registry.js';

function snapshotFixture(overrides: Partial<ResolvedTableDefinition> = {}): ResolvedTableDefinition {
  return {
    moduleId: 'todo',
    repositoryName: 'task',
    tableName: 'mls900001_task',
    logicalTableName: 'task',
    projectId: '900001',
    purpose: 'cadastro',
    description: 'fixture',
    backupHot: false,
    storageProfile: 'postgres',
    writeMode: 'sync',
    columns: [
      { name: 'id', postgresType: 'TEXT' },
      { name: 'title', postgresType: 'TEXT', nullable: true },
    ],
    primaryKey: ['id'],
    version: 1,
    dynamoResolvedTableName: null,
    seedRows: [{ id: 'seed-1', title: 'hello' }],
    ...overrides,
  };
}

test.beforeEach(() => {
  resetResolvedTableDefinitionsCache();
});

test('persistence registry discovers core and project manifests through projects config', async () => {
  const env = readAppEnv();
  const definitions = await loadResolvedTableDefinitions(env);
  const externalDefinitions = definitions.filter((definition) => definition.projectId !== '102034');

  assert.equal(definitions.some((definition) => definition.moduleId === 'mdm'), true);
  assert.equal(definitions.some((definition) => definition.repositoryName === 'monitorBffExecutionLog'), true);
  assert.equal(externalDefinitions.length > 0, true);
});

test('persistence registry resolves Dynamo tables only for configured hot backup tables', async () => {
  const env = readAppEnv();
  const allDefinitions = await loadResolvedTableDefinitions(env);
  const dynamoDefinitions = await loadResolvedDynamoTableDefinitions(env);

  const monitorLog = allDefinitions.find((definition) => definition.repositoryName === 'monitorBffExecutionLog');
  const relationship = allDefinitions.find((definition) => definition.repositoryName === 'mdmRelationship');

  assert.equal(monitorLog?.dynamoResolvedTableName ?? null, null);
  assert.equal(typeof relationship?.dynamoResolvedTableName, 'string');
  assert.equal(dynamoDefinitions.some((definition) => definition.repositoryName === 'mdmRelationship'), true);
  assert.equal(
    dynamoDefinitions.some((definition) => definition.repositoryName === 'monitorBffExecutionLog'),
    false,
  );
});

test('schema snapshot hashes columns and ignores seedRows', () => {
  const base = toSchemaSnapshotTable(snapshotFixture());
  assert.deepEqual(base.columns, [
    { name: 'id', postgresType: 'TEXT', nullable: false, defaultSql: null },
    { name: 'title', postgresType: 'TEXT', nullable: true, defaultSql: null },
  ]);
  assert.equal('seedRows' in base, false);

  const seedOnly = toSchemaSnapshotTable(snapshotFixture({
    seedRows: [{ id: 'seed-1', title: 'hello' }, { id: 'seed-2', title: 'other' }],
  }));
  assert.equal(JSON.stringify(seedOnly), JSON.stringify(base));

  const columnChanged = toSchemaSnapshotTable(snapshotFixture({
    columns: [
      { name: 'id', postgresType: 'TEXT' },
      { name: 'title', postgresType: 'TEXT', nullable: true },
      { name: 'done', postgresType: 'BOOLEAN', defaultSql: 'FALSE' },
    ],
  }));
  assert.notEqual(JSON.stringify(columnChanged), JSON.stringify(base));
  assert.equal(columnChanged.columns.some((column) => column.name === 'done' && column.defaultSql === 'FALSE'), true);
});

test('schema snapshot stays byte-identical when only seed rows or purpose change', () => {
  const base = toSchemaSnapshotTable(snapshotFixture());
  const seedAndPurpose = toSchemaSnapshotTable(snapshotFixture({
    seedRows: [{ id: 'seed-9', title: 'replaced' }],
    initialSeedRows: [{ id: 'init-1', title: 'bootstrap' }],
    seedOrigins: [{
      purpose: 'initial',
      source: 'file:///tmp/fixture/seeds.ts',
      projectId: '900111',
      moduleId: 'todo',
      seedFor: 'task',
    }],
  }));
  assert.equal(JSON.stringify(seedAndPurpose), JSON.stringify(base));
  assert.equal('initialSeedRows' in seedAndPurpose, false);
  assert.equal('seedOrigins' in seedAndPurpose, false);
});

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';

const mlsBase = fileURLToPath(new URL('../../../../../', import.meta.url));
const previousCwd = process.cwd();
let liveWorkspace: string | undefined;

test.before(() => {
  liveWorkspace = mkdtempSync(join(tmpdir(), 'rt118-s2-live-'));
  symlinkSync(join(mlsBase, 'mls-102034'), join(liveWorkspace, 'mls-102034'));
  mkdirSync(join(liveWorkspace, 'mls-900001', 'l1', 'external'), { recursive: true });
  writeFileSync(join(liveWorkspace, 'mls-900001', 'l1', 'external', 'item.ts'), `
export const tableDefinition = {
  moduleId: 'external',
  repositoryName: 'rt118External',
  tableName: 'external_item',
  purpose: 'cadastro',
  description: 'fixture',
  backupHot: false,
  storageProfile: 'postgres',
  writeMode: 'sync',
  columns: [{ name: 'id', postgresType: 'TEXT' }],
  primaryKey: ['id'],
  version: 1
};
`);
  writeFileSync(join(liveWorkspace, 'config.json'), JSON.stringify({
    defaultProjectId: '900001',
    projects: {
      '900001': {
        root: './client',
        type: 'client',
        persistenceModules: [
          { moduleId: 'external', tableDefsDir: '/_900001_/l1/external' },
        ],
      },
      '102029': { root: './fe', type: 'master frontend' },
      '102034': {
        root: './mls-102034',
        type: 'master backend',
        persistenceModules: [
          { moduleId: 'platform', persistenceEntrypoint: '/_102034_/l1/server/persistence.js' },
          { moduleId: 'mdm', persistenceEntrypoint: '/_102034_/l1/mdm/persistence.js' },
          { moduleId: 'monitor', persistenceEntrypoint: '/_102034_/l1/monitor/persistence.js' },
        ],
      },
    },
  }));
  process.chdir(liveWorkspace);
  resetProjectsConfigCache();
  resetResolvedTableDefinitionsCache();
});

test.after(() => {
  process.chdir(previousCwd);
  resetProjectsConfigCache();
  resetResolvedTableDefinitionsCache();
  if (liveWorkspace) {
    rmSync(liveWorkspace, { recursive: true, force: true });
  }
});

interface ProbeDefinition {
  projectId: string;
  moduleId: string;
  repositoryName: string;
  tableName: string;
  logicalTableName: string;
  storageProfile: string;
  seedRows?: Record<string, unknown>[];
  initialSeedRows?: Record<string, unknown>[];
  seedOrigins?: Array<{ purpose: string; moduleId: string; projectId: string; seedFor: string; source: string }>;
}

interface ProbeResult {
  ok: boolean;
  code?: string | null;
  message?: string;
  details?: { purpose?: unknown; column?: string; seedFor?: string } | null;
  hash?: string;
  tables?: unknown;
  definitions?: ProbeDefinition[];
}

function writeConfig(workspace: string) {
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, 'config.json'), JSON.stringify({
    defaultProjectId: '900111',
    projects: {
      '900111': {
        root: './client',
        type: 'client',
        persistenceModules: [
          { moduleId: 'geo', tableDefsDir: '/_900111_/l1/geo/tables' },
          { moduleId: 'atlas', persistenceEntrypoint: '/_900111_/l1/atlas/persistence.js' },
          { moduleId: 'via', persistenceEntrypoint: '/_900111_/l1/via/persistence.js' },
        ],
      },
      '900222': {
        root: './lib',
        type: 'lib',
        persistenceModules: [
          { moduleId: 'geo', tableDefsDir: '/_900222_/l1/geo/tables' },
        ],
      },
      '102029': { root: './fe', type: 'master frontend' },
      '102034': {
        root: './be',
        type: 'master backend',
        persistenceModules: [
          { moduleId: 'mdm', tableDefsDir: '/_102034_/l1/mdm/tables' },
        ],
      },
    },
  }));
}

function writeModuleFile(workspace: string, projectId: string, relativePath: string, source: string) {
  const file = join(workspace, `mls-${projectId}`, relativePath);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, source);
}

function tableLiteral(definition: Record<string, unknown>): string {
  return JSON.stringify(definition);
}

function countryTable(moduleId: string, repositoryName: string): Record<string, unknown> {
  return {
    moduleId,
    repositoryName,
    tableName: moduleId === 'geo' && repositoryName === 'libGeoCountry' ? 'country' : `${moduleId}_country`,
    purpose: 'cadastro',
    description: 'fixture',
    backupHot: false,
    storageProfile: 'postgres',
    writeMode: 'sync',
    columns: [
      { name: 'orgId', postgresType: 'TEXT' },
      { name: 'code', postgresType: 'TEXT' },
      { name: 'email', postgresType: 'TEXT' },
      { name: 'name', postgresType: 'TEXT', nullable: true },
    ],
    primaryKey: ['orgId', 'code'],
    indexes: [{ name: `ux_${repositoryName}_email`, unique: true, columns: ['email'] }],
    version: 1,
  };
}

function writeHappyWorkspace(workspace: string, extraTestRow: boolean, initialName: string) {
  writeConfig(workspace);
  const geoInitial = {
    seedFor: 'country',
    purpose: 'initial',
    rows: [{ orgId: 'acme', code: 'BR', email: 'br@geo.test', name: initialName }],
  };
  const geoTest = {
    seedFor: 'geoCountry',
    purpose: 'test',
    rows: [{ orgId: 'acme', code: 'ZZ', email: 'zz@geo.test', name: 'test-row' }],
  };
  const geoLegacyMdm = {
    seedFor: 'mdm_person',
    rows: [{ id: 'from-client', name: 'Client legacy' }],
  };
  writeModuleFile(workspace, '900111', 'l1/geo/tables/country.ts', `
export const tableDefinition = ${tableLiteral(countryTable('geo', 'geoCountry'))};
export const geoInitial = ${JSON.stringify(geoInitial)};
export const geoTest = ${JSON.stringify(extraTestRow ? { ...geoTest, rows: [...geoTest.rows, { orgId: 'acme', code: 'YY', email: 'yy@geo.test', name: 'extra' }] } : geoTest)};
export const geoLegacyMdm = ${JSON.stringify(geoLegacyMdm)};
`);
  writeModuleFile(workspace, '900111', 'l1/atlas/persistence.ts', `
export const tableDefinition = ${tableLiteral(countryTable('atlas', 'atlasCountry'))};
export const tableDefinitions = [tableDefinition];
export const atlasInitial = ${JSON.stringify({
    seedFor: 'country',
    purpose: 'initial',
    rows: [{ orgId: 'acme', code: 'BR', email: 'br@atlas.test', name: 'Atlas' }],
  })};
export const atlasTest = ${JSON.stringify({
    seedFor: 'atlasCountry',
    rows: [{ orgId: 'acme', code: 'PT', email: 'pt@atlas.test', name: 'Portugal' }],
  })};
`);
  writeModuleFile(workspace, '900111', 'l1/via/persistence.ts', `
export const tableDefinition = ${tableLiteral({
    moduleId: 'via',
    repositoryName: 'viaLane',
    tableName: 'via_lane',
    purpose: 'cadastro',
    description: 'fixture',
    backupHot: false,
    storageProfile: 'postgres',
    writeMode: 'sync',
    columns: [
      { name: 'id', postgresType: 'TEXT' },
      { name: 'label', postgresType: 'TEXT', nullable: true },
    ],
    primaryKey: ['id'],
    version: 1,
  })};
export async function getTableDefinitions() { return [tableDefinition]; }
export const viaInitial = ${JSON.stringify({
    seedFor: 'lane',
    purpose: 'initial',
    rows: [{ id: 'lane-1', label: 'A' }],
  })};
`);
  writeModuleFile(workspace, '900222', 'l1/geo/tables/country.ts', `
export const tableDefinition = ${tableLiteral(countryTable('geo', 'libGeoCountry'))};
export const libInitial = ${JSON.stringify({
    seedFor: 'country',
    purpose: 'initial',
    rows: [{ orgId: 'lib', code: 'BR', email: 'br@lib.test', name: 'Library' }],
  })};
`);
  writeModuleFile(workspace, '102034', 'l1/mdm/tables/person.ts', `
export const tableDefinition = ${tableLiteral({
    moduleId: 'mdm',
    repositoryName: 'mdmPerson',
    tableName: 'mdm_person',
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
    seedRows: [{ id: 'builtin', name: 'Builtin' }],
    version: 1,
  })};
`);
}

function writeBrokenWorkspace(workspace: string, kind: 'purpose' | 'column' | 'key' | 'dynamo') {
  writeConfig(workspace);
  const postgres = {
    moduleId: 'geo',
    repositoryName: 'geoCountry',
    tableName: 'geo_country',
    purpose: 'cadastro',
    description: 'fixture',
    backupHot: false,
    storageProfile: 'postgres',
    writeMode: 'sync',
    columns: [
      { name: 'id', postgresType: 'TEXT', nullable: kind === 'key' },
      { name: 'name', postgresType: 'TEXT', nullable: true },
    ],
    primaryKey: ['id'],
    version: 1,
  };
  if (kind === 'purpose') {
    writeModuleFile(workspace, '900111', 'l1/geo/tables/country.ts', `
export const tableDefinition = ${tableLiteral(postgres)};
export const badSeed = ${JSON.stringify({ seedFor: 'country', purpose: 'fixture', rows: [{ id: '1', name: 'x' }] })};
`);
  } else if (kind === 'column') {
    writeModuleFile(workspace, '900111', 'l1/atlas/persistence.ts', `
export const tableDefinition = ${tableLiteral({ ...postgres, moduleId: 'atlas', repositoryName: 'atlasCountry', tableName: 'atlas_country' })};
export const tableDefinitions = [tableDefinition];
export const badSeed = ${JSON.stringify({ seedFor: 'atlasCountry', purpose: 'initial', rows: [{ id: '1', missing: true }] })};
`);
  } else if (kind === 'key') {
    writeModuleFile(workspace, '900111', 'l1/via/persistence.ts', `
export const tableDefinition = ${tableLiteral({ ...postgres, moduleId: 'via', repositoryName: 'viaLane', tableName: 'via_lane' })};
export async function getTableDefinitions() { return [tableDefinition]; }
export const badSeed = ${JSON.stringify({ seedFor: 'viaLane', purpose: 'initial', rows: [{ name: 'no-key' }] })};
`);
  } else {
    writeModuleFile(workspace, '900111', 'l1/geo/tables/hot.ts', `
export const tableDefinition = ${tableLiteral({
    moduleId: 'geo',
    repositoryName: 'geoHot',
    tableName: 'geo_hot',
    purpose: 'transacao',
    description: 'fixture',
    backupHot: false,
    storageProfile: 'dynamoOnly',
    writeMode: 'sync',
    columns: [{ name: 'id', postgresType: 'TEXT' }],
    primaryKey: [],
    dynamo: { tableName: 'GeoHot', partitionKey: 'id' },
    version: 1,
  })};
export const hotSeed = ${JSON.stringify({ seedFor: 'geoHot', purpose: 'initial', rows: [{ id: '1' }] })};
`);
  }
  if (kind !== 'purpose' && kind !== 'dynamo') {
    writeModuleFile(workspace, '900111', 'l1/geo/tables/country.ts', `
export const tableDefinition = ${tableLiteral(postgres)};
`);
  }
  if (kind !== 'column') {
    writeModuleFile(workspace, '900111', 'l1/atlas/persistence.ts', `
export const tableDefinition = ${tableLiteral({ ...postgres, moduleId: 'atlas', repositoryName: 'atlasCountry', tableName: 'atlas_country', nullable: undefined })};
export const tableDefinitions = [tableDefinition];
`);
  }
  if (kind !== 'key') {
    writeModuleFile(workspace, '900111', 'l1/via/persistence.ts', `
export const tableDefinition = ${tableLiteral({
    moduleId: 'via',
    repositoryName: 'viaLane',
    tableName: 'via_lane',
    purpose: 'cadastro',
    description: 'fixture',
    backupHot: false,
    storageProfile: 'postgres',
    writeMode: 'sync',
    columns: [{ name: 'id', postgresType: 'TEXT' }],
    primaryKey: ['id'],
    version: 1,
  })};
export async function getTableDefinitions() { return [tableDefinition]; }
`);
  }
  writeModuleFile(workspace, '900222', 'l1/geo/tables/country.ts', `
export const tableDefinition = ${tableLiteral({ ...countryTable('geo', 'libGeoCountry'), columns: [{ name: 'orgId', postgresType: 'TEXT' }, { name: 'code', postgresType: 'TEXT' }, { name: 'email', postgresType: 'TEXT' }, { name: 'name', postgresType: 'TEXT', nullable: true }] })};
`);
  writeModuleFile(workspace, '102034', 'l1/mdm/tables/person.ts', `
export const tableDefinition = ${tableLiteral({
    moduleId: 'mdm',
    repositoryName: 'mdmPerson',
    tableName: 'mdm_person',
    purpose: 'cadastro',
    description: 'fixture',
    backupHot: false,
    storageProfile: 'postgres',
    writeMode: 'sync',
    columns: [{ name: 'id', postgresType: 'TEXT' }, { name: 'name', postgresType: 'TEXT', nullable: true }],
    primaryKey: ['id'],
    version: 1,
  })};
`);
}

function runProbe(workspace: string): Promise<ProbeResult> {
  const script = join(workspace, 'probe.mts');
  writeFileSync(script, `
import { chdir } from 'node:process';
chdir(process.argv[2]);
const registry = await import('/_102034_/l1/server/layer_1_external/persistence/registry.js');
const config = await import('/_102034_/l1/server/layer_1_external/config/projectConfig.js');
config.resetProjectsConfigCache();
registry.resetResolvedTableDefinitionsCache();
try {
  const env = { appEnv: 'development' };
  const definitions = await registry.loadResolvedTableDefinitions(env);
  const snapshot = await registry.buildSchemaSnapshot(env);
  process.stdout.write(JSON.stringify({
    ok: true,
    hash: snapshot.hash,
    tables: snapshot.tables,
    definitions: definitions.map((definition) => ({
      projectId: definition.projectId,
      moduleId: definition.moduleId,
      repositoryName: definition.repositoryName,
      tableName: definition.tableName,
      logicalTableName: definition.logicalTableName,
      storageProfile: definition.storageProfile,
      seedRows: definition.seedRows ?? null,
      initialSeedRows: definition.initialSeedRows ?? null,
      seedOrigins: definition.seedOrigins ?? null,
    })),
  }));
} catch (error) {
  const caught = error;
  process.stdout.write(JSON.stringify({
    ok: false,
    code: caught.code ?? null,
    message: caught.message ?? String(error),
    details: caught.details ?? null,
  }));
}
`);
  return new Promise((resolve, reject) => {
    const child = spawn(
      join(mlsBase, 'node_modules/.bin/tsx'),
      ['--import', join(mlsBase, 'test/register-hooks.mjs'), script, workspace],
      { cwd: mlsBase },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`probe exit ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as ProbeResult);
      } catch (error) {
        reject(new Error(`probe output (${code}): ${stdout}\n${stderr}\n${error}`));
      }
    });
  });
}

test('persistence registry keeps initial and test apart across modules, entrypoints and schema hash', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rt118-s2-'));
  const happyA = join(root, 'a');
  const happyB = join(root, 'b');
  const brokenPurpose = join(root, 'purpose');
  const brokenColumn = join(root, 'column');
  const brokenKey = join(root, 'key');
  const brokenDynamo = join(root, 'dynamo');
  try {
    writeHappyWorkspace(happyA, false, 'Brasil');
    writeHappyWorkspace(happyB, true, 'Brasil-edited');
    const [left, right] = await Promise.all([runProbe(happyA), runProbe(happyB)]);
    assert.equal(left.ok, true, left.message);
    assert.equal(right.ok, true, right.message);
    assert.equal(left.hash, right.hash);
    assert.equal(JSON.stringify(left.tables), JSON.stringify(right.tables));

    const byRepo = new Map((left.definitions ?? []).map((definition) => [definition.repositoryName, definition]));
    const geo = byRepo.get('geoCountry');
    const atlas = byRepo.get('atlasCountry');
    const via = byRepo.get('viaLane');
    const lib = byRepo.get('libGeoCountry');
    const mdm = byRepo.get('mdmPerson');
    assert.ok(geo && atlas && via && lib && mdm);
    assert.equal(geo.logicalTableName, 'country');
    assert.equal(atlas.logicalTableName, 'country');
    assert.equal(lib.logicalTableName, 'country');
    assert.notEqual(geo.tableName, atlas.tableName);
    assert.equal(geo.projectId, '900111');
    assert.equal(lib.projectId, '900222');
    assert.deepEqual(geo.initialSeedRows, [{ orgId: 'acme', code: 'BR', email: 'br@geo.test', name: 'Brasil' }]);
    assert.deepEqual(atlas.initialSeedRows, [{ orgId: 'acme', code: 'BR', email: 'br@atlas.test', name: 'Atlas' }]);
    assert.deepEqual(lib.initialSeedRows, [{ orgId: 'lib', code: 'BR', email: 'br@lib.test', name: 'Library' }]);
    assert.equal(geo.initialSeedRows?.some((row) => row.name === 'Atlas' || row.name === 'Library'), false);
    assert.deepEqual(geo.seedRows, [{ orgId: 'acme', code: 'ZZ', email: 'zz@geo.test', name: 'test-row' }]);
    assert.deepEqual(via.initialSeedRows, [{ id: 'lane-1', label: 'A' }]);
    assert.equal(via.seedRows ?? null, null);
    assert.equal(mdm.initialSeedRows ?? null, null);
    assert.deepEqual(mdm.seedRows, [
      { id: 'builtin', name: 'Builtin' },
      { id: 'from-client', name: 'Client legacy' },
    ]);
    assert.equal(mdm.tableName, mdm.logicalTableName);
    assert.deepEqual(
      geo.seedOrigins?.map((origin) => origin.purpose).sort(),
      ['initial', 'test'],
    );
    assert.equal(geo.seedOrigins?.every((origin) => origin.moduleId === 'geo' && origin.projectId === '900111'), true);
    assert.equal(mdm.seedOrigins?.some((origin) => origin.purpose === 'test' && origin.moduleId === 'geo' && origin.seedFor === 'mdm_person'), true);
    assert.equal(atlas.seedOrigins?.some((origin) => origin.purpose === 'test' && !origin.source.includes('purpose')), true);

    writeBrokenWorkspace(brokenPurpose, 'purpose');
    writeBrokenWorkspace(brokenColumn, 'column');
    writeBrokenWorkspace(brokenKey, 'key');
    writeBrokenWorkspace(brokenDynamo, 'dynamo');
    const [purpose, column, key, dynamo] = await Promise.all([
      runProbe(brokenPurpose),
      runProbe(brokenColumn),
      runProbe(brokenKey),
      runProbe(brokenDynamo),
    ]);
    assert.equal(purpose.ok, false);
    assert.equal(purpose.code, 'PERSISTENCE_SEED_INVALID');
    assert.match(purpose.message ?? '', /unknown seed purpose/);
    assert.equal(purpose.details?.purpose, 'fixture');
    assert.equal(column.ok, false);
    assert.match(column.message ?? '', /does not exist/);
    assert.equal(column.details?.column, 'missing');
    assert.equal(key.ok, false);
    assert.match(key.message ?? '', /complete non-null unique key/);
    assert.equal(dynamo.ok, false);
    assert.match(dynamo.message ?? '', /dynamoOnly/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
