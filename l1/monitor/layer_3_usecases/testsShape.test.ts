/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/testsShape.test.ts" enhancement="_blank" />
// The `paginated` drift guard of the monitor Tests runner. A paginated envelope names its
// collection after the entity on this wire (`{ menuItems: [...] }`), so the generated case declares
// the key in `expect.itemsKey`; files generated before the key existed omit it and must keep
// falling back to `items`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applySeedAnchors, applySeedSpares, checkShape, coercePageTestsFile, countItems, evaluate, itemsAt, reportAppEnv, PAGE11_VARIANT_POLICY, resolveParams, selectMonitorSeedRows, untestedPageEntries } from '/_102034_/l1/monitor/layer_3_usecases/testsUsecases.js';

const menuEnvelope = { menuItems: [{ menuItemId: 'a' }, { menuItemId: 'b' }], total: 2 };

test('list coverage: variants share page11; untested pages are named with a reason', () => {
  assert.match(PAGE11_VARIANT_POLICY, /page11/);
  const missing = untestedPageEntries(
    ['consultInstitutionalHome', 'petCatalogue', 'petServiceOverviewView'],
    ['petCatalogue'],
  );
  assert.deepEqual(missing.map(item => item.page), ['consultInstitutionalHome', 'petServiceOverviewView']);
  assert.match(missing[0].reason, /seedRef|seed/);
});

