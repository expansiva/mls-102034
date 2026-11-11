/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/core/DataRecordService.orphanIndex.integration.test.ts" enhancement="_blank" />
// rt206: the leftover of a Postgres crash (an index row whose document is gone) must not stop a create nor the boot.
// Real Postgres, ISOLATED schema (created and dropped here; nothing is written in `public` of collab_app_test).
//   RUN_INTEGRATION_TESTS=true MDM_ORPHAN_TEST_PG_URL=<local collab_app_test URL> \
//   TSX_TSCONFIG_PATH=test/tsconfig.runtime.json npx tsx --import ./test/register-hooks.mjs --import ./test/setup-l1.ts \
//   --test mls-102034/l1/mdm/layer_3_usecases/core/DataRecordService.orphanIndex.integration.test.ts   (cwd: mls-base)
// It does not provoke a crash: it TRUNCATEs the UNLOGGED documents table of ITS OWN schema, which is exactly what the
// crash recovery does to it.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { loadResolvedTableDefinitions, resetResolvedTableDefinitionsCache } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { buildCreateIndexSql, buildCreateTableSql } from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createPostgresDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/postgres/MdmDataRuntimePostgres.js';
import { DataRecordService } from '/_102034_/l1/mdm/layer_3_usecases/core/DataRecordService.js';
import { mdmEntityDef } from '/_102034_/l1/mdm/layer_3_usecases/core/mdmEntityDefs.js';
import { buildEntityIndex, normalizeDetailInput } from '/_102034_/l1/mdm/layer_3_usecases/mdmSupport.js';
import { ensureOrganizationIdentity } from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';
import { getMdmTableNames } from '/_102034_/l1/mdm/tableNames.js';
import type { OrganizationBinding } from '/_102034_/l1/server/layer_1_external/config/onboardingConfig.js';
import type { IDataRuntime } from '/_102034_/l1/server/layer_1_external/data/runtime.js';

const optedIn = process.env.RUN_INTEGRATION_TESTS === 'true';

function localTestUrl(): string {
  const raw = process.env.MDM_ORPHAN_TEST_PG_URL ?? '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('MDM_ORPHAN_TEST_PG_URL must be a local collab_app_test URL');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ''));
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || database !== 'collab_app_test') {
    throw new Error('MDM_ORPHAN_TEST_PG_URL must be a local collab_app_test URL');
  }
  return raw;
}

async function countIn(pool: Pool, table: string, mdmId: string): Promise<number> {
  const result = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${table}" WHERE "mdmId" = $1`, [mdmId]);
  return Number(result.rows[0]?.n ?? 0);
}

function captureWarnings(): { lines: string[]; restore: () => void } {
  const original = console.warn;
  const lines: string[] = [];
  console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  return { lines, restore: () => { console.warn = original; } };
}

test('opt-in without a local collab_app_test URL fails', () => {
  if (!optedIn) return;
  localTestUrl();
});

