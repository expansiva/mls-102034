/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/identityUsers.integration.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import type { ResolvedTableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import { buildCreateIndexSql, buildCreateTableSql } from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';
import { createPostgresDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/postgres/MdmDataRuntimePostgres.js';
import { tableDefinitions } from '/_102034_/l1/mdm/persistence.js';
import { getMdmTableNames } from '/_102034_/l1/mdm/tableNames.js';
import type { MdmEntityIndexRecord, MdmTagRecord, PersonDetailRecord } from '/_102034_/l1/mdm/module.js';
import { createMdmFacade } from '/_102034_/l1/mdm/layer_3_usecases/mdmFacade.js';
import { listUsers } from '/_102034_/l1/mdm/layer_3_usecases/identityUsers.js';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { IDataRuntime } from '/_102034_/l1/server/layer_1_external/data/runtime.js';

const optedIn = process.env.RUN_INTEGRATION_TESTS === 'true';
const READER_TABLES = ['mdmEntityIndex', 'mdmDocumentCache', 'mdmTag'] as const;
const EXPECTED_ALL = ['u-01', 'u-02', 'u-03', 'u-04', 'u-05', 'u-06', 'u-07', 'u-08'];
const EXPECTED_ACTIVE = ['u-01', 'u-05', 'u-06', 'u-07', 'u-08'];

function localTestUrl(): string {
  const raw = process.env.MDM_USERS_TEST_PG_URL ?? '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('MDM_USERS_TEST_PG_URL must be a local collab_app_test URL');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || database !== 'collab_app_test') {
    throw new Error('MDM_USERS_TEST_PG_URL must be a local collab_app_test URL');
  }
  return raw;
}

function ctxFor(data: IDataRuntime, moduleId: string): RequestContext {
  return { data, moduleId } as RequestContext;
}

function person(
  mdmId: string,
  name: string,
  status: MdmEntityIndexRecord['status'],
  tags: string[],
): MdmEntityIndexRecord {
  return {
    mdmId,
    subtype: 'Person',
    name,
    status,
    countryCode: 'BR',
    tags,
    searchVector: '',
    dynamoPk: mdmId,
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
  };
}

function loginTag(mdmId: string, email: string): MdmTagRecord {
  return {
    id: `${mdmId}:${email}`,
    entityType: 'MdmEntity',
    entityId: mdmId,
    tag: email,
    namespace: 'login',
    module: 'organization',
    createdBy: 'test',
    createdByType: 'system',
    createdAt: '2026-10-20T00:00:00.000Z',
  };
}

function detail(mdmId: string, name: string): PersonDetailRecord {
  return {
    mdmId,
    subtype: 'Person',
    name,
    status: 'Active',
    countryCode: 'BR',
    tags: [],
    aliases: [],
    contacts: [{ mdmId: `contact-${mdmId}`, title: 'mail', value: 'secret-contact' } as PersonDetailRecord['contacts'][number]],
    relationshipRefs: {},
    addresses: [],
    privacyConsent: { consentedAt: '2026-01-01', consentVersion: '1', channel: 'web' },
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
  };
}

async function seed(
  runtime: IDataRuntime,
  rows: Array<{ index: MdmEntityIndexRecord; emails: string[]; document?: boolean }>,
): Promise<void> {
  for (const row of rows) {
    await runtime.mdmEntityIndex.insert({ record: row.index });
    for (const email of row.emails) {
      await runtime.mdmTag.insert({ record: loginTag(row.index.mdmId, email) });
    }
    if (row.document !== false) {
      await runtime.mdmDocument.put({
        record: { mdmId: row.index.mdmId, version: 3, details: detail(row.index.mdmId, row.index.name) },
      });
    }
  }
}

async function rejectCode(run: () => Promise<unknown>, code: string, statusCode: number): Promise<void> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, code);
    assert.equal(error.statusCode, statusCode);
    assert.equal(JSON.stringify((error as AppError).details ?? {}).includes('@'), false);
    return;
  }
  assert.fail(`expected ${code}`);
}

function resolvedFor(appEnv: AppEnv['appEnv']): ResolvedTableDefinition[] {
  return tableDefinitions
    .filter((definition) => READER_TABLES.includes(definition.repositoryName as typeof READER_TABLES[number]))
    .map((definition) => ({
      ...definition,
      tableName: definition.tableNameByEnv?.[appEnv] ?? definition.tableName,
      projectId: 'mdm-users',
      repositoryName: definition.repositoryName ?? definition.tableName,
      logicalTableName: definition.tableName,
      dynamoResolvedTableName: null,
    }));
}

async function openSchema(appEnv: AppEnv['appEnv']): Promise<{ pool: Pool; schema: string }> {
  const schema = `mdm_users_${randomBytes(8).toString('hex')}`;
  const connectionString = new URL(localTestUrl());
  connectionString.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new Pool({ connectionString: connectionString.toString(), max: 4 });
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    for (const definition of resolvedFor(appEnv)) {
      await client.query(buildCreateTableSql(definition));
      for (const sql of buildCreateIndexSql(definition)) {
        await client.query(sql);
      }
    }
  } catch (error) {
    await pool.end();
    throw error;
  } finally {
    client.release();
  }
  return { pool, schema };
}

