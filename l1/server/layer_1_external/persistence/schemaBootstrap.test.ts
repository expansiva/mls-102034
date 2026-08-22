/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDefinitionIndexes } from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';
import type { TableIndexDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';

function def(input: {
  tableName: string;
  primaryKey: string[];
  indexes: TableIndexDefinition[];
  logicalTableName?: string;
}) {
  return input;
}

function names(definition: { indexes?: TableIndexDefinition[] }): string[] {
  return (definition.indexes ?? []).map((index) => index.name);
}

test('sanitizeDefinitionIndexes discards an index named <table>_pkey', () => {
  const logs: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  try {
    const result = sanitizeDefinitionIndexes(def({
      tableName: 'appointment_availability',
      primaryKey: ['availability_id'],
      indexes: [
        { name: 'appointment_availability_pkey', columns: ['availability_id'], unique: true },
        { name: 'appointment_availability_service_id_idx', columns: ['service_id'] },
      ],
    }));
    assert.deepEqual(names(result), ['appointment_availability_service_id_idx']);
    assert.equal(logs.some((line) => line.includes('appointment_availability_pkey') && line.includes('appointment_availability')), true);
  } finally {
    console.info = original;
  }
});

test('sanitizeDefinitionIndexes discards a namespaced <physicalTable>_pkey after the project prefix', () => {
  const result = sanitizeDefinitionIndexes(def({
    tableName: 'mls102047_appointment_availability',
    logicalTableName: 'appointment_availability',
    primaryKey: ['availability_id'],
    indexes: [
      { name: 'mls102047_appointment_availability_pkey', columns: ['availability_id'], unique: true },
      { name: 'mls102047_appointment_availability_service_id_idx', columns: ['service_id'] },
    ],
  }));
  assert.deepEqual(names(result), ['mls102047_appointment_availability_service_id_idx']);
});

test('sanitizeDefinitionIndexes discards an index whose columns are exactly the primaryKey', () => {
  const result = sanitizeDefinitionIndexes(def({
    tableName: 'appointment_availability',
    primaryKey: ['availability_id'],
    indexes: [
      { name: 'appointment_availability_availability_id_uidx', columns: ['availability_id'], unique: true },
      { name: 'appointment_availability_business_hours_id_idx', columns: ['business_hours_id'] },
    ],
  }));
  assert.deepEqual(names(result), ['appointment_availability_business_hours_id_idx']);
});

test('sanitizeDefinitionIndexes keeps legitimate secondary indexes (service_execution)', () => {
  const indexes: TableIndexDefinition[] = [
    { name: 'service_execution_service_appointment_id_idx', columns: ['service_appointment_id'] },
    { name: 'service_execution_status_idx', columns: ['status'] },
  ];
  const result = sanitizeDefinitionIndexes(def({
    tableName: 'service_execution',
    primaryKey: ['service_execution_id'],
    indexes,
  }));
  assert.equal(result.indexes, indexes);
  assert.deepEqual(names(result), [
    'service_execution_service_appointment_id_idx',
    'service_execution_status_idx',
  ]);
});