test('postgres: orphan index row is replaced; a real duplicate still fails; the organization bootstrap boots over the leftover', { skip: !optedIn, timeout: 60000 }, async () => {
  const schema = `rt206_${randomBytes(8).toString('hex')}`;
  const url = new URL(localTestUrl());
  url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new Pool({ connectionString: url.toString(), max: 4 });

  const previousCwd = process.cwd();
  const envKeys = ['APP_ENV', 'RUNTIME_MODE', 'RUNTIME_MODE_DEVELOPMENT', 'PROJECT_ID', 'COLLAB_PROJECT_ID'] as const;
  const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  const workspace = mkdtempSync(join(tmpdir(), 'rt206-'));
  const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  let schemaCreated = false;

  process.env.APP_ENV = 'development';
  process.env.RUNTIME_MODE = 'postgres';
  process.env.RUNTIME_MODE_DEVELOPMENT = 'postgres';
  delete process.env.PROJECT_ID;
  delete process.env.COLLAB_PROJECT_ID;

  // Same workspace shape as organizationBootstrap.integration.test.ts: the module tables (mdmKv) are resolved through it.
  symlinkSync(repoRoot, join(workspace, 'mls-102034'));
  mkdirSync(join(workspace, 'l5'), { recursive: true });
  writeFileSync(join(workspace, 'l5', 'project.json'), JSON.stringify({ appEnv: 'presentation' }));
  writeFileSync(join(workspace, 'config.json'), JSON.stringify({
    defaultProjectId: '102081',
    projects: {
      '102081': { root: './client', type: 'client' },
      '102029': { root: './fe', type: 'master frontend' },
      '102034': {
        root: './be',
        type: 'master backend',
        persistenceModules: [{ moduleId: 'mdm', persistenceEntrypoint: '/_102034_/l1/mdm/persistence.js' }],
      },
    },
  }));
  process.chdir(workspace);
  resetProjectsConfigCache();
  resetResolvedTableDefinitionsCache();

  try {
    assert.ok(realpathSync(join(workspace, 'mls-102034')));
    const env = readAppEnv();
    const names = getMdmTableNames(env.appEnv);

    // 1) the isolated schema, with the mdm tables exactly as the app defines them (documents is UNLOGGED).
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      schemaCreated = true;
      await client.query(`SET search_path TO ${schema}`);
      const definitions = (await loadResolvedTableDefinitions(env)).filter((definition) => definition.moduleId === 'mdm');
      assert.ok(definitions.some((definition) => definition.tableName === names.documents), 'documents table is defined');
      for (const definition of definitions) {
        await client.query(buildCreateTableSql(definition));
        for (const sql of buildCreateIndexSql(definition)) await client.query(sql);
      }
    } finally {
      client.release();
    }
    const persistence = await pool.query<{ p: string }>(
      `SELECT c.relpersistence::text AS p FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2`,
      [schema, names.documents],
    );
    assert.equal(persistence.rows[0]?.p, 'u', 'the documents table is UNLOGGED, as in the app');

    const runtime: IDataRuntime = createPostgresDataRuntime(env, pool);
    const ctx = createRequestContext(runtime);
    const meta = { module: 'mdm', routine: 'mdm.entity.create' };
    const newCompany = () => normalizeDetailInput({ subtype: 'Company', name: 'Org Rt206', status: 'Active' }, ctx, ctx.idGenerator.newId());

    // Scenario 1: the index has the row, the documents table is empty.
    const orphan = newCompany();
    await runtime.mdmEntityIndex.insert({ record: buildEntityIndex(orphan) });
    assert.equal(await countIn(pool, names.documents, orphan.mdmId), 0);
    const warnings = captureWarnings();
    try {
      const created = await DataRecordService.create(ctx, mdmEntityDef, { after: orphan, meta });
      assert.equal(created.version, 1);
    } finally {
      warnings.restore();
    }
    assert.equal(await countIn(pool, names.documents, orphan.mdmId), 1, 'scenario 1: document present');
    assert.equal(await countIn(pool, names.documentsEntitiesIndex, orphan.mdmId), 1, 'scenario 1: one index row');
    assert.equal(warnings.lines.filter((line) => line.includes(`[mdm] orphan index row replaced ${orphan.mdmId}`)).length, 1);

    // Scenario 2: document AND index present is a real duplicate: it fails with the primary key, nothing changes.
    const duplicateWarnings = captureWarnings();
    try {
      await assert.rejects(
        DataRecordService.create(ctx, mdmEntityDef, { after: orphan, meta }),
        (error: unknown) => (error as { code?: string }).code === '23505' || /duplicate key|index_pkey/u.test(String((error as Error).message)),
      );
    } finally {
      duplicateWarnings.restore();
    }
    assert.equal(duplicateWarnings.lines.some((line) => line.includes('orphan index row replaced')), false);
    assert.equal(await countIn(pool, names.documents, orphan.mdmId), 1, 'scenario 2: document unchanged');
    assert.equal(await countIn(pool, names.documentsEntitiesIndex, orphan.mdmId), 1, 'scenario 2: index unchanged');

    // Scenario 3: the organization bootstrap over the leftover of a crash (the loop of the lima).
    const binding: OrganizationBinding = { key: `rt206:${Date.now()}`, name: 'Org Boot Rt206', source: 'development-project' };
    const first = await ensureOrganizationIdentity(createRequestContext(createPostgresDataRuntime(env, pool)), binding);
    assert.equal(await countIn(pool, names.documents, first.companyMdmId), 1);
    await pool.query(`TRUNCATE "${names.documents}"`); // what the crash recovery does to an UNLOGGED table
    assert.equal(await countIn(pool, names.documents, first.companyMdmId), 0);
    assert.equal(await countIn(pool, names.documentsEntitiesIndex, first.companyMdmId), 1, 'the index kept the row');
    const again = await ensureOrganizationIdentity(createRequestContext(createPostgresDataRuntime(env, pool)), binding);
    assert.equal(again.companyMdmId, first.companyMdmId, 'scenario 3: same reserved id');
    assert.equal(await countIn(pool, names.documents, again.companyMdmId), 1, 'scenario 3: document back');
    assert.equal(await countIn(pool, names.documentsEntitiesIndex, again.companyMdmId), 1, 'scenario 3: one index row');
  } finally {
    process.chdir(previousCwd);
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetProjectsConfigCache();
    resetResolvedTableDefinitionsCache();
    try {
      if (schemaCreated) await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await pool.end();
      rmSync(workspace, { recursive: true, force: true });
    }
  }
});
