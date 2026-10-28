/// <mls fileReference="_102034_/l1/mdm/layer_1_external/data/runtimeFactory.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { getMdmPgPool, getSharedPgPool } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import { getSharedDataRuntime, resetSharedDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/runtimeFactory.js';

const MDM_URL = 'postgres://mdm-pool/app';

test('postgres shared runtime uses the MDM pool when MDM_DATABASE_URL is set', async () => {
  const previousUrl = process.env.MDM_DATABASE_URL;
  const previousMode = process.env.RUNTIME_MODE;
  process.env.MDM_DATABASE_URL = MDM_URL;
  process.env.RUNTIME_MODE = 'postgres';
  resetSharedDataRuntime();

  const seen: Pool[] = [];
  const original = Pool.prototype.query;
  Pool.prototype.query = function query(this: Pool) {
    seen.push(this);
    return Promise.resolve({ rows: [], command: '', rowCount: 0, oid: 0, fields: [] });
  } as unknown as typeof Pool.prototype.query;

  try {
    const env = readAppEnv();
    const mdm = getMdmPgPool(env);
    const shared = getSharedPgPool(env);
    assert.notEqual(mdm, shared);

    const runtime = getSharedDataRuntime();
    assert.equal(runtime.mode, 'postgres');
    await runtime.mdmTag.findMany();
    assert.equal(seen.at(-1), mdm);
  } finally {
    Pool.prototype.query = original;
    resetSharedDataRuntime();
    if (previousUrl === undefined) delete process.env.MDM_DATABASE_URL;
    else process.env.MDM_DATABASE_URL = previousUrl;
    if (previousMode === undefined) delete process.env.RUNTIME_MODE;
    else process.env.RUNTIME_MODE = previousMode;
  }
});
