/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/testsShape.test.ts" enhancement="_blank" />
// The `paginated` drift guard of the monitor Tests runner. A paginated envelope names its
// collection after the entity on this wire (`{ menuItems: [...] }`), so the generated case declares
// the key in `expect.itemsKey`; files generated before the key existed omit it and must keep
// falling back to `items`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkShape, coercePageTestsFile, countItems, reportAppEnv, PAGE11_VARIANT_POLICY, resolveParams, untestedPageEntries } from '/_102034_/l1/monitor/layer_3_usecases/testsUsecases.js';

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

test('<seedRef> resolves by fieldRef then fieldId, not only by the input name', () => {
  const pool = { taskId: 'row-1' };
  const hit = resolveParams({ taskTaskId: '<seedRef>' }, pool, { taskTaskId: 'Task.taskId' });
  assert.deepEqual(hit.params, { taskTaskId: 'row-1' });
  assert.deepEqual(hit.unresolved, []);
  const byName = resolveParams({ taskId: '<seedRef>' }, pool);
  assert.deepEqual(byName.params, { taskId: 'row-1' });
  const miss = resolveParams({ missingId: '<seedRef>' }, pool, { missingId: 'Task.missingId' });
  assert.deepEqual(miss.params, {});
  assert.deepEqual(miss.unresolved, ['missingId']);
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
