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
  const externalDefinitions = allDefinitions.filter((definition) => definition.projectId !== '102034');
  const externalDynamoDefinition = externalDefinitions.find((definition) => definition.dynamoResolvedTableName !== null);

  const monitorLog = allDefinitions.find((definition) => definition.repositoryName === 'monitorBffExecutionLog');

  assert.equal(monitorLog?.dynamoResolvedTableName ?? null, null);
  assert.equal(typeof externalDynamoDefinition?.dynamoResolvedTableName, 'string');
  assert.equal(externalDynamoDefinition ? dynamoDefinitions.some((definition) => definition.repositoryName === externalDynamoDefinition.repositoryName) : false, true);
  assert.equal(
    dynamoDefinitions.some((definition) => definition.repositoryName === 'monitorBffExecutionLog'),
    false,
  );
});
