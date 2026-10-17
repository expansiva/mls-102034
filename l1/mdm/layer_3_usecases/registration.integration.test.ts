/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/registration.integration.test.ts" enhancement="_blank" />
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

import type { ProjectOnboardingConfig } from '/_102029_/l2/runtimeConfigTypes.js';
import { mdm } from '/_102034_/l4/ontology/mdm.defs.js';
import { identityCacheKey } from '/_102034_/l1/server/layer_1_external/cache/identityCache.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import type { OrganizationBinding } from '/_102034_/l1/server/layer_1_external/config/onboardingConfig.js';
import {
  resetProjectsConfigCache,
  resolveProjectModuleImportUrl,
} from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { getSharedPgPool, queryRows } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import {
  loadResolvedTableDefinitions,
  resetResolvedTableDefinitionsCache,
} from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createPostgresDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/postgres/MdmDataRuntimePostgres.js';
import { MDM_LOGIN_NAMESPACE } from '/_102034_/l1/mdm/layer_3_usecases/identityUsecases.js';
import { ensureOrganizationCompany, organizationReservationKey } from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';
import {
  listOrganizationAccessRequests,
  readOwnAccessRequest,
  resolveAccessRequest,
} from '/_102034_/l1/mdm/layer_3_usecases/registrationRequests.js';
import { REGISTRATION_STORE_PREFIX, registrationLockKey } from '/_102034_/l1/mdm/layer_3_usecases/registrationStore.js';
import {
  ensureSelfRegistration,
  personByLogin,
  requestIndexKey,
  requestRecordKey,
  setSelfRegistrationFault,
} from '/_102034_/l1/mdm/layer_3_usecases/selfRegistration.js';
import { getMdmTableNames } from '/_102034_/l1/mdm/tableNames.js';

const optedIn = process.env.RUN_INTEGRATION_TESTS === 'true';

test('platform catalog states session registration without an invite', () => {
  const inviteAt = Object.keys(mdm.capabilities).indexOf('invite.login');
  assert.deepEqual(Object.keys(mdm.capabilities).slice(inviteAt, inviteAt + 4), [
    'invite.login',
    'register.self',
    'accessRequest.read',
    'accessRequest.resolve',
  ]);
  assert.match(mdm.capabilities['register.self'], /session/);
  assert.match(mdm.capabilities['register.self'], /invite/);
  assert.match(mdm.capabilities['accessRequest.read'], /alpha/);
  assert.match(mdm.capabilities['accessRequest.resolve'], /requestId/);
  assert.match(mdm.capabilities['accessRequest.resolve'], /alpha/);
  assert.match(mdm.knownDivergences['registration-draft'], /registrationDraft/);
  assert.match(mdm.knownDivergences['registration-draft'], /normal create/);
  assert.equal('registrationDraft' in mdm.groups.identification.fields, false);
  assert.equal('registrationDraft' in mdm.groups['<moduleId>'], false);
});

