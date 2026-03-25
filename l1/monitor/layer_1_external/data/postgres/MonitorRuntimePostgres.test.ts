/// <mls fileReference="_102034_/l1/monitor/layer_1_external/data/postgres/MonitorRuntimePostgres.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeDynamoKey,
  getStatusGroup,
  isSafeMonitorIdentifier,
  normalizeDynamoKey,
  normalizeInspectFilters,
  normalizeStringList,
  parseRoutineParts,
} from '/_102034_/l1/monitor/layer_1_external/data/postgres/MonitorRuntimePostgres.js';

test('parseRoutineParts splits module pageName and command', () => {
  assert.deepEqual(parseRoutineParts('monitor.monitorGetStatistics.getSnapshot'), {
    module: 'monitor',
    pageName: 'monitorGetStatistics',
    command: 'getSnapshot',
  });
});

test('getStatusGroup maps exact and grouped HTTP statuses', () => {
  assert.equal(getStatusGroup(200), 'success');
  assert.equal(getStatusGroup(404), 'not_found');
  assert.equal(getStatusGroup(409), 'client_error');
  assert.equal(getStatusGroup(500), 'server_error');
});

test('normalizeInspectFilters keeps only non-empty string filters', () => {
  assert.deepEqual(normalizeInspectFilters({
    id: '123',
    empty: '   ',
    ok: 'yes',
    invalid: 99,
  }), {
    id: '123',
    ok: 'yes',
  });
});

test('dynamo cursor normalization roundtrips', () => {
  const key = {
    pk: { S: 'company#1' },
    sk: { S: 'profile#1' },
  };

  const cursor = normalizeDynamoKey(key);
  assert.equal(typeof cursor, 'string');
  assert.deepEqual(decodeDynamoKey(cursor), key);
});

test('isSafeMonitorIdentifier rejects dangerous values', () => {
  assert.equal(isSafeMonitorIdentifier('monitor_bff_execution_log'), true);
  assert.equal(isSafeMonitorIdentifier('mdm-cache'), true);
  assert.equal(isSafeMonitorIdentifier('bad;drop table'), false);
  assert.equal(isSafeMonitorIdentifier('bad space'), false);
});

test('normalizeStringList handles postgres array-like values', () => {
  assert.deepEqual(normalizeStringList(['id', 'createdAt']), ['id', 'createdAt']);
  assert.deepEqual(normalizeStringList('{id,createdAt}'), ['id', 'createdAt']);
  assert.deepEqual(normalizeStringList('id'), ['id']);
  assert.deepEqual(normalizeStringList(null), []);
});
