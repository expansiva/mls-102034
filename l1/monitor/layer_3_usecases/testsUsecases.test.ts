/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/testsUsecases.test.ts" enhancement="_blank" />
// rt38 — `fieldPathsOf` (dotted field paths, not just top-level keys) and the `observationFromExec`
// regression it fixes: a list response (`data` is an array, every qryList… routine) used to report
// `fields: []`, which is exactly the shape that discloses rows the gate was supposed to catch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldPathsOf, observationFromExec } from '/_102034_/l1/monitor/layer_3_usecases/testsUsecases.js';

test('fieldPathsOf: flat object -> its own keys', () => {
  assert.deepEqual(fieldPathsOf({ a1: 'x', a2: 'y' }), ['a1', 'a2']);
});

test('fieldPathsOf: nested object 3 levels deep -> container and leaf paths, both', () => {
  const data = { rows: { details: { note: 'n' } } };
  assert.deepEqual(fieldPathsOf(data), ['rows', 'rows.details', 'rows.details.note']);
});

test('fieldPathsOf: array of rows -> no index segment, no repeated paths across rows', () => {
  const data = [{ id: '1', dockAt: 't1' }, { id: '2', dockAt: 't2' }];
  assert.deepEqual(fieldPathsOf(data), ['dockAt', 'id']);
});

test('fieldPathsOf: array nested under a key -> prefixed, still no index segment', () => {
  const data = { rows: [{ dockAt: 't1' }, { dockAt: 't2' }] };
  assert.deepEqual(fieldPathsOf(data), ['rows', 'rows.dockAt']);
});

test('fieldPathsOf: null/primitive/undefined data -> []', () => {
  assert.deepEqual(fieldPathsOf(null), []);
  assert.deepEqual(fieldPathsOf('a string'), []);
  assert.deepEqual(fieldPathsOf(42), []);
  assert.deepEqual(fieldPathsOf(undefined), []);
});

test('fieldPathsOf: a primitive leaf value does not get descended into', () => {
  assert.deepEqual(fieldPathsOf({ a1: null, a2: 3 }), ['a1', 'a2']);
});

test('fieldPathsOf: depth beyond 6 is cut, not thrown', () => {
  // 8 levels: l1.l2.l3.l4.l5.l6.l7.l8
  let data: unknown = 'leaf';
  for (let i = 8; i >= 1; i--) data = { [`l${i}`]: data };
  const paths = fieldPathsOf(data);
  assert.ok(paths.includes('l1.l2.l3.l4.l5.l6'), 'depth 6 path present');
  assert.ok(!paths.some(p => p.includes('l7')), 'nothing past depth 6 is added');
});

test('fieldPathsOf: path count is capped at 500, no throw', () => {
  const data: Record<string, number> = {};
  for (let i = 0; i < 600; i++) data[`f${i}`] = i;
  const paths = fieldPathsOf(data);
  assert.equal(paths.length, 500);
});

test('observationFromExec: list response (array data) no longer reports fields: []', () => {
  const observation = observationFromExec(
    'qryListWidgets.ok',
    5,
    { response: { ok: true, data: [{ widgetId: 'w1' }, { widgetId: 'w2' }], error: null }, statusCode: 200 },
  );
  assert.deepEqual(observation.fields, ['widgetId']);
});
