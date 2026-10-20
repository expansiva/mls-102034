/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/identityUsers.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';

import type { MdmEntityIndexRecord, MdmTagRecord, PersonDetailRecord } from '/_102034_/l1/mdm/module.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { createMdmFacade, type MdmListUsersInput } from '/_102034_/l1/mdm/layer_3_usecases/mdmFacade.js';
import { listUsers } from '/_102034_/l1/mdm/layer_3_usecases/identityUsers.js';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { IDataRuntime } from '/_102034_/l1/server/layer_1_external/data/runtime.js';

const SUMMARY_KEYS = ['mdmId', 'version', 'name', 'loginEmail', 'status', 'tags', 'contacts'];

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

async function rejectCode(run: () => Promise<unknown>, code: string, statusCode: number): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, code);
    assert.equal(error.statusCode, statusCode);
    return error;
  }
  assert.fail(`expected ${code}`);
}

test('default Active, explicit statuses, folded and literal name, role, and caller module', async () => {
  const runtime = createMemoryDataRuntime();
  await seed(runtime, [
    { index: person('id-ana', 'ÁNA Silva', 'Active', ['papel-x']), emails: ['Ana@ex.com', 'ana@ex.com'] },
    { index: person('id-joao', '100%_João', 'Inactive', []), emails: ['joao@ex.com'] },
    { index: person('id-merged', 'Marta', 'Merged', []), emails: ['marta@ex.com'] },
    { index: person('id-blocked', 'Olga', 'Blocked', ['outro']), emails: ['olga@ex.com'] },
    { index: person('id-sem', 'Sem', 'Active', []), emails: ['sem@ex.com'] },
  ]);
  await runtime.mdmEntityIndex.insert({
    record: { ...person('id-co', 'Empresa', 'Active', ['papel-x']), subtype: 'Company' },
  });
  await runtime.mdmTag.insert({ record: loginTag('id-co', 'co@ex.com') });

  const active = await listUsers(ctxFor(runtime, 'modulo-alfa'));
  assert.deepEqual(active.items.map((item) => item.mdmId), ['id-ana', 'id-sem']);
  assert.equal(active.nextCursor, null);
  assert.equal(active.items[0]!.loginEmail, 'ana@ex.com');
  assert.deepEqual(Object.keys(active.items[0]!).sort(), [...SUMMARY_KEYS].sort());
  assert.deepEqual(active.items[0]!.contacts, [{ mdmId: 'contact-id-ana', title: 'mail' }]);
  assert.equal(JSON.stringify(active).includes('privacyConsent'), false);
  assert.equal(JSON.stringify(active).includes('secret-contact'), false);

  const same = await createMdmFacade(ctxFor(runtime, 'modulo-beta')).identity.listUsers();
  assert.deepEqual(same.items.map((item) => item.mdmId), ['id-ana', 'id-sem']);

  const everyone = await listUsers(ctxFor(runtime, 'modulo-beta'), { status: 'all' });
  assert.deepEqual(everyone.items.map((item) => item.status), ['Active', 'Blocked', 'Inactive', 'Merged', 'Active']);

  const folded = await listUsers(ctxFor(runtime, 'modulo-alfa'), { status: 'all', name: 'ana' });
  assert.deepEqual(folded.items.map((item) => item.mdmId), ['id-ana']);
  const literal = await listUsers(ctxFor(runtime, 'modulo-alfa'), { status: 'all', name: '%_' });
  assert.deepEqual(literal.items.map((item) => item.mdmId), ['id-joao']);

  const withRole = await listUsers(ctxFor(runtime, 'modulo-gama'), { status: 'all', roleTag: 'papel-x' });
  assert.deepEqual(withRole.items.map((item) => item.mdmId), ['id-ana']);
  const withoutRole = await listUsers(ctxFor(runtime, 'modulo-gama'), {
    status: 'all',
    roleTag: 'papel-x',
    roleTagMode: 'without',
  });
  assert.deepEqual(withoutRole.items.map((item) => item.mdmId), ['id-blocked', 'id-joao', 'id-merged', 'id-sem']);
});