test('the test report appEnv is ProjectMode from project.json, not APP_ENV', () => {
  const prior = process.env.APP_ENV;
  try {
    process.env.APP_ENV = 'production';
    const reported = reportAppEnv();
    assert.equal(reported.appEnvSource, 'default', 'without a declared project.json appEnv the source is default, not a file that was not read');
    assert.equal(reported.appEnv, 'presentation', 'absent project.json falls back to presentation, never to APP_ENV');
    assert.equal(reported.serverAppEnv, 'production');
  } finally {
    if (prior === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = prior;
  }
});

test('paginated accepts the declared collection key', () => {
  assert.equal(checkShape(menuEnvelope, 'paginated', 'menuItems'), '');
  assert.equal(countItems(menuEnvelope, 'menuItems'), 2);
});

test('paginated rejects an envelope missing the declared key, naming it in the reason', () => {
  const reason = checkShape({ orders: [] }, 'paginated', 'menuItems');
  assert.match(reason, /expected paginated \{ menuItems: \[\] \}/u);
});

test('without itemsKey the runner still assumes items (pre-existing generated files)', () => {
  assert.equal(checkShape({ items: [{ id: 1 }] }, 'paginated'), '');
  assert.equal(countItems({ items: [{ id: 1 }] }), 1);
  assert.match(checkShape(menuEnvelope, 'paginated'), /expected paginated \{ items: \[\] \}/u);
});

test('array and object shapes ignore itemsKey', () => {
  assert.equal(checkShape([1, 2], 'array', 'menuItems'), '');
  assert.equal(checkShape({ a: 1 }, 'object', 'menuItems'), '');
  assert.match(checkShape({ a: 1 }, 'array', 'menuItems'), /expected array output/u);
});

// The generated file is untrusted input: itemsKey has to survive the coercion, or the whole feature
// silently degrades to `items` and the drift looks like a generator bug.
test('itemsKey survives the coercion of the generated file, and junk is dropped', () => {
  const file = coercePageTestsFile({
    moduleName: 'cafeFlow',
    page: 'menuManagement',
    cases: [
      { id: 'a.ok', routine: 'r.a', expect: { ok: true, shape: 'paginated', itemsKey: ' menuItems ' } },
      { id: 'b.ok', routine: 'r.b', expect: { ok: true, shape: 'paginated', itemsKey: '   ' } },
      { id: 'c.ok', routine: 'r.c', expect: { ok: true, shape: 'paginated', itemsKey: 42 } },
    ],
  });
  assert.ok(file);
  assert.equal(file.cases[0].expect.itemsKey, 'menuItems');
  assert.equal(file.cases[1].expect.itemsKey, undefined);
  assert.equal(file.cases[2].expect.itemsKey, undefined);
});

// countItems counting a plain object as 1 is what makes `minItems` vacuous on `shape: 'object'` —
// pinned here so the behaviour is a decision, not an accident.
test('paramFieldRefs survives coercion; junk is dropped', () => {
  const file = coercePageTestsFile({
    moduleName: 'todo',
    page: 'changeTaskStatus',
    cases: [
      { id: 'inspect.ok', routine: 'todo.x.inspect', params: { taskTaskId: '<seedRef>' }, paramFieldRefs: { taskTaskId: ' Task.taskId ' }, expect: { ok: true } },
      { id: 'b.ok', routine: 'r.b', paramFieldRefs: { a: 1, b: '   ' }, expect: { ok: true } },
    ],
  });
  assert.ok(file);
  assert.equal(file.cases[0].paramFieldRefs?.taskTaskId, 'Task.taskId');
  assert.equal(file.cases[1].paramFieldRefs, undefined);
});

test('<seedRef> with a fieldRef only accepts a value stored under that entity', () => {
  const pool = { 'Task.taskId': 'row-1' };
  const hit = resolveParams({ taskTaskId: '<seedRef>' }, pool, { taskTaskId: 'Task.taskId' });
  assert.deepEqual(hit.params, { taskTaskId: 'row-1' });
  assert.deepEqual(hit.unresolved, []);
  const byName = resolveParams({ taskId: '<seedRef>' }, { taskId: 'row-1' });
  assert.deepEqual(byName.params, { taskId: 'row-1' });
  const miss = resolveParams({ missingId: '<seedRef>' }, pool, { missingId: 'Task.missingId' });
  assert.deepEqual(miss.params, {});
  assert.deepEqual(miss.unresolved, ['missingId']);
});

test('<seedRef> with a Petition fieldRef does not resolve a petitionId harvested from another entity', () => {
  const pool = { petitionId: 'from-signature-row' };
  const result = resolveParams(
    { petitionId: '<seedRef>' },
    pool,
    { petitionId: 'Petition.petitionId' },
  );
  assert.deepEqual(result.params, {});
  assert.deepEqual(result.unresolved, ['petitionId']);
});

test('monitor harvest keeps unmarked seeds in a test mode and drops them outside one', () => {
  const unmarked = {
    tableName: 'mls910118_country',
    logicalTableName: 'country',
    storageProfile: 'postgres',
    columns: [{ name: 'id', nullable: false }],
    primaryKey: ['id'],
    seedRows: [{ id: 'legacy' }],
  };
  const modes = { tableName: unmarked.tableName, logicalTableName: unmarked.logicalTableName, serverMode: 'production' as const };
  assert.deepEqual(
    selectMonitorSeedRows(unmarked, { ...modes, projectMode: 'presentation' }).map(row => row.id),
    ['legacy'],
  );
  assert.deepEqual(
    selectMonitorSeedRows(unmarked, { ...modes, projectMode: 'production' }),
    [],
  );
});

test('monitor harvest takes initial in production and homologation, and both purposes in test modes', () => {
  const table = {
    tableName: 'mls910118_country',
    logicalTableName: 'country',
    storageProfile: 'postgres',
    columns: [{ name: 'id', nullable: false }],
    primaryKey: ['id'],
    initialSeedRows: [{ id: 'br' }],
    seedRows: [{ id: 'br' }, { id: 'test-only' }],
  };
  const base = { tableName: table.tableName, logicalTableName: table.logicalTableName, serverMode: 'production' as const };
  for (const projectMode of ['production', 'homologation'] as const) {
    assert.deepEqual(
      selectMonitorSeedRows(table, { ...base, projectMode }).map(row => row.id),
      ['br'],
    );
  }
  for (const projectMode of ['presentation', 'development'] as const) {
    assert.deepEqual(
      selectMonitorSeedRows(table, { ...base, projectMode }).map(row => row.id),
      ['br', 'test-only'],
    );
  }
});

test('monitor harvest of a platform table follows serverMode', () => {
  const table = {
    tableName: 'mdm_documents',
    logicalTableName: 'mdm_documents',
    storageProfile: 'postgres',
    columns: [{ name: 'id', nullable: false }],
    primaryKey: ['id'],
    initialSeedRows: [{ id: 'doc-initial' }],
    seedRows: [{ id: 'doc-test' }],
  };
  const base = { tableName: table.tableName, logicalTableName: table.logicalTableName, projectMode: 'production' as const };
  assert.deepEqual(
    selectMonitorSeedRows(table, { ...base, serverMode: 'presentation' }).map(row => row.id),
    ['doc-initial', 'doc-test'],
  );
  assert.deepEqual(
    selectMonitorSeedRows(table, { ...base, serverMode: 'production' }).map(row => row.id),
    ['doc-initial'],
  );
});

test('seed anchors preferred over first row when the named id is a seeded line of that entity', () => {
  const pool: Record<string, unknown> = {};
  applySeedAnchors(pool, {
    entity: 'Petition',
    fieldId: 'petitionId',
    seedRowIds: ['first-row', 'published-row'],
    namedIds: { petitionPublished: 'published-row' },
  });
  assert.equal(pool['Petition.petitionId'], 'published-row');
  const hit = resolveParams({ petitionId: '<seedRef>' }, pool, { petitionId: 'Petition.petitionId' });
  assert.deepEqual(hit.params, { petitionId: 'published-row' });
  assert.deepEqual(hit.unresolved, []);
});

test('FK fieldRef resolves from the owning entity row, not a bare petitionId', () => {
  const pool: Record<string, unknown> = { petitionId: 'stray' };
  applySeedAnchors(pool, {
    entity: 'PetitionSignature',
    fieldId: 'petitionSignatureId',
    seedRowIds: ['sig-1'],
    seedRows: [{ petition_signature_id: 'sig-1', petition_id: 'pet-from-sig' }],
    pkColumn: 'petition_signature_id',
    moduleId: 'listaAssinatura2',
  });
  const hit = resolveParams(
    { petitionId: '<seedRef>' },
    pool,
    { petitionId: 'PetitionSignature.petitionId' },
    'listaAssinatura2',
  );
  assert.deepEqual(hit.params, { petitionId: 'pet-from-sig' });
  assert.deepEqual(hit.unresolved, []);
});

test('a module-qualified seed wins over another module\'s same entity', () => {
  const pool: Record<string, unknown> = {};
  applySeedAnchors(pool, {
    entity: 'Petition',
    fieldId: 'petitionId',
    seedRowIds: ['mod-a'],
    moduleId: 'listaAssinatura',
  });
  applySeedAnchors(pool, {
    entity: 'Petition',
    fieldId: 'petitionId',
    seedRowIds: ['mod-b'],
    moduleId: 'listaAssinatura2',
  });
  const hit = resolveParams({ petitionId: '<seedRef>' }, pool, { petitionId: 'Petition.petitionId' }, 'listaAssinatura2');
  assert.deepEqual(hit.params, { petitionId: 'mod-b' });
});

test('unresolved <seedRef> makes the case inconclusive and names the param', () => {
  const result = evaluate(
    { id: 'qryInspectPetition.ok', routine: 'listaAssinatura2.petitionLanding.qryInspectPetition', params: { petitionId: '<seedRef>' }, expect: { ok: true }, mutating: false },
    'listaAssinatura2',
    'petitionLanding',
    { response: { ok: false, data: null, error: { code: 'NOT_FOUND', message: 'Petition not found' } }, statusCode: 404 },
    1,
    ['petitionId'],
  );
  assert.equal(result.status, 'inconclusive');
  assert.match(result.reason, /petitionId/);
  assert.match(result.reason, /seed marker/);
});

test('<seedValue> with a fieldRef only accepts a value stored under that entity', () => {
  const pool = { 'Widget.codigoInterno': 'INT001', codigoInterno: 'from-other-entity' };
  const hit = resolveParams({ codigoInterno: '<seedValue>' }, pool, { codigoInterno: 'Widget.codigoInterno' });
  assert.deepEqual(hit.params, { codigoInterno: 'INT001' });
  assert.deepEqual(hit.unresolved, []);
  const miss = resolveParams({ codigoInterno: '<seedValue>' }, { codigoInterno: 'from-other-entity' }, { codigoInterno: 'Widget.codigoInterno' });
  assert.deepEqual(miss.params, {});
  assert.deepEqual(miss.unresolved, ['codigoInterno']);
});

test('<seedValue> of a details field resolves from the chosen seed row', () => {
  const pool: Record<string, unknown> = {};
  applySeedAnchors(pool, {
    entity: 'Widget',
    fieldId: 'widgetId',
    seedRowIds: ['w-1'],
    seedRows: [{ widget_id: 'w-1', details: { codigoInterno: 'INT001', label: 'alpha' } }],
    pkColumn: 'widget_id',
  });
  const hit = resolveParams({ codigoInterno: '<seedValue>' }, pool, { codigoInterno: 'Widget.codigoInterno' });
  assert.deepEqual(hit.params, { codigoInterno: 'INT001' });
  assert.deepEqual(hit.unresolved, []);
});

test('<seedSpare> resolves a leftover, not the seeded row value', () => {
  const pool: Record<string, unknown> = { 'Widget.codigoInterno': 'INT001' };
  applySeedSpares(pool, { Widget: { codigoInterno: ['INT004', 'INT005'] } });
  const hit = resolveParams({ codigoInterno: '<seedSpare>' }, pool, { codigoInterno: 'Widget.codigoInterno' });
  assert.deepEqual(hit.params, { codigoInterno: 'INT004' });
  assert.notEqual(hit.params.codigoInterno, pool['Widget.codigoInterno']);
  assert.deepEqual(hit.unresolved, []);
});

test('unresolved <seedSpare> makes the case inconclusive, never a fail', () => {
  const result = evaluate(
    { id: 'cmdCreateWidget.ok', routine: 'any.page.cmdCreateWidget', params: { codigoInterno: '<seedSpare>' }, expect: { ok: true }, mutating: true },
    'any',
    'page',
    { response: { ok: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'codigoInterno is invalid' } }, statusCode: 400 },
    1,
    ['codigoInterno'],
  );
  assert.equal(result.status, 'inconclusive');
  assert.match(result.reason, /codigoInterno/);
  assert.match(result.reason, /seed marker/);
});

