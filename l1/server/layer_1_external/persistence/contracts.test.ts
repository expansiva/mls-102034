/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/contracts.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyProjectTableNamespace,
  isClientProjectType,
  logicalTableNameFromEmitted,
  matchesTableLookup,
  moduleTableNamespacePrefix,
  projectTableNamespacePrefix,
  resolvePostgresTableName,
  resolveRepositoryName,
  type ResolvedTableDefinition,
  type TableDefinition,
} from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';

// Mirror of the mapping loadResolvedTableDefinitions applies, exercised without the registry (whose
// transitive imports need a built dist). Keeps the resolution contract under a deterministic test.
function resolve(definition: TableDefinition, projectId: string, projectType: string): ResolvedTableDefinition {
  const env = { appEnv: 'production' as const };
  const emittedName = resolvePostgresTableName(definition, env);
  const logicalTableName = isClientProjectType(projectType)
    ? logicalTableNameFromEmitted(emittedName, definition.moduleId)
    : emittedName;
  return {
    ...definition,
    logicalTableName,
    tableName: applyProjectTableNamespace(emittedName, projectId, projectType),
    projectId,
    repositoryName: resolveRepositoryName(definition),
    dynamoResolvedTableName: null,
  };
}

const orderDef: TableDefinition = {
  moduleId: 'cafeFlow', repositoryName: 'cafeFlowOrder', tableName: 'order', purpose: 'transacao',
  description: 'Orders', backupHot: false, storageProfile: 'postgres', writeMode: 'sync',
  columns: [{ name: 'order_id', postgresType: 'UUID' }], primaryKey: ['order_id'], version: 1,
};
const mdmDef: TableDefinition = {
  moduleId: 'mdm', repositoryName: 'mdmDocumentCache', tableName: 'mdm_documents', purpose: 'cache',
  description: 'MDM docs', backupHot: false, storageProfile: 'postgres', writeMode: 'sync',
  columns: [{ name: 'mdmId', postgresType: 'TEXT' }], primaryKey: ['mdmId'], version: 1,
};

test('isClientProjectType is true only for client-owned projects', () => {
  assert.equal(isClientProjectType('client'), true);
  assert.equal(isClientProjectType('master backend'), false);
  assert.equal(isClientProjectType('master frontend'), false);
  assert.equal(isClientProjectType('lib'), false);
  assert.equal(isClientProjectType(undefined), false);
});

test('applyProjectTableNamespace prefixes client tables and leaves platform tables untouched', () => {
  // Client-owned application tables get the per-project namespace so two projects on one VM never
  // collide on generic names.
  assert.equal(applyProjectTableNamespace('order', '102051', 'client'), 'mls102051_order');
  assert.equal(applyProjectTableNamespace('daily_shift', '102051', 'client'), 'mls102051_daily_shift');
  // Platform tables (owned by master backend / lib) keep their canonical shared names.
  assert.equal(applyProjectTableNamespace('mdm_documents', '102034', 'master backend'), 'mdm_documents');
  assert.equal(applyProjectTableNamespace('_schema_migrations', '102034', 'master backend'), '_schema_migrations');
  assert.equal(applyProjectTableNamespace('monitor_bff_execution_log', '102034', 'lib'), 'monitor_bff_execution_log');
});

test('applyProjectTableNamespace is idempotent (already-namespaced names are unchanged)', () => {
  const once = applyProjectTableNamespace('order', '102051', 'client');
  assert.equal(applyProjectTableNamespace(once, '102051', 'client'), once);
  assert.equal(projectTableNamespacePrefix('102051'), 'mls102051_');
});

test('the prefix keeps the identifier unquoted-safe in Postgres (no leading digit)', () => {
  const physical = applyProjectTableNamespace('order', '102051', 'client');
  assert.match(physical, /^[A-Za-z_][A-Za-z0-9_]*$/);
});

