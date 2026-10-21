/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.integration.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

import type { ProjectOnboardingConfig, ProjectsConfig } from '/_102029_/l2/runtimeConfigTypes.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import {
  readOnboardingConfig,
  resolveOrganizationBinding,
  type OrganizationBinding,
} from '/_102034_/l1/server/layer_1_external/config/onboardingConfig.js';
import {
  resetProjectsConfigCache,
  resolveProjectModuleImportUrl,
} from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { getSharedPgPool, queryRows } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import {
  loadResolvedTableDefinitions,
  resetResolvedTableDefinitionsCache,
} from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createPostgresDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/postgres/MdmDataRuntimePostgres.js';
import type { MdmDocumentRecord, MdmEntityIndexRecord, MdmKvRecord } from '/_102034_/l1/mdm/module.js';
import { getMdmTableNames } from '/_102034_/l1/mdm/tableNames.js';
import {
  ensureOrganizationCompany,
  ensureOrganizationIdentity,
  organizationReservationKey,
  setOrganizationBootstrapFault,
} from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';
import { registrationLockKey } from '/_102034_/l1/mdm/layer_3_usecases/registrationStore.js';

const optedIn = process.env.RUN_INTEGRATION_TESTS === 'true';
const companyType = 'inicio.Organizacao';