test('countItems falls back to 1 for a non-collection payload', () => {
  assert.equal(countItems({ menuItemId: 'a' }, 'menuItems'), 1);
  assert.equal(countItems(null, 'menuItems'), 0);
});

// The page's l4 actor drives the session the run executes as (a field worker must see THEIR tasks).
// Optional by design: files generated before actor-scoped runs must keep loading.
test('the page actor survives coercion; absent/blank/non-string is undefined', () => {
  const withActor = coercePageTestsFile({ moduleName: 'm', page: 'p', actor: ' fieldWorker ', cases: [{ id: 'a.ok', routine: 'r.a', expect: { ok: true } }] });
  assert.ok(withActor);
  assert.equal(withActor.actor, 'fieldWorker');
  for (const actor of [undefined, '   ', 42, null]) {
    const file = coercePageTestsFile({ moduleName: 'm', page: 'p', actor, cases: [{ id: 'a.ok', routine: 'r.a', expect: { ok: true } }] });
    assert.ok(file, `still loads with actor=${JSON.stringify(actor)}`);
    assert.equal(file.actor, undefined);
  }
});

test('itemsKey is a path: a nested page is read and counted', () => {
  const data = { consultas: { items: [{ id: 'a' }, { id: 'b' }], page: 1, pageSize: 20, hasMore: false } };
  assert.equal(checkShape(data, 'paginated', 'consultas.items'), '');
  assert.equal(countItems(data, 'consultas.items'), 2);
  assert.deepEqual(itemsAt({ items: [1] }), [1]);
  assert.match(checkShape({ consultas: {} }, 'paginated', 'consultas.items'), /expected paginated/);
});

test('an expected business error with an unresolved seed marker is inconclusive, not a fail', () => {
  const conflictCase = { id: 'abrirComanda.conflict', routine: 'm.p.abrirComanda', params: { mesaId: '<seedRef>' }, expect: { ok: false, errorCode: 'CONFLICT' }, mutating: true };
  const missing = evaluate(conflictCase as never, 'm', 'p',
    { response: { ok: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'mesaId is required.' } }, statusCode: 400 }, 1, ['mesaId']);
  assert.equal(missing.status, 'inconclusive');
  assert.match(missing.reason, /seed marker not resolved for mesaId/);
  const resolvedWrong = evaluate(conflictCase as never, 'm', 'p',
    { response: { ok: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'x' } }, statusCode: 400 }, 1, []);
  assert.equal(resolvedWrong.status, 'fail');
});
