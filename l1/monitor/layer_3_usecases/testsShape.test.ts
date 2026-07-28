/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/testsShape.test.ts" enhancement="_blank" />
// The `paginated` drift guard of the monitor Tests runner. A paginated envelope names its
// collection after the entity on this wire (`{ menuItems: [...] }`), so the generated case declares
// the key in `expect.itemsKey`; files generated before the key existed omit it and must keep
// falling back to `items`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkShape, coercePageTestsFile, countItems } from '/_102034_/l1/monitor/layer_3_usecases/testsUsecases.js';

const menuEnvelope = { menuItems: [{ menuItemId: 'a' }, { menuItemId: 'b' }], total: 2 };

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
test('countItems falls back to 1 for a non-collection payload', () => {
  assert.equal(countItems({ menuItemId: 'a' }, 'menuItems'), 1);
  assert.equal(countItems(null, 'menuItems'), 0);
});
