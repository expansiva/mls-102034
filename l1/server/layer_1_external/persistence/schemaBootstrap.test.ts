/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPlatformOwnedTable,
  sanitizeDefinitionIndexes,
  shouldApplySeedRows,
} from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';
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

test('platform tables are the unprefixed ones; client tables carry the project namespace', () => {
  assert.equal(isPlatformOwnedTable({ tableName: 'monitor_bff_execution_log', logicalTableName: 'monitor_bff_execution_log' }), true);
  assert.equal(isPlatformOwnedTable({ tableName: 'mls900001_task', logicalTableName: 'task' }), false);
});

test('seeds follow the owning project mode; platform tables follow the server mode', () => {
  const projectPresentation = shouldApplySeedRows({
    tableName: 'mls900001_task',
    logicalTableName: 'task',
    projectMode: 'presentation',
    serverMode: 'production',
  });
  assert.equal(projectPresentation.apply, true);
  assert.match(projectPresentation.reason, /project appEnv='presentation'/u);

  const projectProduction = shouldApplySeedRows({
    tableName: 'mls900001_task',
    logicalTableName: 'task',
    projectMode: 'production',
    serverMode: 'presentation',
  });
  assert.equal(projectProduction.apply, false);
  assert.match(projectProduction.reason, /project appEnv='production' is not a test mode/u);

  const platformFromServer = shouldApplySeedRows({
    tableName: 'mdm_documents',
    logicalTableName: 'mdm_documents',
    projectMode: 'production',
    serverMode: 'presentation',
  });
  assert.equal(platformFromServer.apply, true);
  assert.match(platformFromServer.reason, /server appEnv='presentation'/u);

  const platformProduction = shouldApplySeedRows({
    tableName: 'mdm_documents',
    logicalTableName: 'mdm_documents',
    projectMode: 'presentation',
    serverMode: 'production',
  });
  assert.equal(platformProduction.apply, false);
  assert.match(platformProduction.reason, /server appEnv='production' is not a test mode/u);

  const homologation = shouldApplySeedRows({
    tableName: 'mls900001_task',
    logicalTableName: 'task',
    projectMode: 'homologation',
    serverMode: 'homologation',
  });
  assert.equal(homologation.apply, false);

  const development = shouldApplySeedRows({
    tableName: 'mls900001_task',
    logicalTableName: 'task',
    projectMode: 'development',
    serverMode: 'production',
  });
  assert.equal(development.apply, true);
});
