/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPlatformOwnedTable,
  orphanNames,
  ownedNamesFor,
  tablesToCreate,
  sanitizeDefinitionIndexes,
  shouldApplySeedRows,
} from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';
import { formatMigrationReport } from '/_102034_/l1/server/layer_1_external/persistence/schemaModulePlan.js';
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

function ownedDef(input: {
  tableName: string;
  logicalTableName: string;
  moduleId: string;
  projectId?: string;
}) {
  return { projectId: input.projectId ?? '102047', ...input };
}

const moduleA = [
  ownedDef({
    tableName: 'mls102047_controleestoque_item',
    logicalTableName: 'item',
    moduleId: 'controleEstoque',
  }),
  ownedDef({
    tableName: 'mls102047_controleestoque_movimento',
    logicalTableName: 'movimento',
    moduleId: 'controleEstoque',
  }),
];
const moduleB = [
  ownedDef({
    tableName: 'mls102047_comandarestaurante_pedido',
    logicalTableName: 'pedido',
    moduleId: 'comandaRestaurante',
  }),
];
const platform = [
  ownedDef({
    tableName: '_schema_migrations',
    logicalTableName: '_schema_migrations',
    moduleId: 'mdm',
  }),
  ownedDef({
    tableName: 'mdm_documents',
    logicalTableName: 'mdm_documents',
    moduleId: 'mdm',
  }),
];
const allDefs = [...moduleA, ...moduleB, ...platform];

test('ownedNamesFor rebuilds A and leaves B intact', () => {
  const { isOwned } = ownedNamesFor(allDefs, ['controleEstoque'], []);
  assert.equal(isOwned('mls102047_controleestoque_item'), true);
  assert.equal(isOwned('mls102047_controleestoque_movimento'), true);
  assert.equal(isOwned('item'), true);
  assert.equal(isOwned('mls102047_comandarestaurante_pedido'), false);
  assert.equal(isOwned('pedido'), false);
  assert.equal(isOwned('mdm_documents'), false);
  assert.equal(isOwned('_schema_migrations'), false);
});

test('ownedNamesFor drops a removed module by prefix only', () => {
  const { isOwned } = ownedNamesFor([...moduleB, ...platform], [], ['controleEstoque']);
  assert.equal(isOwned('mls102047_controleestoque_item'), true);
  assert.equal(isOwned('mls102047_comandarestaurante_pedido'), false);
  assert.equal(isOwned('_schema_migrations'), false);
});

test('ownedNamesFor keeps _schema_migrations out of a modules rebuild', () => {
  const { isOwned } = ownedNamesFor(allDefs, ['mdm'], []);
  assert.equal(isOwned('mdm_documents'), true);
  assert.equal(isOwned('_schema_migrations'), false);
});

test('ownedNamesFor full matches today: project prefix, platform tables, migrations', () => {
  const { isOwned } = ownedNamesFor(allDefs, 'all', []);
  assert.equal(isOwned('mls102047_controleestoque_item'), true);
  assert.equal(isOwned('mls102047_comandarestaurante_pedido'), true);
  assert.equal(isOwned('mls102047_legacy_unprefixed'), true);
  assert.equal(isOwned('mdm_documents'), true);
  assert.equal(isOwned('_schema_migrations'), true);
  assert.equal(isOwned('mls102030_otherproject_table'), false);
  assert.equal(isOwned('_schema_module_state'), false);
});

test('tablesToCreate skips _schema_migrations when platform is rebuilt', () => {
  const platformModule = [
    ownedDef({
      tableName: '_schema_migrations',
      logicalTableName: '_schema_migrations',
      moduleId: 'platform',
    }),
    ownedDef({
      tableName: 'mdm_documents',
      logicalTableName: 'mdm_documents',
      moduleId: 'platform',
    }),
  ];
  const created = tablesToCreate([...moduleA, ...moduleB, ...platformModule], 'modules', ['platform'])
    .map((definition) => definition.tableName);
  assert.deepEqual(created, ['mdm_documents']);
  const { isOwned } = ownedNamesFor([...moduleA, ...moduleB, ...platformModule], ['platform'], []);
  assert.equal(isOwned('_schema_migrations'), false);
});

test('orphanNames ignores intact modules and is empty in a full rebuild', () => {
  const existing = [
    'mls102047_controleestoque_item',
    'mls102047_comandarestaurante_pedido',
    'mls102047_item',
    'mdm_documents',
  ];
  const prefixes = ['mls102047_'];
  const modules = ownedNamesFor(allDefs, ['controleEstoque'], []);
  assert.deepEqual(
    orphanNames(existing, allDefs, modules.isOwned, prefixes),
    ['mls102047_item'],
  );
  const full = ownedNamesFor(allDefs, 'all', []);
  assert.deepEqual(orphanNames(existing, allDefs, full.isOwned, prefixes), []);
});

test('ownedNamesFor does not drop an old table without the module prefix', () => {
  const { isOwned } = ownedNamesFor(allDefs, ['controleEstoque'], []);
  assert.equal(isOwned('mls102047_item'), false);
  assert.equal(isOwned('mls102047_pedido'), false);
});

test('formatMigrationReport includes orphans when provided', () => {
  const text = formatMigrationReport({
    rebuilt: [{ moduleId: 'controleEstoque', tables: 3, seedRows: 12 }],
    untouched: ['comandaRestaurante'],
    removed: [],
    orphans: ['mls102047_item'],
  });
  assert.equal(
    text,
    [
      '[migrate] refeitos (tabelas zeradas): controleEstoque (3 tabelas, seed: 12 linhas)',
      '[migrate] intactos: comandaRestaurante',
      '[migrate] removidos: —',
      '[migrate] órfãs (não apagadas): mls102047_item',
      '[migrate] migração real (preservar dados ao mudar esquema): ainda não existe',
    ].join('\n'),
  );
});