test(
  'postgres bench: one login across connections, orgs, rollback, restart and decisions',
  { skip: !optedIn, timeout: 90000 },
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
    const workspace = mkdtempSync(join(tmpdir(), 'rt82-s5-'));
    const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
    const persistenceSource = join(repoRoot, 'l1', 'mdm', 'persistence.ts');
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const orgA = `rt82-s5:${stamp}:a`;
    const orgB = `rt82-s5:${stamp}:b`;
    const bindingA: OrganizationBinding = { key: orgA, name: 'Org A', source: 'development-project' };
    const bindingB: OrganizationBinding = { key: orgB, name: 'Org B', source: 'development-project' };
    const configA: ProjectOnboardingConfig = {
      moduleId: 'inicio-a',
      entryPath: '/tmp/inicio-a',
      personType: 'inicio-a.Pessoa',
      companyType: 'inicio-a.Organizacao',
    };
    const configB: ProjectOnboardingConfig = {
      moduleId: 'inicio-b',
      entryPath: '/tmp/inicio-b',
      personType: 'inicio-b.Pessoa',
      companyType: 'inicio-b.Organizacao',
    };
    const joinEmail = `rt82-s5-${stamp}-join@bench.test`;
    const rollbackEmail = `rt82-s5-${stamp}-rollback@bench.test`;
    const pendingEmail = `rt82-s5-${stamp}-pending@bench.test`;
    const takenEmail = `rt82-s5-${stamp}-taken@bench.test`;
    const trackedIds: string[] = [];
    const kvKeys = new Set<string>([
      organizationReservationKey(orgA),
      organizationReservationKey(orgB),
      loginReservationKey(joinEmail),
      loginReservationKey(rollbackEmail),
      loginReservationKey(pendingEmail),
      loginReservationKey(takenEmail),
    ]);
    let pool: Pool | undefined;
    let releaseBlocker: (() => void) | undefined;
    const operations: Array<Promise<unknown>> = [];

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

    try {
      const env = readAppEnv();
      assert.equal(env.appEnv, 'development');
      assert.equal(env.runtimeMode, 'postgres');
      const resolved = fileURLToPath(resolveProjectModuleImportUrl('/_102034_/l1/mdm/persistence.js'));
      assert.equal(realpathSync(resolved), realpathSync(persistenceSource));
      assert.equal(resolved.endsWith('/l1/mdm/persistence.ts'), true);

      const tables = getMdmTableNames(env.appEnv);
      const definitions = await loadResolvedTableDefinitions(env);
      const mdmKv = definitions.find((item) => item.repositoryName === 'mdmKv');
      assert.equal(mdmKv?.projectId, '102034');
      assert.equal(mdmKv?.tableName, tables.kv);

      pool = getSharedPgPool(env);
      const databaseRows = await queryRows<{ name: string }>(pool, 'SELECT current_database() AS name');
      assert.equal(databaseRows[0]?.name, expectedDatabase);
      for (const tableName of [tables.kv, tables.documents, tables.documentsEntitiesIndex, tables.relationship, tables.tag, tables.auditLog]) {
        const present = await queryRows<{ present: boolean }>(
          pool,
          'SELECT to_regclass($1) IS NOT NULL AS present',
          [tableName],
        );
        if (!present[0]?.present) {
          throw new Error(`bench table missing: ${tableName}`);
        }
      }
      const auditBefore = await countWhere(pool, tables.auditLog, 'TRUE', []);

      const setup = createPostgresDataRuntime(env);
      const companyA = await ensureOrganizationCompany(createRequestContext(setup), bindingA, configA);
      const companyB = await ensureOrganizationCompany(createRequestContext(setup), bindingB, configB);
      trackedIds.push(companyA.companyMdmId, companyB.companyMdmId);

      const lockKey = registrationLockKey(['login', joinEmail]);
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
      const actor = { email: ` ${joinEmail.toUpperCase()} `, name: 'Ada' };
      const first = ensureSelfRegistration(createRequestContext(firstRuntime), bindingA, configA, actor);
      const second = ensureSelfRegistration(createRequestContext(secondRuntime), bindingB, configB, actor);
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
      const [joinedA, joinedB] = await Promise.all([first, second]);
      assert.equal(joinedA.status, 'incomplete');
      assert.equal(joinedA.person?.mdmId, joinedB.person?.mdmId);
      const personMdmId = joinedA.person?.mdmId ?? '';
      trackedIds.push(personMdmId);
      assert.equal(await countWhere(pool, tables.kv, '"key" = $1', [loginReservationKey(joinEmail)]), 1);
      assert.equal(await countWhere(pool, tables.documents, '"mdmId" = $1', [personMdmId]), 1);
      assert.equal(await loginCount(pool, tables.tag, joinEmail), 1);
      assert.equal(await linkCount(pool, tables.relationship, personMdmId, companyA.companyMdmId), 1);
      assert.equal(await linkCount(pool, tables.relationship, personMdmId, companyB.companyMdmId), 1);

      const restarted = createPostgresDataRuntime(env);
      const reread = await personByLogin(createRequestContext(restarted), joinEmail);
      assert.equal(reread?.mdmId, personMdmId);

      const rollbackCtx = createRequestContext(createPostgresDataRuntime(env));
      await rollbackCtx.cache.set(identityCacheKey(rollbackEmail), { mdmId: 'sentinel' }, 60);
      await rollbackCtx.cache.set('rt82-parent', { ok: true }, 60);
      setSelfRegistrationFault('after-reserve');
      await assert.rejects(
        () => ensureSelfRegistration(rollbackCtx, bindingA, configA, { email: rollbackEmail, name: 'Rollback' }),
        (error: unknown) => error instanceof Error && error.message === 'self registration fault: after-reserve',
      );
      setSelfRegistrationFault(null);
      assert.deepEqual(await rollbackCtx.cache.get(identityCacheKey(rollbackEmail)), { mdmId: 'sentinel' });
      assert.deepEqual(await rollbackCtx.cache.get('rt82-parent'), { ok: true });
      assert.equal(await countWhere(pool, tables.kv, '"key" = $1', [loginReservationKey(rollbackEmail)]), 0);
      assert.equal(await loginCount(pool, tables.tag, rollbackEmail), 0);

      const pendingPerson = await createRequestContext(setup).mdm.entity.create({
        details: { subtype: 'Person', name: 'Pending', countryCode: 'BR' },
      });
      const pendingChannel = await createRequestContext(setup).mdm.entity.create({
        details: { subtype: 'ContactChannel', name: pendingEmail, contactType: 'Email', value: pendingEmail, countryCode: 'BR' },
      });
      trackedIds.push(pendingPerson.mdmId, pendingChannel.mdmId);
      await createRequestContext(setup).mdm.entity.link({
        fromId: pendingPerson.mdmId,
        toId: pendingChannel.mdmId,
        type: 'HasContact',
      });
      const pendingLeft = ensureSelfRegistration(
        createRequestContext(createPostgresDataRuntime(env)),
        bindingA,
        configA,
        { email: pendingEmail, name: 'Pending' },
      );
      const pendingRight = ensureSelfRegistration(
        createRequestContext(createPostgresDataRuntime(env)),
        bindingA,
        configA,
        { email: pendingEmail, name: 'Pending' },
      );
      const [openedLeft, openedRight] = await Promise.all([pendingLeft, pendingRight]);
      assert.equal(openedLeft.status, 'pending');
      assert.equal(openedLeft.requestId, openedRight.requestId);
      const requestId = openedLeft.requestId ?? '';
      kvKeys.add(requestIndexKey(orgA, pendingEmail));
      kvKeys.add(requestRecordKey(requestId));
      const own = await readOwnAccessRequest(createRequestContext(createPostgresDataRuntime(env)), {
        requestId,
        organizationKey: orgA,
        email: pendingEmail,
      });
      assert.equal(own.requestId, requestId);
      assert.equal(own.status, 'pending');
      const listed = await listOrganizationAccessRequests(createRequestContext(createPostgresDataRuntime(env)), orgA);
      const listedRequest = listed.find((item) => item.requestId === requestId);
      assert.equal(listedRequest?.status, 'pending');
      assert.equal(listedRequest?.candidateIds.length, 1);
      const candidateId = listedRequest?.candidateIds[0] ?? '';

      const decisions = await Promise.allSettled([
        resolveAccessRequest(
          createRequestContext(createPostgresDataRuntime(env)),
          bindingA,
          configA,
          { email: 'resolver-a@bench.test', name: 'Resolver A' },
          { requestId, expectedVersion: own.version, decision: 'create-new' },
        ),
        resolveAccessRequest(
          createRequestContext(createPostgresDataRuntime(env)),
          bindingA,
          configA,
          { email: 'resolver-b@bench.test', name: 'Resolver B' },
          { requestId, expectedVersion: own.version, decision: 'use-existing', candidateId },
        ),
      ]);
      const won = decisions.filter((item) => item.status === 'fulfilled');
      const lost = decisions.filter((item) => item.status === 'rejected');
      assert.equal(won.length, 1);
      assert.equal(lost.length, 1);
      assert.equal(lost[0]?.status === 'rejected' && lost[0].reason instanceof AppError && lost[0].reason.code === 'ACCESS_REQUEST_CONFLICT', true);
      const winner = won[0]?.status === 'fulfilled' ? won[0].value : undefined;
      assert.ok(winner);
      trackedIds.push(winner.person.mdmId);
      assert.equal(await loginCount(pool, tables.tag, pendingEmail), 1);
      const afterDecision = await readOwnAccessRequest(createRequestContext(createPostgresDataRuntime(env)), {
        requestId,
        organizationKey: orgA,
        email: pendingEmail,
      });
      assert.equal(afterDecision.status, 'resolved');
      const personBeforeRetry = await createRequestContext(setup).mdm.entity.get({ mdmId: winner.person.mdmId });
      const retried = await resolveAccessRequest(
        createRequestContext(createPostgresDataRuntime(env)),
        bindingA,
        configA,
        { email: 'resolver-a@bench.test', name: 'Resolver A' },
        {
          requestId,
          expectedVersion: own.version,
          decision: winner.decision,
          candidateId: winner.decision === 'use-existing' ? candidateId : undefined,
        },
      );
      assert.equal(retried.person.mdmId, winner.person.mdmId);
      assert.equal(retried.version, afterDecision.version);
      const personAfterRetry = await createRequestContext(setup).mdm.entity.get({ mdmId: winner.person.mdmId });
      assert.equal(personAfterRetry.version, personBeforeRetry.version);
      assert.equal(await loginCount(pool, tables.tag, pendingEmail), 1);

      const takenPerson = await createRequestContext(setup).mdm.entity.create({
        details: { subtype: 'Person', name: 'Taken Candidate', countryCode: 'BR' },
      });
      const takenChannel = await createRequestContext(setup).mdm.entity.create({
        details: { subtype: 'ContactChannel', name: takenEmail, contactType: 'Email', value: takenEmail, countryCode: 'BR' },
      });
      const takenOwner = await createRequestContext(setup).mdm.entity.create({
        details: { subtype: 'Person', name: 'Taken Owner', countryCode: 'BR' },
      });
      trackedIds.push(takenPerson.mdmId, takenChannel.mdmId, takenOwner.mdmId);
      await createRequestContext(setup).mdm.entity.link({
        fromId: takenPerson.mdmId,
        toId: takenChannel.mdmId,
        type: 'HasContact',
      });
      const takenOpen = await ensureSelfRegistration(
        createRequestContext(createPostgresDataRuntime(env)),
        bindingA,
        configA,
        { email: takenEmail, name: 'Taken' },
      );
      assert.equal(takenOpen.status, 'pending');
      const takenRequestId = takenOpen.requestId ?? '';
      kvKeys.add(requestIndexKey(orgA, takenEmail));
      kvKeys.add(requestRecordKey(takenRequestId));
      await createRequestContext(setup).mdm.identity.setLogin(takenOwner.mdmId, takenEmail);
      const takenList = await listOrganizationAccessRequests(createRequestContext(setup), orgA);
      const takenRow = takenList.find((item) => item.requestId === takenRequestId);
      await assert.rejects(
        () => resolveAccessRequest(
          createRequestContext(createPostgresDataRuntime(env)),
          bindingA,
          configA,
          { email: 'resolver-taken@bench.test', name: 'Resolver' },
          {
            requestId: takenRequestId,
            expectedVersion: takenRow?.version ?? 1,
            decision: 'use-existing',
            candidateId: takenRow?.candidateIds[0],
          },
        ),
        (error: unknown) => error instanceof AppError && error.code === 'MDM_LOGIN_TAKEN',
      );
      assert.equal(await loginCount(pool, tables.tag, takenEmail), 1);
      const takenStill = await readOwnAccessRequest(createRequestContext(createPostgresDataRuntime(env)), {
        requestId: takenRequestId,
        organizationKey: orgA,
        email: takenEmail,
      });
      assert.equal(takenStill.status, 'pending');
      assert.equal(takenStill.requestId, takenRequestId);

      const auditAfter = await countWhere(pool, tables.auditLog, 'TRUE', []);
      assert.ok(auditAfter > auditBefore);
      await cleanupBench(pool, tables, [...kvKeys], trackedIds);
      assert.equal(await countWhere(pool, tables.auditLog, 'TRUE', []), auditAfter);
      assert.equal(await countWhere(pool, tables.kv, '"key" = ANY($1::text[])', [[...kvKeys]]), 0);
    } finally {
      setSelfRegistrationFault(null);
      releaseBlocker?.();
      await Promise.allSettled(operations);
      if (pool) await pool.end();
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

function loginReservationKey(email: string): string {
  const digest = createHash('sha256').update(email).digest('hex');
  return `${REGISTRATION_STORE_PREFIX}login/${digest}`;
}

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

async function loginCount(pool: Pool, tableName: string, email: string): Promise<number> {
  return countWhere(pool, tableName, '"namespace" = $1 AND "tag" = $2', [MDM_LOGIN_NAMESPACE, email]);
}

async function linkCount(pool: Pool, tableName: string, fromId: string, toId: string): Promise<number> {
  return countWhere(
    pool,
    tableName,
    '"fromId" = $1 AND "toId" = $2 AND "type" = \'AssignedTo\' AND "role" = \'member\' AND "status" = \'Active\'',
    [fromId, toId],
  );
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function cleanupBench(
  pool: Pool,
  tables: ReturnType<typeof getMdmTableNames>,
  keys: string[],
  mdmIds: string[],
): Promise<void> {
  const ids = [...new Set(mdmIds.filter((id) => id.length > 0))];
  await pool.query(`DELETE FROM ${quoteIdent(tables.kv)} WHERE "key" = ANY($1::text[])`, [keys]);
  if (ids.length === 0) return;
  await pool.query(`DELETE FROM ${quoteIdent(tables.relationship)} WHERE "fromId" = ANY($1::text[]) OR "toId" = ANY($1::text[])`, [ids]);
  await pool.query(`DELETE FROM ${quoteIdent(tables.tag)} WHERE "entityId" = ANY($1::text[])`, [ids]);
  await pool.query(`DELETE FROM ${quoteIdent(tables.documents)} WHERE "mdmId" = ANY($1::text[])`, [ids]);
  await pool.query(`DELETE FROM ${quoteIdent(tables.documentsEntitiesIndex)} WHERE "mdmId" = ANY($1::text[])`, [ids]);
}
