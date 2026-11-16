/// <mls fileReference="_102034_/l1/workflow/assistantContractSource.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test from 'node:test';
import { flattenType, parseContractSource } from '/_102034_/l1/workflow/assistantContractSource.js';

const SOURCE = `
/** A row. */
export interface Row { id: string; readonly tags?: string[]; nested: { deep: 'a' | 'b'; flag: boolean } }
export type Mode = 'fast' | 'slow';
export interface PageContracts {
  /** Purpose: something. */
  'mod.page.cmdGo': {
    kind: 'cmd';
    writes: 'Row.go';
    input: { id: string; mode?: Mode; rows: Row[]; pair: [string, number] };
    output: { ok: boolean };
    rules: ['a', 'b'];
  };
  'mod.page.qryList': { kind: 'qry'; input: { page: number }; output: { items: Row[] } };
}
`;

test('the contract source gives its routes, with kind, writes, input and output types', () => {
  const parsed = parseContractSource(SOURCE);
  assert.deepEqual(parsed.routes.map((route) => [route.route, route.kind, route.writes]), [['mod.page.cmdGo', 'cmd', 'Row.go'], ['mod.page.qryList', 'qry', '']]);
  assert.equal(parsed.routes[0].output?.kind, 'object');
  assert.deepEqual(parsed.types.Mode, { kind: 'literal', values: ['fast', 'slow'] });
});

test('flattening the input resolves named types, keeps optional and literals, and leaves arrays and tuples as non-scalar leaves', () => {
  const parsed = parseContractSource(SOURCE);
  const leaves = flattenType(parsed.routes[0].input, parsed.types).map((leaf) => `${leaf.path}|${leaf.required}|${leaf.type.kind}`);
  assert.deepEqual(leaves, ['id|true|primitive', 'mode|false|literal', 'rows|true|array', 'pair|true|tuple']);
  const nested = flattenType({ kind: 'ref', name: 'Row' }, parsed.types).map((leaf) => leaf.path);
  assert.deepEqual(nested, ['id', 'tags', 'nested.deep', 'nested.flag']);
});

test('a type the parser cannot read is left out and does not throw', () => {
  const parsed = parseContractSource("export interface Broken { a: ; }\nexport interface Fine { 'x.y.z': { kind: 'qry'; input: { q: string } } }");
  assert.deepEqual(parsed.routes.map((route) => route.route), ['x.y.z']);
});
