/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/registry.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import {
  loadResolvedDynamoTableDefinitions,
  loadResolvedTableDefinitions,
  resetResolvedTableDefinitionsCache,
} from '/_102034_/l1/server/layer_1_external/persistence/registry.js';

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