async function tableNames(pool: Pool, schema: string): Promise<string[]> {
  const result = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`,
    [schema],
  );
  return result.rows.map((row) => row.tablename);
}

async function counts(runtime: IDataRuntime): Promise<[number, number, number]> {
  const [indexRows, tagRows, documents] = await Promise.all([
    runtime.mdmEntityIndex.findMany(),
    runtime.mdmTag.findMany(),
    runtime.mdmDocument.getMany({ mdmIds: EXPECTED_ALL }),
  ]);
  return [indexRows.length, tagRows.length, documents.length];
}

test('opt-in without a local collab_app_test URL fails', () => {
  if (!optedIn) return;
  localTestUrl();
});

test('postgres directory matches the fixed page, transaction and schema boundaries', { skip: !optedIn }, async () => {
  const opened: Array<{ pool: Pool; schema: string }> = [];
  const publicBefore = await (async () => {
    const probe = new Pool({ connectionString: localTestUrl(), max: 1 });
    try {
      const result = await probe.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'mdm%'`,
      );
      return result.rows[0]?.count;
    } finally {
      await probe.end();
    }
  })();

  try {
    const development = await openSchema('development');
    const staging = await openSchema('staging');
    const other = await openSchema('development');
    opened.push(development, staging, other);

    const names = getMdmTableNames('development');
    const stagingNames = getMdmTableNames('staging');
    assert.deepEqual(await tableNames(development.pool, development.schema), [
      names.documents,
      names.documentsEntitiesIndex,
      names.tag,
    ].sort());
    assert.deepEqual(await tableNames(staging.pool, staging.schema), [
      stagingNames.documents,
      stagingNames.documentsEntitiesIndex,
      stagingNames.tag,
    ].sort());
    assert.equal(stagingNames.documents.endsWith('_test'), true);
    assert.equal((await tableNames(development.pool, development.schema)).some((name) => name.endsWith('_test')), false);

    const env = { appEnv: 'development' } as AppEnv;
    const runtime = createPostgresDataRuntime(env, development.pool);
    const sameSchema = createPostgresDataRuntime(env, development.pool);
    const isolated = createPostgresDataRuntime(env, other.pool);
    const stagingRuntime = createPostgresDataRuntime({ appEnv: 'staging' } as AppEnv, staging.pool);

    await seed(runtime, [
      { index: person('u-01', 'ÁNA Silva', 'Active', ['papel-x']), emails: ['Ana@ex.com', 'ana@ex.com'] },
      { index: person('u-02', 'Olga', 'Blocked', ['outro']), emails: ['olga@ex.com'] },
      { index: person('u-03', '100%_João', 'Inactive', []), emails: ['joao@ex.com'] },
      { index: person('u-04', 'Marta', 'Merged', []), emails: ['marta@ex.com'] },
      { index: person('u-05', 'A\u0301na NFD', 'Active', []), emails: ['nfd@ex.com'] },
      { index: person('u-06', 'Sem', 'Active', []), emails: ['sem@ex.com'] },
      { index: person('u-07', 'Ana Costa', 'Active', []), emails: ['costa1@ex.com'] },
      { index: person('u-08', 'Ana Costa', 'Active', []), emails: ['costa2@ex.com'] },
    ]);
    await runtime.mdmEntityIndex.insert({
      record: { ...person('u-co', 'Empresa', 'Active', ['papel-x']), subtype: 'Company' },
    });
    await runtime.mdmTag.insert({ record: loginTag('u-co', 'co@ex.com') });
    await runtime.mdmEntityIndex.insert({
      record: { ...person('u-ct', 'Contato', 'Active', []), subtype: 'Contact' } as unknown as MdmEntityIndexRecord,
    });
    await runtime.mdmTag.insert({ record: loginTag('u-ct', 'ct@ex.com') });
    await runtime.mdmEntityIndex.insert({ record: person('u-nologin', 'Sem Login', 'Active', ['papel-x']) });

    const before = await counts(runtime);
    const alfa = await listUsers(ctxFor(runtime, 'modulo-alfa'), { status: 'all', pageSize: 100 });
    assert.deepEqual(alfa.items.map((item) => item.mdmId), EXPECTED_ALL);
    assert.equal(alfa.nextCursor, null);
    assert.equal(alfa.items[0]!.loginEmail, 'ana@ex.com');
    assert.deepEqual(alfa.items[0]!.contacts, [{ mdmId: 'contact-u-01', title: 'mail' }]);
    assert.equal(JSON.stringify(alfa).includes('privacyConsent'), false);
    assert.equal(JSON.stringify(alfa).includes('secret-contact'), false);
    assert.equal(JSON.stringify(alfa).includes('projectId'), false);
    const beta = await createMdmFacade(ctxFor(sameSchema, 'modulo-beta')).identity.listUsers({ status: 'all', pageSize: 100 });
    assert.deepEqual(beta.items.map((item) => item.mdmId), EXPECTED_ALL);
    assert.deepEqual(await counts(runtime), before);

    const active: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await listUsers(ctxFor(runtime, 'modulo-alfa'), { pageSize: 2, ...(cursor ? { cursor } : {}) });
      active.push(...page.items.map((item) => item.mdmId));
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(active, EXPECTED_ACTIVE);

    const folded = await listUsers(ctxFor(runtime, 'modulo-gama'), { status: 'all', name: 'ana', pageSize: 2 });
    const foldedRest = await listUsers(ctxFor(runtime, 'modulo-gama'), {
      status: 'all',
      name: 'ana',
      pageSize: 2,
      cursor: folded.nextCursor!,
    });
    assert.deepEqual(
      [...folded.items, ...foldedRest.items].map((item) => item.mdmId),
      ['u-01', 'u-05', 'u-07', 'u-08'],
    );
    assert.equal(foldedRest.nextCursor, null);
    const literal = await listUsers(ctxFor(runtime, 'modulo-alfa'), { status: 'all', name: '%_' });
    assert.deepEqual(literal.items.map((item) => item.mdmId), ['u-03']);
    const joao = await listUsers(ctxFor(runtime, 'modulo-alfa'), { status: 'all', name: 'joao' });
    assert.deepEqual(joao.items.map((item) => item.mdmId), ['u-03']);

    const withRole = await listUsers(ctxFor(runtime, 'modulo-delta'), { status: 'all', roleTag: 'papel-x' });
    assert.deepEqual(withRole.items.map((item) => item.mdmId), ['u-01']);
    const withoutRole = await listUsers(ctxFor(runtime, 'modulo-delta'), {
      status: 'all',
      roleTag: 'papel-x',
      roleTagMode: 'without',
      pageSize: 100,
    });
    assert.deepEqual(withoutRole.items.map((item) => item.mdmId), ['u-02', 'u-03', 'u-04', 'u-05', 'u-06', 'u-07', 'u-08']);

    await seed(runtime, [
      { index: person('u-gap', 'Gap', 'Active', []), emails: ['gap@ex.com'], document: false },
      { index: person('u-bad', 'Bad', 'Active', []), emails: ['not-an-email'] },
      { index: person('u-two', 'Two', 'Active', []), emails: ['one@ex.com', 'two@ex.com'] },
    ]);
    await rejectCode(
      () => listUsers(ctxFor(runtime, 'modulo-alfa'), { status: 'all', name: 'Gap' }),
      'MDM_USER_DIRECTORY_INCOMPLETE',
      503,
    );
    await rejectCode(
      () => listUsers(ctxFor(runtime, 'modulo-alfa'), { status: 'all', name: 'Bad' }),
      'MDM_LOGIN_INVALID',
      409,
    );
    await rejectCode(
      () => listUsers(ctxFor(runtime, 'modulo-alfa'), { status: 'all', name: 'Two' }),
      'MDM_LOGIN_AMBIGUOUS',
      409,
    );
    await rejectCode(
      () => listUsers(ctxFor(runtime, 'modulo-alfa'), { projectId: '102056' } as never),
      'VALIDATION_ERROR',
      400,
    );

    const email = await createMdmFacade(ctxFor(runtime, 'modulo-epsilon')).identity.getLoginEmail('u-06');
    assert.equal(email, 'sem@ex.com');

    await assert.rejects(
      runtime.runInTransaction(async (tx) => {
        await seed(tx, [{ index: person('u-tx', 'Transacao', 'Active', []), emails: ['tx@ex.com'] }]);
        const seen = await listUsers(ctxFor(tx, 'modulo-alfa'), { status: 'all', name: 'Transacao' });
        assert.deepEqual(seen.items.map((item) => item.mdmId), ['u-tx']);
        throw new Error('rollback');
      }),
      /rollback/,
    );
    const afterRollback = await listUsers(ctxFor(runtime, 'modulo-beta'), { status: 'all', name: 'Transacao' });
    assert.deepEqual(afterRollback.items, []);

    const elsewhere = await listUsers(ctxFor(isolated, 'modulo-alfa'), { status: 'all' });
    assert.deepEqual(elsewhere.items, []);

    await seed(stagingRuntime, [
      { index: person('s-01', 'ÁNA Staging', 'Active', []), emails: ['stage@ex.com'] },
    ]);
    const staged = await listUsers(ctxFor(stagingRuntime, 'modulo-zeta'), { name: 'ana' });
    assert.deepEqual(staged.items.map((item) => item.mdmId), ['s-01']);
    const devUntouched = await listUsers(ctxFor(runtime, 'modulo-alfa'), { status: 'all', name: 'Staging' });
    assert.deepEqual(devUntouched.items, []);
  } finally {
    for (const openedSchema of opened) {
      try {
        await openedSchema.pool.query(`DROP SCHEMA IF EXISTS ${openedSchema.schema} CASCADE`);
      } finally {
        await openedSchema.pool.end();
      }
    }
    const probe = new Pool({ connectionString: localTestUrl(), max: 1 });
    try {
      const result = await probe.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'mdm%'`,
      );
      assert.equal(result.rows[0]?.count, publicBefore);
    } finally {
      await probe.end();
    }
  }
});
