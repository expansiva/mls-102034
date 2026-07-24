/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/contracts.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyProjectTableNamespace,
  isClientProjectType,
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
  const logicalTableName = resolvePostgresTableName(definition, env);
  return {
    ...definition,
    logicalTableName,
    tableName: applyProjectTableNamespace(logicalTableName, projectId, projectType),
    projectId,
    repositoryName: resolveRepositoryName(definition),
    dynamoResolvedTableName: null,
  };
}

// Mirror of findResolvedTableDefinition / applySeedRows matching.
function matches(def: ResolvedTableDefinition, key: string): boolean {
  return def.repositoryName === key || def.logicalTableName === key || def.tableName === key;
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
  assert.ok(matches(resolved, 'order'), 'bare physical name (getTable(\'order\')) must resolve');
  assert.ok(matches(resolved, 'cafeFlowOrder'), 'repositoryName must resolve');
  assert.ok(matches(resolved, 'mls102051_order'), 'namespaced physical name must resolve');
  // seedFor targeting either the logical repo name or the base table name still hits this table.
  assert.ok(matches(resolved, 'cafeFlowOrder') && matches(resolved, 'order'));
});

test('resolving a platform table leaves its shared canonical name intact', () => {
  const resolved = resolve(mdmDef, '102034', 'master backend');
  assert.equal(resolved.tableName, 'mdm_documents');
  assert.equal(resolved.logicalTableName, 'mdm_documents');
  assert.equal(resolved.repositoryName, 'mdmDocumentCache');
  assert.ok(matches(resolved, 'mdm_documents') && matches(resolved, 'mdmDocumentCache'));
});

test('two client projects declaring the same logical table do not collide physically', () => {
  const a = resolve(orderDef, '102051', 'client');
  const b = resolve(orderDef, '102060', 'client');
  assert.notEqual(a.tableName, b.tableName);
  assert.equal(a.tableName, 'mls102051_order');
  assert.equal(b.tableName, 'mls102060_order');
});
