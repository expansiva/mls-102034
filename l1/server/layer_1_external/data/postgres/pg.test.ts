/// <mls fileReference="_102034_/l1/server/layer_1_external/data/postgres/pg.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { createPostgresModuleDataRuntime } from '/_102034_/l1/server/layer_1_external/data/moduleDataRuntime.js';
import { createPostgresDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/postgres/MdmDataRuntimePostgres.js';
import { getMdmPgPool, getSharedPgPool } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';

const MDM_URL = 'postgres://mdm-pool/app';

const env = {
  appEnv: 'development',
  runtimeMode: 'postgres',
  pgHost: '127.0.0.1',
  pgPort: 1,
  pgDatabase: 'unused',
  pgUser: 'unused',
  pgPassword: 'unused',
} as AppEnv;

test('getMdmPgPool follows MDM_DATABASE_URL and otherwise is the shared pool', async () => {
  const previous = process.env.MDM_DATABASE_URL;
  delete process.env.MDM_DATABASE_URL;
  try {
    const shared = getSharedPgPool(env);
    assert.equal(getMdmPgPool(env), shared);

    const absentHits: string[] = [];
    const originalSharedQuery = shared.query.bind(shared);
    const originalSharedConnect = shared.connect.bind(shared);
    shared.query = (async () => {
      absentHits.push('query');
      return { rows: [] };
    }) as unknown as Pool['query'];
    shared.connect = (async () => {
      absentHits.push('connect');
      return { query: async () => ({ rows: [] }), release() {} };
    }) as unknown as Pool['connect'];
    try {
      await createPostgresDataRuntime(env, getMdmPgPool(env)).mdmTag.findMany();
      await createPostgresModuleDataRuntime(env).runInTransaction(async () => undefined);
      assert.deepEqual(absentHits, ['query', 'connect']);
    } finally {
      shared.query = originalSharedQuery;
      shared.connect = originalSharedConnect;
    }

    process.env.MDM_DATABASE_URL = MDM_URL;
    const mdm = getMdmPgPool(env);
    assert.notEqual(mdm, shared);
    assert.equal(mdm, getMdmPgPool(env));
    assert.equal((mdm as Pool).options.connectionString, MDM_URL);
    assert.notEqual((shared as Pool).options.connectionString, MDM_URL);

    const hits: string[] = [];
    const originalQuery = mdm.query.bind(mdm);
    const originalConnect = shared.connect.bind(shared);
    mdm.query = (async () => {
      hits.push('mdm');
      return { rows: [] };
    }) as unknown as Pool['query'];
    shared.connect = (async () => {
      hits.push('shared');
      return { query: async () => ({ rows: [] }), release() {} };
    }) as unknown as Pool['connect'];
    try {
      const mdmRuntime = createPostgresDataRuntime(env, mdm);
      await mdmRuntime.mdmTag.findMany();
      const moduleRuntime = createPostgresModuleDataRuntime(env);
      await moduleRuntime.runInTransaction(async () => undefined);
      assert.deepEqual(hits, ['mdm', 'shared']);
    } finally {
      mdm.query = originalQuery;
      shared.connect = originalConnect;
    }
  } finally {
    if (previous === undefined) delete process.env.MDM_DATABASE_URL;
    else process.env.MDM_DATABASE_URL = previous;
  }
});
