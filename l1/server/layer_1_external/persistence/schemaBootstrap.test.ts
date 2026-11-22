/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  bootstrapSchema,
  forceModulesShapeReason,
  forceRebuildBlockReason,
  isPlatformOwnedTable,
  moduleResetBlockReason,
  orphanNames,
  ownedNamesFor,
  rebuiltSummary,
  readCascadeDependents,
  type CascadeDependent,
  selectModuleRebuildPlan,
  tablesToCreate,
  sanitizeDefinitionIndexes,
  shouldApplySeedRows,
} from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';
import { resolveProjectDistPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import type { ResolvedTableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
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

function resolvedDef(input: {
  moduleId: string;
  tableName: string;
  logicalTableName: string;
  seedRows: Array<Record<string, unknown>>;
  initialSeedRows?: Array<Record<string, unknown>>;
  projectId?: string;
}): ResolvedTableDefinition {
  return {
    moduleId: input.moduleId,
    repositoryName: input.tableName,
    tableName: input.tableName,
    purpose: 'cadastro',
    description: 'rt89 fixture',
    backupHot: false,
    storageProfile: 'postgres',
    writeMode: 'sync',
    columns: [{ name: 'id', postgresType: 'text', nullable: false }],
    primaryKey: ['id'],
    version: 1,
    seedRows: input.seedRows,
    ...(input.initialSeedRows ? { initialSeedRows: input.initialSeedRows } : {}),
    projectId: input.projectId ?? 'rt89-seed',
    logicalTableName: input.logicalTableName,
    dynamoResolvedTableName: null,
  };
}

/** Writes where readProjectMode reads (the projects dir, not the cwd: the runner runs from the layer root). */
function declareProjectMode(projectId: string, mode: string): string {
  const path = resolveProjectDistPath(`_${projectId}_/l5/project.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ appEnv: mode }));
  return path;
}

function removeDeclaredProject(projectId: string): void {
  rmSync(dirname(dirname(resolveProjectDistPath(`_${projectId}_/l5/project.json`))), { recursive: true, force: true });
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

test('equal snapshot without force keeps the incremental plan', () => {
  const incremental = { mode: 'none' as const, rebuild: [] as string[], untouched: ['controleEstoque'], removed: [] as string[] };
  const plan = selectModuleRebuildPlan({
    forceRebuild: false,
    incremental,
    registryModuleIds: ['controleEstoque', 'mdm'],
  });
  assert.equal(plan, incremental);
  assert.deepEqual(plan.rebuild, []);
});

test('force rebuilds the registry scope and the report counts seeds', () => {
  const plan = selectModuleRebuildPlan({
    forceRebuild: true,
    incremental: { mode: 'none' as const, rebuild: [], untouched: ['controleEstoque'], removed: [] },
    registryModuleIds: ['mdm', 'controleEstoque', 'controleEstoque'],
  });
  assert.equal(plan.mode, 'full');
  assert.deepEqual(plan.rebuild, ['controleEstoque', 'mdm']);
  assert.deepEqual(plan.untouched, []);
  assert.deepEqual(plan.removed, []);
  const report = rebuiltSummary(
    { projectId: 'rt89-seed' } as AppEnv,
    [
      resolvedDef({
        moduleId: 'controleEstoque',
        tableName: 'mls_item',
        logicalTableName: 'item',
        seedRows: [{ item_id: '1' }, { item_id: '2' }],
      }),
      resolvedDef({
        moduleId: 'mdm',
        tableName: 'mdm_documents',
        logicalTableName: 'mdm_documents',
        seedRows: [{ document_id: 'a' }],
      }),
    ],
    plan.rebuild,
  );
  assert.deepEqual(report, [
    { moduleId: 'controleEstoque', tables: 1, tableNames: ['mls_item'], seedRows: 2 },
    { moduleId: 'mdm', tables: 1, tableNames: ['mdm_documents'], seedRows: 1 },
  ]);
});

test('rebuiltSummary counts initial in every mode and test only in a test mode', () => {
  const ids = ['910118', '910119', '910120', '910121', '910122'];
  declareProjectMode('910118', 'production');
  declareProjectMode('910119', 'homologation');
  declareProjectMode('910120', 'presentation');
  declareProjectMode('910121', 'development');
  declareProjectMode('910122', 'production');
  try {
    const client = (projectId: string) => resolvedDef({
      moduleId: 'onboarding',
      tableName: `mls${projectId}_country`,
      logicalTableName: 'country',
      projectId,
      seedRows: [{ id: 't1' }, { id: 't2' }],
      initialSeedRows: [{ id: 'br' }],
    });
    const platform = (projectId: string) => resolvedDef({
      moduleId: 'mdm',
      tableName: 'mdm_documents',
      logicalTableName: 'mdm_documents',
      projectId,
      seedRows: [{ id: 'doc-test' }],
      initialSeedRows: [{ id: 'doc-initial' }],
    });
    const count = (projectId: string, serverProjectId: string) => rebuiltSummary(
      { projectId: serverProjectId } as AppEnv,
      [client(projectId), platform(projectId)],
      ['onboarding', 'mdm'],
    ).map(({ tableNames: _tableNames, ...rest }) => rest);

    assert.deepEqual(count('910118', '910118'), [
      { moduleId: 'mdm', tables: 1, seedRows: 1 },
      { moduleId: 'onboarding', tables: 1, seedRows: 1 },
    ]);
    assert.deepEqual(count('910119', '910119'), [
      { moduleId: 'mdm', tables: 1, seedRows: 1 },
      { moduleId: 'onboarding', tables: 1, seedRows: 1 },
    ]);
    assert.deepEqual(count('910120', '910120'), [
      { moduleId: 'mdm', tables: 1, seedRows: 2 },
      { moduleId: 'onboarding', tables: 1, seedRows: 3 },
    ]);
    assert.deepEqual(count('910121', '910121'), [
      { moduleId: 'mdm', tables: 1, seedRows: 2 },
      { moduleId: 'onboarding', tables: 1, seedRows: 3 },
    ]);
    // Platform follows the server mode: presentation project, production server.
    assert.deepEqual(count('910120', '910122'), [
      { moduleId: 'mdm', tables: 1, seedRows: 1 },
      { moduleId: 'onboarding', tables: 1, seedRows: 3 },
    ]);
  } finally {
    for (const id of ids) removeDeclaredProject(id);
  }
});

test('forceRebuild refuses production, homologation, and an undeclared mode', () => {
  assert.match(forceRebuildBlockReason('production', true) ?? '', /appEnv='production'/u);
  assert.match(forceRebuildBlockReason('homologation', true) ?? '', /appEnv='homologation'/u);
  assert.match(forceRebuildBlockReason('presentation', false) ?? '', /not declared/u);
  assert.equal(forceRebuildBlockReason('development', true), null);
  assert.equal(forceRebuildBlockReason('presentation', true), null);
});

test('forceRebuild on an undeclared app refuses before any schema write', async () => {
  await assert.rejects(
    () => bootstrapSchema(
      { runtimeMode: 'postgres', projectId: 'rt89-undeclared' } as AppEnv,
      { forceRebuild: true },
    ),
    /forceRebuild refused before schema write: appEnv is not declared/u,
  );
});

test('forceModules plans a modules rebuild of one module and leaves the others untouched', () => {
  const plan = selectModuleRebuildPlan({
    forceRebuild: false,
    forceModules: ['controleEstoque'],
    incremental: { mode: 'none' as const, rebuild: [], untouched: ['controleEstoque', 'mdm'], removed: [] },
    registryModuleIds: ['mdm', 'controleEstoque', 'comandaRestaurante', 'comandaRestaurante'],
  });
  assert.equal(plan.mode, 'modules');
  assert.deepEqual(plan.rebuild, ['controleEstoque']);
  assert.deepEqual(plan.untouched, ['comandaRestaurante', 'mdm']);
  assert.deepEqual(plan.removed, []);
});

test('forceModules rebuilds only that module: the drop scope and the created tables', () => {
  const { isOwned } = ownedNamesFor(allDefs, ['controleEstoque'], []);
  assert.equal(isOwned('mls102047_comandarestaurante_pedido'), false);
  assert.deepEqual(
    tablesToCreate(allDefs, 'modules', ['controleEstoque']).map((definition) => definition.tableName),
    ['mls102047_controleestoque_item', 'mls102047_controleestoque_movimento'],
  );
});

const ITEM = 'mls102047_controleestoque_item';
const MOVIMENTO = 'mls102047_controleestoque_movimento';

/** A dependent as pg_depend reports it: `description` is what pg_describe_object would say. */
function dependent(input: Partial<CascadeDependent> & { description: string }): CascadeDependent {
  return {
    referenced: ITEM,
    referencedKind: 'r',
    sequenceOwner: null,
    owner: null,
    ownerSchema: null,
    ...input,
  };
}
function fk(owner: string, referenced: string, ownerSchema = 'public'): CascadeDependent {
  return dependent({ referenced, owner, ownerSchema, description: `constraint ${owner}_fkey on table ${ownerSchema}.${owner}` });
}
function viewOver(ownerSchema: string, view: string, referenced: string, referencedKind = 'r'): CascadeDependent {
  return dependent({ referenced, referencedKind, owner: view, ownerSchema, description: `rule _RETURN on view ${ownerSchema}.${view}` });
}

const resetBase = {
  moduleId: 'controleEstoque',
  projectId: '102047',
  registry: [
    { projectId: '102047', moduleId: 'controleEstoque' },
    { projectId: '102047', moduleId: 'comandaRestaurante' },
    { projectId: '102047', moduleId: 'mdm' },
  ],
  definitions: allDefs,
  dependents: [] as CascadeDependent[],
  registryViews: ['monitor_summary'] as string[],
  incrementalMode: 'none' as const,
};

test('moduleResetBlockReason lets a clean module through, with the plan none or recordOnly', () => {
  assert.equal(moduleResetBlockReason(resetBase), null);
  assert.equal(moduleResetBlockReason({ ...resetBase, incrementalMode: 'recordOnly' }), null);
  // an FK inside the module, or from another module's table to a third one, is not a risk
  assert.equal(moduleResetBlockReason({
    ...resetBase,
    dependents: [
      fk(MOVIMENTO, ITEM),
      fk('mls102047_comandarestaurante_pedido', 'mdm_documents'),
    ],
  }), null);
});

test('moduleResetBlockReason refuses a module outside the registry of the project', () => {
  assert.match(moduleResetBlockReason({ ...resetBase, moduleId: 'naoExiste' }) ?? '', /module 'naoExiste' is not in the registry of project '102047'/u);
  assert.match(moduleResetBlockReason({ ...resetBase, projectId: 'outro' }) ?? '', /not in the registry of project 'outro'/u);
  assert.match(moduleResetBlockReason({ ...resetBase, projectId: undefined }) ?? '', /not in the registry/u);
});

test('moduleResetBlockReason refuses a module that declares a platform table', () => {
  const reason = moduleResetBlockReason({ ...resetBase, moduleId: 'mdm' }) ?? '';
  assert.match(reason, /declares platform tables \(_schema_migrations, mdm_documents\)/u);
});

const strayReason = (dependents: CascadeDependent[], extra: Partial<typeof resetBase> = {}): string =>
  moduleResetBlockReason({ ...resetBase, ...extra, dependents }) ?? '';

test('moduleResetBlockReason refuses a foreign key from outside, naming it', () => {
  const reason = strayReason([
    fk('mls102047_comandarestaurante_pedido', ITEM),
    fk('mls102047_comandarestaurante_pedido', MOVIMENTO),
  ]);
  assert.match(reason, /forceModules refused before schema write: objects outside module 'controleEstoque' depend on it and would be dropped \(constraint mls102047_comandarestaurante_pedido_fkey on table public\.mls102047_comandarestaurante_pedido\)/u);
});

test('moduleResetBlockReason refuses a foreign key from another schema', () => {
  assert.match(strayReason([fk('t_other', ITEM, 'other')]), /\(constraint t_other_fkey on table other\.t_other\)/u);
});

test('moduleResetBlockReason refuses a view outside the registry over a table or a registry view, listing them in order', () => {
  const reason = strayReason([
    viewOver('public', 'v_manual_b', ITEM),
    viewOver('public', 'v_manual_a', MOVIMENTO),
    viewOver('public', 'v_manual_a', ITEM),
    viewOver('public', 'v_over_registry', 'monitor_summary', 'v'),
  ]);
  assert.match(reason, /\(rule _RETURN on view public\.v_manual_a, rule _RETURN on view public\.v_manual_b, rule _RETURN on view public\.v_over_registry\)/u);
});

test('moduleResetBlockReason refuses a view in another schema, also with the name of a registry view', () => {
  assert.match(strayReason([viewOver('other', 'v_x', ITEM)]), /on view other\.v_x\)/u);
  assert.match(strayReason([viewOver('other', 'v_x', 'monitor_summary', 'v')]), /on view other\.v_x\)/u);
  assert.match(strayReason([viewOver('other', 'monitor_summary', ITEM)]), /on view other\.monitor_summary\)/u);
});

test('moduleResetBlockReason lets through what the reset itself drops and recreates', () => {
  assert.equal(strayReason([
    // outside view over another module's table: not touched by this reset
    viewOver('public', 'v_manual', 'mls102047_comandarestaurante_pedido'),
    // registry view over the module's table: the reset recreates it
    viewOver('public', 'monitor_summary', ITEM),
    // registry view over another registry view
    viewOver('public', 'monitor_by_module', 'monitor_summary', 'v'),
    // foreign key between two tables of the module
    fk(MOVIMENTO, ITEM),
  ], { registryViews: ['monitor_summary', 'monitor_by_module'] }), '');
});

test('moduleResetBlockReason refuses the default of an outside table that uses a sequence of the module', () => {
  const reason = strayReason([
    dependent({
      referenced: 'mls102047_controleestoque_item_id_seq',
      referencedKind: 'S',
      sequenceOwner: ITEM,
      owner: 't_outside',
      ownerSchema: 'public',
      description: 'default value for column id of table public.t_outside',
    }),
  ]);
  assert.match(reason, /\(default value for column id of table public\.t_outside\)/u);
  // the default of the module's own table over its own sequence is dropped with it
  assert.equal(strayReason([
    dependent({ referenced: 'mls102047_controleestoque_item_id_seq', referencedKind: 'S', sequenceOwner: ITEM, owner: ITEM, ownerSchema: 'public', description: 'default value for column id of table public.item' }),
  ]), '');
  // a sequence of another module's table is not touched
  assert.equal(strayReason([
    dependent({ referenced: 'other_seq', referencedKind: 'S', sequenceOwner: 'mls102047_comandarestaurante_pedido', owner: 't_outside', ownerSchema: 'public', description: 'x' }),
  ]), '');
});

test('moduleResetBlockReason refuses a dependent it cannot place, and a row-type dependent of an outside table', () => {
  assert.match(strayReason([dependent({ description: 'function public.f(item)' })]), /\(function public\.f\(item\)\)/u);
  assert.match(strayReason([dependent({ owner: 't_outside', ownerSchema: 'public', description: 'table public.t_outside column c' })]), /table public\.t_outside column c/u);
});

test('moduleResetBlockReason lets through a dependent owned by the system or Timescale internals', () => {
  assert.equal(strayReason([
    dependent({ owner: '_hyper_1_1_chunk', ownerSchema: '_timescaledb_internal', description: 'table _timescaledb_internal._hyper_1_1_chunk' }),
    dependent({ owner: '_partial_view_3', ownerSchema: '_timescaledb_internal', description: 'rule _RETURN on view _timescaledb_internal._partial_view_3' }),
    dependent({ owner: 'x', ownerSchema: 'pg_catalog', description: 'y' }),
  ]), '');
});

test('readCascadeDependents reads pg_depend of normal dependents of public relations and their row types, with the owner', async () => {
  let sql = '';
  const pool = {
    query: async (text: string) => {
      sql = text;
      return { rows: [{ referenced: 't', referenced_kind: 'r', sequence_owner: null, owner: 'v', owner_schema: 'other', description: 'rule _RETURN on view other.v' }] };
    },
  };
  const edges = await readCascadeDependents(pool as never);
  assert.deepEqual(edges, [{ referenced: 't', referencedKind: 'r', sequenceOwner: null, owner: 'v', ownerSchema: 'other', description: 'rule _RETURN on view other.v' }]);
  assert.match(sql, /dependency\.deptype = 'n'/u);
  assert.match(sql, /relation_schema\.nspname = 'public'/u);
  assert.match(sql, /pg_describe_object\(dependency\.classid, dependency\.objid, dependency\.objsubid\)/u);
  for (const catalog of ['pg_constraint', 'pg_rewrite', 'pg_trigger', 'pg_attrdef', 'pg_policy']) {
    assert.match(sql, new RegExp(`'${catalog}'::regclass`, 'u'));
  }
  assert.match(sql, /reltype/u);
  assert.doesNotMatch(sql, /owner_schema\.nspname\s*=/u);
});

test('moduleResetBlockReason refuses when another module has a pending migration', () => {
  for (const incrementalMode of ['modules', 'full'] as const) {
    assert.match(
      moduleResetBlockReason({ ...resetBase, incrementalMode }) ?? '',
      new RegExp(`pending migration \\(plan ${incrementalMode}\\); migrate first`, 'u'),
    );
  }
});

test('forceModules is exactly one id and does not combine with forceRebuild', () => {
  assert.equal(forceModulesShapeReason(['controleEstoque'], false), null);
  assert.match(forceModulesShapeReason(['controleEstoque'], true) ?? '', /does not combine with forceRebuild/u);
  assert.match(forceModulesShapeReason([], false) ?? '', /exactly one module id is required \(got 0\)/u);
  assert.match(forceModulesShapeReason(['a', 'b'], false) ?? '', /exactly one module id is required \(got 2\)/u);
  assert.match(forceModulesShapeReason([' '], false) ?? '', /exactly one module id is required/u);
});

test('forceModules refuses before any schema write: shape, forceRebuild and undeclared mode', async () => {
  const env = { runtimeMode: 'postgres', projectId: 'rt287-undeclared' } as AppEnv;
  await assert.rejects(() => bootstrapSchema(env, { forceModules: ['a', 'b'] }), /forceModules refused before schema write: exactly one/u);
  await assert.rejects(() => bootstrapSchema(env, { forceModules: ['a'], forceRebuild: true }), /does not combine with forceRebuild/u);
  await assert.rejects(() => bootstrapSchema(env, { forceModules: ['a'] }), /refused before schema write: appEnv is not declared/u);
});