test('page size and cursor use the last returned row', async () => {
  const runtime = createMemoryDataRuntime();
  await seed(runtime, [
    { index: person('id-a', 'A', 'Active', []), emails: ['a@ex.com'] },
    { index: person('id-b', 'B', 'Active', []), emails: ['b@ex.com'] },
    { index: person('id-c', 'C', 'Active', []), emails: ['c@ex.com'] },
  ]);
  const first = await listUsers(ctxFor(runtime, 'mod-1'), { pageSize: 2 });
  assert.deepEqual(first.items.map((item) => item.mdmId), ['id-a', 'id-b']);
  assert.ok(first.nextCursor);
  const second = await listUsers(ctxFor(runtime, 'mod-2'), { pageSize: 1, cursor: first.nextCursor });
  assert.deepEqual(second.items.map((item) => item.mdmId), ['id-c']);
  assert.equal(second.nextCursor, null);
  const changed = await rejectCode(
    () => listUsers(ctxFor(runtime, 'mod-1'), { name: 'A', cursor: first.nextCursor! }),
    'VALIDATION_ERROR',
    400,
  );
  assert.equal(JSON.stringify(changed.details).includes('@'), false);
});

test('missing capability, incomplete document, bad login and reader failure stay errors', async () => {
  const runtime = createMemoryDataRuntime();
  await seed(runtime, [
    { index: person('id-ok', 'Ok', 'Active', []), emails: ['ok@ex.com'] },
    { index: person('id-gap', 'Gap', 'Active', []), emails: ['gap@ex.com'], document: false },
    { index: person('id-bad', 'Bad', 'Active', []), emails: ['not-an-email'] },
    { index: person('id-two', 'Two', 'Active', []), emails: ['one@ex.com', 'two@ex.com'] },
  ]);
  const bare = createMemoryDataRuntime();
  delete bare.mdmIdentityUsers;
  await rejectCode(() => listUsers(ctxFor(bare, 'mod')), 'MDM_USER_DIRECTORY_UNAVAILABLE', 503);

  await rejectCode(
    () => listUsers(ctxFor(runtime, 'mod'), { status: 'all', name: 'Gap' }),
    'MDM_USER_DIRECTORY_INCOMPLETE',
    503,
  );
  const invalid = await rejectCode(
    () => listUsers(ctxFor(runtime, 'mod'), { status: 'all', name: 'Bad' }),
    'MDM_LOGIN_INVALID',
    409,
  );
  assert.equal(JSON.stringify(invalid.details).includes('not-an-email'), false);
  const ambiguous = await rejectCode(
    () => listUsers(ctxFor(runtime, 'mod'), { status: 'all', name: 'Two' }),
    'MDM_LOGIN_AMBIGUOUS',
    409,
  );
  assert.equal(JSON.stringify(ambiguous.details).includes('one@ex.com'), false);

  runtime.mdmIdentityUsers!.listPage = async () => {
    throw new Error('store down');
  };
  await assert.rejects(() => listUsers(ctxFor(runtime, 'mod')), /store down/);

  const email = await createMdmFacade(ctxFor(createMemoryDataRuntime(), 'mod')).identity.getLoginEmail('missing');
  assert.equal(email, null);
  const found = await createMdmFacade(ctxFor(runtime, 'outro-modulo')).identity.getLoginEmail('id-ok');
  assert.equal(found, 'ok@ex.com');

  const org = { orgId: 'x' } as MdmListUsersInput;
  await rejectCode(() => listUsers(ctxFor(runtime, 'mod'), org), 'VALIDATION_ERROR', 400);
});

test('a person with no stored contacts lists with an empty list; malformed contacts stay incomplete', async () => {
  const runtime = createMemoryDataRuntime();
  await runtime.mdmEntityIndex.insert({ record: person('id-sem', 'Sem Contato', 'Active', []) });
  await runtime.mdmTag.insert({ record: loginTag('id-sem', 'sem@ex.com') });
  const bare = detail('id-sem', 'Sem Contato') as unknown as Record<string, unknown>;
  delete bare.contacts;
  await runtime.mdmDocument.put({ record: { mdmId: 'id-sem', version: 1, details: bare as unknown as PersonDetailRecord } });
  const listed = await listUsers(ctxFor(runtime, 'mod'));
  assert.equal(listed.items.length, 1);
  assert.deepEqual(listed.items[0]!.contacts, []);

  await runtime.mdmEntityIndex.insert({ record: person('id-torto', 'Torto', 'Active', []) });
  await runtime.mdmTag.insert({ record: loginTag('id-torto', 'torto@ex.com') });
  await runtime.mdmDocument.put({
    record: { mdmId: 'id-torto', version: 1, details: { ...bare, mdmId: 'id-torto', contacts: 'x' } as unknown as PersonDetailRecord },
  });
  await rejectCode(() => listUsers(ctxFor(runtime, 'mod'), { name: 'Torto' }), 'MDM_USER_DIRECTORY_INCOMPLETE', 503);
});