test(
  'postgres bench: one organization company across two waiting connections',
  { skip: !optedIn, timeout: 40000 },
  async () => {
    const testUrl = process.env.DATABASE_URL_TEST;
    if (!testUrl) {
      throw new Error(
        'DATABASE_URL_TEST is not set. RUN_INTEGRATION_TESTS requires the bench Postgres URL and never falls back to DATABASE_URL.',
      );
    }
    if (process.env.DATABASE_URL && process.env.DATABASE_URL === testUrl) {
      throw new Error('DATABASE_URL_TEST must not be the same URL as DATABASE_URL');
    }
    const expectedDatabase = decodeURIComponent(new URL(testUrl).pathname.replace(/^\//u, ''));
    if (!expectedDatabase) {
      throw new Error('DATABASE_URL_TEST has no database name');
    }

    const previousCwd = process.cwd();
    const envKeys = [
      'APP_ENV',
      'RUNTIME_MODE',
      'RUNTIME_MODE_DEVELOPMENT',
      'PROJECT_ID',
      'COLLAB_PROJECT_ID',
    ] as const;
    const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
    const workspace = mkdtempSync(join(tmpdir(), 'rt81-s4r3-'));
    const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
    const persistenceSource = join(repoRoot, 'l1', 'mdm', 'persistence.ts');
    let pool: Pool | undefined;
    const orgKey = `rt81-s4r3:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const extraReservationKeys: string[] = [];
    const binding: OrganizationBinding = { key: orgKey, name: 'Org Bench', source: 'development-project' };
    const onboarding: ProjectOnboardingConfig = {
      moduleId: 'inicio',
      entryPath: '/tmp/inicio',
      personType: 'inicio.Pessoa',
      companyType,
    };

    process.env.APP_ENV = 'development';
    process.env.RUNTIME_MODE = 'postgres';
    process.env.RUNTIME_MODE_DEVELOPMENT = 'postgres';
    delete process.env.PROJECT_ID;
    delete process.env.COLLAB_PROJECT_ID;

    symlinkSync(repoRoot, join(workspace, 'mls-102034'));
    assert.equal(existsSync(join(workspace, 'mls-102034', 'l1', 'mdm', 'persistence.ts')), true);
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
          persistenceModules: [{
            moduleId: 'mdm',
            persistenceEntrypoint: '/_102034_/l1/mdm/persistence.js',
          }],
        },
      },
    }));
    process.chdir(workspace);
    resetProjectsConfigCache();
    resetResolvedTableDefinitionsCache();

    let releaseBlocker: (() => void) | undefined;
    const operations: Array<Promise<unknown>> = [];

    try {
      const env = readAppEnv();
      assert.equal(env.appEnv, 'development');
      assert.equal(env.runtimeMode, 'postgres');
      const resolved = fileURLToPath(resolveProjectModuleImportUrl('/_102034_/l1/mdm/persistence.js'));
      assert.equal(realpathSync(resolved), realpathSync(persistenceSource));
      assert.equal(resolved.endsWith('/l1/mdm/persistence.ts'), true);

      const tables = getMdmTableNames(env.appEnv);
      const expectedName: Record<string, string> = {
        mdmKv: tables.kv,
        mdmDocumentCache: tables.documents,
        mdmEntityIndex: tables.documentsEntitiesIndex,
      };
      const definitions = await loadResolvedTableDefinitions(env);
      for (const repositoryName of Object.keys(expectedName)) {
        const definition = definitions.find((item) => item.repositoryName === repositoryName);
        assert.ok(definition, repositoryName);
        assert.equal(definition.projectId, '102034');
        assert.equal(definition.tableName, expectedName[repositoryName]);
      }

      pool = getSharedPgPool(env);
      const databaseRows = await queryRows<{ name: string }>(pool, 'SELECT current_database() AS name');
      assert.equal(databaseRows[0]?.name, expectedDatabase);
      for (const tableName of [tables.kv, tables.documents, tables.documentsEntitiesIndex]) {
        const present = await queryRows<{ present: boolean }>(
          pool,
          'SELECT to_regclass($1) IS NOT NULL AS present',
          [tableName],
        );
        if (!present[0]?.present) {
          throw new Error(`bench table missing: ${tableName}`);
        }
      }

      const lockKey = registrationLockKey([binding.key]);
      const blockerRuntime = createPostgresDataRuntime(env);
      let unblock: () => void = () => {};
      const blocked = new Promise<void>((resolve) => {
        unblock = resolve;
      });
      releaseBlocker = unblock;
      const holding = new Promise<void>((resolve, reject) => {
        const hold = blockerRuntime.runInTransaction(async () => {
          resolve();
          await blocked;
        }, { lockKey });
        operations.push(hold);
        hold.catch(reject);
      });
      await holding;

      const firstRuntime = createPostgresDataRuntime(env);
      const secondRuntime = createPostgresDataRuntime(env);
      const first = ensureOrganizationCompany(createRequestContext(firstRuntime), binding, onboarding);
      const second = ensureOrganizationCompany(createRequestContext(secondRuntime), binding, onboarding);
      operations.push(first, second);

      const started = Date.now();
      let waiterPids: number[] = [];
      for (;;) {
        waiterPids = await advisoryWaiterPids(pool, lockKey);
        if (new Set(waiterPids).size >= 2) break;
        if (Date.now() - started > 8000) {
          throw new Error(`timed out waiting for two advisory lock waiters (saw ${waiterPids.length})`);
        }
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      assert.equal(new Set(waiterPids).size, 2);

      unblock();
      releaseBlocker = undefined;
      const [created, repeated] = await Promise.all([first, second]);
      assert.equal(created.companyMdmId, repeated.companyMdmId);
      const companyMdmId = created.companyMdmId;

      const reservationKey = organizationReservationKey(orgKey);
      const storedCount = await countWhere(pool, tables.kv, '"key" = $1', [reservationKey]);
      assert.equal(storedCount, 1);
      const documentCount = await countWhere(pool, tables.documents, '"mdmId" = $1', [companyMdmId]);
      assert.equal(documentCount, 1);
      const indexCount = await countWhere(pool, tables.documentsEntitiesIndex, '"mdmId" = $1', [companyMdmId]);
      assert.equal(indexCount, 1);

      const reader = createPostgresDataRuntime(env);
      const kv = await reader.moduleData.getTable<MdmKvRecord>('mdmKv');
      const documents = await reader.moduleData.getTable<MdmDocumentRecord>('mdmDocumentCache');
      const index = await reader.moduleData.getTable<MdmEntityIndexRecord>('mdmEntityIndex');
      const reservation = await kv.findOne({ where: { key: reservationKey } });
      assert.equal(reservation?.value && (reservation.value as { companyMdmId?: string }).companyMdmId, companyMdmId);
      const document = await documents.findOne({ where: { mdmId: companyMdmId } });
      assert.ok(document);
      const tags = Array.isArray(document.details.tags) ? document.details.tags : [];
      assert.equal(tags.filter((tag) => tag === companyType).length, 1);
      const indexed = await index.findOne({ where: { mdmId: companyMdmId } });
      assert.equal(indexed?.subtype, 'Company');
      assert.equal((indexed?.tags ?? []).filter((tag) => tag === companyType).length, 1);
      const version = document.version;

      const third = createPostgresDataRuntime(env);
      const again = await ensureOrganizationCompany(createRequestContext(third), binding, onboarding);
      assert.equal(again.companyMdmId, companyMdmId);
      const reread = await documents.findOne({ where: { mdmId: companyMdmId } });
      assert.equal(reread?.version, version);
      assert.equal(await countWhere(pool, tables.kv, '"key" = $1', [reservationKey]), 1);

      const stamp = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
      const identityOrgId = `rt119${stamp}`;
      const otherOrgId = `rt119b${stamp}`;
      const rolledOrgId = `rt119c${stamp}`;
      const identityProjects = {
        defaultProjectId: '102081',
        organization: { source: 'project-file' as const },
        projects: {
          '102081': { root: './client', type: 'client' as const },
        },
      } as unknown as ProjectsConfig;
      assert.equal(readOnboardingConfig(identityProjects), null);
      const identityBinding = resolveOrganizationBinding(identityProjects, {
        readProjectFile: () => simulatedProjectFile(identityOrgId, 'Org Identity'),
      });
      const otherBinding = resolveOrganizationBinding(identityProjects, {
        readProjectFile: () => simulatedProjectFile(otherOrgId, 'Org Other'),
      });
      const rolledBinding = resolveOrganizationBinding(identityProjects, {
        readProjectFile: () => simulatedProjectFile(rolledOrgId, 'Org Rolled'),
      });
      assert.ok(identityBinding);
      assert.ok(otherBinding);
      assert.ok(rolledBinding);
      assert.equal(identityBinding.source, 'project-file');
      assert.equal(identityBinding.key, `org:${identityOrgId}`);
      assert.notEqual(identityBinding.key, otherBinding.key);
      extraReservationKeys.push(
        organizationReservationKey(identityBinding.key),
        organizationReservationKey(otherBinding.key),
        organizationReservationKey(rolledBinding.key),
      );

      const identityLock = registrationLockKey([identityBinding.key]);
      const identityBlocker = createPostgresDataRuntime(env);
      let releaseIdentity: () => void = () => {};
      const identityBlocked = new Promise<void>((resolve) => {
        releaseIdentity = resolve;
      });
      const identityHolding = new Promise<void>((resolve, reject) => {
        const hold = identityBlocker.runInTransaction(async () => {
          resolve();
          await identityBlocked;
        }, { lockKey: identityLock });
        operations.push(hold);
        hold.catch(reject);
      });
      await identityHolding;

      const identityFirst = ensureOrganizationIdentity(createRequestContext(createPostgresDataRuntime(env)), identityBinding);
      const identitySecond = ensureOrganizationIdentity(createRequestContext(createPostgresDataRuntime(env)), identityBinding);
      operations.push(identityFirst, identitySecond);
      const identityWaitStarted = Date.now();
      let identityWaiters: number[] = [];
      for (;;) {
        identityWaiters = await advisoryWaiterPids(pool, identityLock);
        if (new Set(identityWaiters).size >= 2) break;
        if (Date.now() - identityWaitStarted > 8000) {
          throw new Error(`timed out waiting for two identity advisory lock waiters (saw ${identityWaiters.length})`);
        }
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      assert.equal(new Set(identityWaiters).size, 2);
      releaseIdentity();
      const [identityCreated, identityRepeated] = await Promise.all([identityFirst, identitySecond]);
      assert.equal(identityCreated.companyMdmId, identityRepeated.companyMdmId);

      const otherCompany = await ensureOrganizationIdentity(
        createRequestContext(createPostgresDataRuntime(env)),
        otherBinding,
      );
      assert.notEqual(otherCompany.companyMdmId, identityCreated.companyMdmId);

      const identityKey = organizationReservationKey(identityBinding.key);
      assert.equal(await countWhere(pool, tables.kv, '"key" = $1', [identityKey]), 1);
      const identityDocument = await documents.findOne({ where: { mdmId: identityCreated.companyMdmId } });
      assert.ok(identityDocument);
      const identityTags = Array.isArray(identityDocument.details.tags) ? identityDocument.details.tags : [];
      assert.equal(identityTags.includes(companyType), false);
      const identityIndexed = await index.findOne({ where: { mdmId: identityCreated.companyMdmId } });
      assert.equal(identityIndexed?.subtype, 'Company');

      const editor = createRequestContext(createPostgresDataRuntime(env));
      const beforeEdit = await editor.mdm.entity.get({ mdmId: identityCreated.companyMdmId });
      const edited = await editor.mdm.entity.update({
        mdmId: identityCreated.companyMdmId,
        expectedVersion: beforeEdit.version,
        patch: { name: 'Org Identity Legal', legalName: 'Org Identity LTDA' },
      });
      const restarted = await ensureOrganizationIdentity(
        createRequestContext(createPostgresDataRuntime(env)),
        identityBinding,
      );
      assert.equal(restarted.companyMdmId, identityCreated.companyMdmId);
      const afterRetry = await editor.mdm.entity.get({ mdmId: identityCreated.companyMdmId });
      assert.equal(afterRetry.version, edited.version);
      assert.equal(afterRetry.details.subtype, 'Company');
      if (afterRetry.details.subtype === 'Company') {
        assert.equal(afterRetry.details.name, 'Org Identity Legal');
        assert.equal(afterRetry.details.legalName, 'Org Identity LTDA');
      }

      setOrganizationBootstrapFault('before-return');
      await assert.rejects(
        () => ensureOrganizationIdentity(createRequestContext(createPostgresDataRuntime(env)), identityBinding),
        /organization bootstrap fault: before-return/u,
      );
      setOrganizationBootstrapFault(null);
      const preserved = await kv.findOne({ where: { key: identityKey } });
      assert.equal(preserved?.value && (preserved.value as { schema?: number }).schema, 1);
      assert.equal(
        preserved?.value && (preserved.value as { companyMdmId?: string }).companyMdmId,
        identityCreated.companyMdmId,
      );
      const resumed = await ensureOrganizationIdentity(
        createRequestContext(createPostgresDataRuntime(env)),
        identityBinding,
      );
      assert.equal(resumed.companyMdmId, identityCreated.companyMdmId);
      const afterResume = await documents.findOne({ where: { mdmId: identityCreated.companyMdmId } });
      assert.equal(afterResume?.version, edited.version);

      const rolledKey = organizationReservationKey(rolledBinding.key);
      setOrganizationBootstrapFault('after-reserve');
      await assert.rejects(
        () => ensureOrganizationIdentity(createRequestContext(createPostgresDataRuntime(env)), rolledBinding),
        /organization bootstrap fault: after-reserve/u,
      );
      setOrganizationBootstrapFault(null);
      assert.equal(await countWhere(pool, tables.kv, '"key" = $1', [rolledKey]), 0);
      const afterRollback = await ensureOrganizationIdentity(
        createRequestContext(createPostgresDataRuntime(env)),
        rolledBinding,
      );
      assert.equal(await countWhere(pool, tables.kv, '"key" = $1', [rolledKey]), 1);
      assert.notEqual(afterRollback.companyMdmId, identityCreated.companyMdmId);
      const rolledDocument = await documents.findOne({ where: { mdmId: afterRollback.companyMdmId } });
      assert.equal(rolledDocument?.version, 1);
    } finally {
      setOrganizationBootstrapFault(null);
      releaseBlocker?.();
      await Promise.allSettled(operations);
      if (pool) {
        await cleanupBench(pool, organizationReservationKey(orgKey));
        for (const key of extraReservationKeys) await cleanupBench(pool, key);
        await pool.end();
      }
      process.chdir(previousCwd);
      for (const key of envKeys) {
        const value = previousEnv.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      resetProjectsConfigCache();
      resetResolvedTableDefinitionsCache();
      rmSync(workspace, { recursive: true, force: true });
    }
  },
);

async function advisoryWaiterPids(pool: Pool, lockKey: string): Promise<number[]> {
  const rows = await queryRows<{ pid: number }>(
    pool,
    `SELECT pid
     FROM pg_locks
     WHERE locktype = 'advisory'
       AND NOT granted
       AND classid = ((hashtextextended($1, 0) >> 32) & 4294967295)::oid
       AND objid = (hashtextextended($1, 0) & 4294967295)::oid
       AND objsubid = 1`,
    [lockKey],
  );
  return rows.map((row) => row.pid);
}

async function countWhere(pool: Pool, tableName: string, whereSql: string, params: unknown[]): Promise<number> {
  const rows = await queryRows<{ count: number }>(
    pool,
    `SELECT COUNT(*)::int AS count FROM ${quoteIdent(tableName)} WHERE ${whereSql}`,
    params,
  );
  return rows[0]?.count ?? 0;
}

function simulatedProjectFile(orgId: string, name: string) {
  return {
    schema: 1,
    generatedAt: '2026-10-21T00:00:00.000Z',
    org: { orgId, slug: 'bench', name, createdAt: '2026-10-21T00:00:00.000Z' },
    project: {
      projectId: '102081',
      domain: 'bench.local',
      appEnv: 'development',
      language: null,
      type: 'client',
      createdAt: '2026-10-21T00:00:00.000Z',
    },
  };
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function cleanupBench(pool: Pool, reservationKey: string): Promise<void> {
  const tables = getMdmTableNames('development');
  const stored = await queryRows<{ value: { companyMdmId?: string } }>(
    pool,
    `SELECT value FROM ${quoteIdent(tables.kv)} WHERE "key" = $1`,
    [reservationKey],
  );
  const companyMdmId = stored[0]?.value?.companyMdmId;
  await pool.query(`DELETE FROM ${quoteIdent(tables.kv)} WHERE "key" = $1`, [reservationKey]);
  if (!companyMdmId) return;
  await pool.query(`DELETE FROM ${quoteIdent(tables.documents)} WHERE "mdmId" = $1`, [companyMdmId]);
  await pool.query(`DELETE FROM ${quoteIdent(tables.documentsEntitiesIndex)} WHERE "mdmId" = $1`, [companyMdmId]);
  await pool.query(
    `DELETE FROM ${quoteIdent(tables.relationship)} WHERE "fromId" = $1 OR "toId" = $1`,
    [companyMdmId],
  );
}
