/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/cm/onceStore.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ONCE_ANSWER_RETENTION_MS, ONCE_ANSWER_TABLE, onceAnswerDefinition } from '/_102034_/l1/server/layer_1_external/connections/cm/onceStore.js';
import { tableDefinitions } from '/_102034_/l1/server/layer_1_external/connections/cm/persistence.js';
import masterModules from '/_102034_/masterModules.json' with { type: 'json' };

it('rt325 s1: the table of once is a platform persistence module, unique on (module, scope, key), kept 30 days', () => {
  assert.deepEqual(tableDefinitions, [onceAnswerDefinition]);
  assert.equal(onceAnswerDefinition.tableName, ONCE_ANSWER_TABLE);
  assert.deepEqual(onceAnswerDefinition.primaryKey, ['module', 'scope', 'key']);
  assert.equal(onceAnswerDefinition.columns.find((column) => column.name === 'answer')?.postgresType, 'JSONB');
  assert.equal(ONCE_ANSWER_RETENTION_MS, 30 * 24 * 60 * 60 * 1000);
  const registered = (masterModules as { persistenceModules: Array<{ moduleId: string; persistenceEntrypoint: string }> }).persistenceModules;
  assert.equal(registered.find((entry) => entry.moduleId === 'platformOnce')?.persistenceEntrypoint, './_102034_/l1/server/layer_1_external/connections/cm/persistence.js');
});