test('resolving a client table namespaces the physical name but keeps a logical lookup key', () => {
  const resolved = resolve(orderDef, '102051', 'client');
  assert.equal(resolved.tableName, 'mls102051_order');   // physical (SQL / DDL)
  assert.equal(resolved.logicalTableName, 'order');       // base name modules refer to
  assert.equal(resolved.repositoryName, 'cafeFlowOrder'); // logical repo name — unchanged
  // getTable('order') / getTable('cafeFlowOrder') / a lookup by physical name all still resolve.
  assert.ok(matchesTableLookup(resolved, 'order'), 'bare physical name (getTable(\'order\')) must resolve');
  assert.ok(matchesTableLookup(resolved, 'cafeFlowOrder'), 'repositoryName must resolve');
  assert.ok(matchesTableLookup(resolved, 'mls102051_order'), 'namespaced physical name must resolve');
  // seedFor targeting either the logical repo name or the base table name still hits this table.
  assert.ok(matchesTableLookup(resolved, 'cafeFlowOrder') && matchesTableLookup(resolved, 'order'));
});

test('resolving a platform table leaves its shared canonical name intact', () => {
  const resolved = resolve(mdmDef, '102034', 'master backend');
  assert.equal(resolved.tableName, 'mdm_documents');
  assert.equal(resolved.logicalTableName, 'mdm_documents');
  assert.equal(resolved.repositoryName, 'mdmDocumentCache');
  assert.ok(matchesTableLookup(resolved, 'mdm_documents') && matchesTableLookup(resolved, 'mdmDocumentCache'));
});

test('two client projects declaring the same logical table do not collide physically', () => {
  const a = resolve(orderDef, '102051', 'client');
  const b = resolve(orderDef, '102060', 'client');
  assert.notEqual(a.tableName, b.tableName);
  assert.equal(a.tableName, 'mls102051_order');
  assert.equal(b.tableName, 'mls102060_order');
});

test('a module-prefixed client table keeps the unprefixed logical lookup key', () => {
  const def: TableDefinition = {
    ...orderDef,
    moduleId: 'listaAssinatura3',
    repositoryName: 'listaAssinatura3PetitionSignature',
    tableName: 'listaassinatura3_petition_signature',
  };
  const resolved = resolve(def, '102047', 'client');
  assert.equal(resolved.tableName, 'mls102047_listaassinatura3_petition_signature');
  assert.equal(resolved.logicalTableName, 'petition_signature');
  assert.equal(resolved.repositoryName, 'listaAssinatura3PetitionSignature');
  assert.equal(moduleTableNamespacePrefix('listaAssinatura3'), 'listaassinatura3_');
  assert.ok(matchesTableLookup(resolved, 'petition_signature'));
  assert.ok(matchesTableLookup(resolved, 'listaassinatura3_petition_signature'));
  assert.ok(matchesTableLookup(resolved, 'mls102047_listaassinatura3_petition_signature'));
  assert.ok(matchesTableLookup(resolved, 'listaAssinatura3PetitionSignature'));
});

test('two modules with the same entity do not collide physically; repositoryName is unchanged', () => {
  const a = resolve({
    ...orderDef,
    moduleId: 'listaAssinatura3',
    repositoryName: 'listaAssinatura3PetitionSignature',
    tableName: 'listaassinatura3_petition_signature',
  }, '102047', 'client');
  const b = resolve({
    ...orderDef,
    moduleId: 'listaAssinatura2',
    repositoryName: 'listaAssinatura2PetitionSignature',
    tableName: 'listaassinatura2_petition_signature',
  }, '102047', 'client');
  assert.notEqual(a.tableName, b.tableName);
  assert.equal(a.tableName, 'mls102047_listaassinatura3_petition_signature');
  assert.equal(b.tableName, 'mls102047_listaassinatura2_petition_signature');
  assert.equal(a.logicalTableName, 'petition_signature');
  assert.equal(b.logicalTableName, 'petition_signature');
  assert.equal(a.repositoryName, 'listaAssinatura3PetitionSignature');
  assert.equal(b.repositoryName, 'listaAssinatura2PetitionSignature');
});
