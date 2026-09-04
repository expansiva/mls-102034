/// <mls fileReference="_102034_/l1/server/layer_1_external/data/moduleDataRuntime.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFindManyWindow,
  buildCountSql,
  buildFindManySql,
  createMemoryTableRepository,
  DEFAULT_PAGE_SIZE,
  type IFindManyInput,
  MAX_PAGE_SIZE,
  resolveListPage,
} from '/_102034_/l1/server/layer_1_external/data/moduleDataRuntime.js';

type Row = { id: string; name: string; status: string };

const ROWS: Row[] = [
  { id: '1', name: 'alpha', status: 'open' },
  { id: '2', name: 'beta', status: 'open' },
  { id: '3', name: 'gamma', status: 'done' },
  { id: '4', name: 'delta', status: 'open' },
  { id: '5', name: 'epsilon', status: 'open' },
];

test('resolveListPage defaults to page 1 / size 20 and caps at 200, declaring the cut', () => {
  assert.deepEqual(resolveListPage(), { page: 1, pageSize: DEFAULT_PAGE_SIZE, limit: DEFAULT_PAGE_SIZE, offset: 0 });
  assert.deepEqual(resolveListPage({}), { page: 1, pageSize: DEFAULT_PAGE_SIZE, limit: DEFAULT_PAGE_SIZE, offset: 0 });
  assert.deepEqual(resolveListPage({ page: 0, pageSize: 0 }), { page: 1, pageSize: DEFAULT_PAGE_SIZE, limit: DEFAULT_PAGE_SIZE, offset: 0 });
  assert.deepEqual(resolveListPage({ page: 2, pageSize: 20 }), { page: 2, pageSize: 20, limit: 20, offset: 20 });
  assert.deepEqual(resolveListPage({ page: 1, pageSize: 200 }), { page: 1, pageSize: 200, limit: 200, offset: 0 });
  const cut = resolveListPage({ page: 1, pageSize: 500 });
  assert.equal(cut.pageSize, MAX_PAGE_SIZE);
  assert.equal(cut.limit, MAX_PAGE_SIZE);
  assert.equal(cut.pageSize, 200);
});

test('findMany without limit/offset returns every matching row (byte-identical to the unpaged path)', async () => {
  const repo = createMemoryTableRepository(ROWS);
  const all = await repo.findMany();
  assert.deepEqual(all.map((row) => row.id), ['1', '2', '3', '4', '5']);
  const filtered = await repo.findMany({ where: { status: 'open' } });
  assert.deepEqual(filtered.map((row) => row.id), ['1', '2', '4', '5']);
});

test('memory and postgres agree: offset windows the page, count is the filter total', async () => {
  const repo = createMemoryTableRepository(ROWS);
  const filter: IFindManyInput<Row> = { where: { status: 'open' }, ilike: { name: 'ta' }, orderBy: { field: 'id', direction: 'asc' } };
  // open + name contains 'ta': beta, delta (gamma is done). → 2, 4
  const total = await repo.count(filter);
  assert.equal(total, 2, 'total is matching rows, not the page length');
  const page = await repo.findMany({ ...filter, limit: 1, offset: 1 });
  assert.deepEqual(page.map((row) => row.id), ['4']);

  const findSql = buildFindManySql('task', { ...filter, limit: 1, offset: 1 });
  const countSql = buildCountSql('task', filter);
  assert.match(findSql.sql, /OFFSET 1/);
  assert.match(findSql.sql, /LIMIT 1/);
  assert.match(countSql.sql, /COUNT\(\*\)::int AS count/);
  assert.deepEqual(countSql.params, findSql.params, 'COUNT uses the same WHERE params as SELECT');
  assert.equal(countSql.sql.includes('OFFSET'), false);
  assert.equal(countSql.sql.includes('LIMIT'), false);
});

test('applyFindManyWindow: limit without offset is the old slice; offset without limit skips then returns the rest', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(applyFindManyWindow(ids, { limit: 2 }), ['a', 'b']);
  assert.deepEqual(applyFindManyWindow(ids, { offset: 2 }), ['c', 'd']);
  assert.deepEqual(applyFindManyWindow(ids, { limit: 2, offset: 1 }), ['b', 'c']);
  assert.deepEqual(applyFindManyWindow(ids), ids);
});
