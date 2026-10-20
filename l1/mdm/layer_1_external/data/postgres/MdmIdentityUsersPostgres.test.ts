/// <mls fileReference="_102034_/l1/mdm/layer_1_external/data/postgres/MdmIdentityUsersPostgres.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, QueryResult } from 'pg';

import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { buildIdentityUsersPageSql } from '/_102034_/l1/mdm/layer_1_external/data/postgres/MdmIdentityUsersPostgres.js';
import { createPostgresDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/postgres/MdmDataRuntimePostgres.js';
import type { MdmUserDirectoryQuery } from '/_102034_/l1/mdm/layer_3_usecases/identityUsersContracts.js';

const env = { appEnv: 'development' } as AppEnv;

function query(overrides: Partial<MdmUserDirectoryQuery> = {}): MdmUserDirectoryQuery {
  return {
    foldedName: null,
    status: 'Active',
    roleTag: null,
    roleTagMode: null,
    afterMdmId: null,
    limit: 21,
    ...overrides,
  };
}

function emptyResult(): QueryResult {
  return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
}

test('page sql filters before the cursor and limit, and quotes only known tables', () => {
  const page = buildIdentityUsersPageSql('staging', query({
    foldedName: 'ana%',
    status: 'Inactive',
    roleTag: 'inicio',
    roleTagMode: 'without',
    afterMdmId: 'mdm-a',
    limit: 3,
  }));

  assert.match(page.sql, /FROM "mdm_documents_entities_index_test" idx/);
  assert.match(page.sql, /LEFT JOIN "mdm_documents_test" doc/);
  assert.match(page.sql, /FROM "mdm_tag_test" tag/);
  assert.match(page.sql, /idx\."subtype" = 'Person'/);
  assert.match(page.sql, /canon\."namespace" = 'login'/);
  assert.match(page.sql, /canon\."module" = 'organization'/);
  assert.match(page.sql, /array_agg\(tag\."tag"\)/);
  assert.doesNotMatch(page.sql, /LIMIT 1/);
  assert.match(page.sql, /position\(\$1 in lower\(regexp_replace\(normalize\(coalesce\(idx\."name", ''\), NFD\)/);
  assert.match(page.sql, /NOT \(\$3 = ANY\(COALESCE\(idx\."tags", '\{\}'::text\[\]\)\)\)/);
  assert.match(page.sql, /COLLATE "C" > \$4/);
  assert.match(page.sql, /ORDER BY idx\."mdmId" COLLATE "C" ASC/);
  assert.match(page.sql, /LIMIT \$5/);
  const whereTail = page.sql.slice(page.sql.indexOf('WHERE'));
  const afterAt = whereTail.indexOf('COLLATE "C" >');
  const limitAt = whereTail.indexOf('LIMIT');
  assert.ok(whereTail.indexOf('position($1') < afterAt);
  assert.ok(whereTail.indexOf('idx."status"') < afterAt);
  assert.ok(afterAt < limitAt);
  assert.deepEqual(page.params, ['ana%', 'Inactive', 'inicio', 'mdm-a', 3]);
  assert.doesNotMatch(page.sql, /unaccent|inicio|102056|projectId/i);
});

test('with-role and all-status omit the status predicate and keep the tag membership', () => {
  const page = buildIdentityUsersPageSql('development', query({
    status: 'all',
    roleTag: 'campo',
    roleTagMode: 'with',
  }));
  assert.match(page.sql, /\$1 = ANY\(COALESCE\(idx\."tags", '\{\}'::text\[\]\)\)/);
  assert.doesNotMatch(page.sql, /idx\."status" = \$/);
  assert.match(page.sql, /LIMIT \$2/);
  assert.deepEqual(page.params, ['campo', 21]);
  assert.match(page.sql, /"mdm_documents_entities_index" idx/);
  assert.doesNotMatch(page.sql, /_test/);
});

test('the supplied pool is the reader executor, including inside runInTransaction', async () => {
  const seen: Array<{ executor: string; sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params?: unknown[]) {
      seen.push({ executor: 'client', sql: String(sql), params: params ?? [] });
      return emptyResult();
    },
    release() {},
  };
  const pool = {
    async query(sql: string, params?: unknown[]) {
      seen.push({ executor: 'pool', sql: String(sql), params: params ?? [] });
      return emptyResult();
    },
    async connect() {
      return client;
    },
  };

  const runtime = createPostgresDataRuntime(env, pool as unknown as Pool);
  assert.ok(runtime.mdmIdentityUsers);
  await runtime.mdmIdentityUsers.listPage(query());
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.executor, 'pool');
  assert.match(seen[0]?.sql ?? '', /FROM "mdm_documents_entities_index" idx/);
  assert.deepEqual(seen[0]?.params, ['Active', 21]);

  await runtime.runInTransaction(async (tx) => {
    assert.ok(tx.mdmIdentityUsers);
    await tx.mdmIdentityUsers.listPage(query({ status: 'Blocked', limit: 2 }));
  });
  const pageCall = seen.find((entry) => entry.executor === 'client' && entry.sql.includes('mdm_documents_entities_index'));
  assert.ok(pageCall);
  assert.deepEqual(pageCall?.params, ['Blocked', 2]);
  assert.ok(seen.some((entry) => entry.executor === 'client' && entry.sql === 'BEGIN'));
  assert.equal(seen.filter((entry) => entry.sql.includes('mdm_documents_entities_index') && entry.executor === 'pool').length, 1);
});
