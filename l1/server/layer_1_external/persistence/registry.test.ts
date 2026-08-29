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
