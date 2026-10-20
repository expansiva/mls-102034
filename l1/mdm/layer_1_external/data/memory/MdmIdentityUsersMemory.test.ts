/// <mls fileReference="_102034_/l1/mdm/layer_1_external/data/memory/MdmIdentityUsersMemory.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';

import type { MdmEntityIndexRecord, MdmTagRecord, PersonDetailRecord } from '/_102034_/l1/mdm/module.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import type { MdmUserDirectoryQuery } from '/_102034_/l1/mdm/layer_3_usecases/identityUsersContracts.js';
import type { IDataRuntime } from '/_102034_/l1/server/layer_1_external/data/runtime.js';

function query(partial: Partial<MdmUserDirectoryQuery> = {}): MdmUserDirectoryQuery {
  return {
    foldedName: null,
    status: 'Active',
    roleTag: null,
    roleTagMode: null,
    afterMdmId: null,
    limit: 21,
    ...partial,
  };
}

function person(mdmId: string, name: string, status: MdmEntityIndexRecord['status'], tags: string[]): MdmEntityIndexRecord {
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

function loginTag(mdmId: string, email: string, module = 'organization', namespace: string | null = 'login'): MdmTagRecord {
  return {
    id: `${mdmId}:${module}:${email}`,
    entityType: 'MdmEntity',
    entityId: mdmId,
    tag: email,
    namespace,
    module,
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
    contacts: [{ mdmId: `contact-${mdmId}`, title: 'mail' }],
    relationshipRefs: {},
    addresses: [],
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
  };
}

async function seed(runtime: IDataRuntime, rows: Array<{ index: MdmEntityIndexRecord; emails: string[]; document?: boolean; loginModule?: string }>): Promise<void> {
  for (const row of rows) {
    await runtime.mdmEntityIndex.insert({ record: row.index });
    for (const email of row.emails) {
      await runtime.mdmTag.insert({ record: loginTag(row.index.mdmId, email, row.loginModule) });
    }
    if (row.document !== false) {
      await runtime.mdmDocument.put({ record: { mdmId: row.index.mdmId, version: 3, details: detail(row.index.mdmId, row.index.name) } });
    }
  }
}

test('two memory runtimes do not share users', async () => {
  const left = createMemoryDataRuntime();
  const right = createMemoryDataRuntime();
  await seed(left, [{ index: person('left-1', 'Ana', 'Active', []), emails: ['ana@ex.com'] }]);
  await seed(right, [{ index: person('right-1', 'Bruno', 'Active', []), emails: ['bruno@ex.com'] }]);

  const leftPage = await left.mdmIdentityUsers!.listPage(query());
  const rightPage = await right.mdmIdentityUsers!.listPage(query());
  assert.deepEqual(leftPage.map((row) => row.mdmId), ['left-1']);
  assert.deepEqual(rightPage.map((row) => row.mdmId), ['right-1']);
});

test('caller module is not a filter and role with or without selects on index tags', async () => {
  const runtime = createMemoryDataRuntime();
  await seed(runtime, [
    { index: person('id-com', 'Com Papel', 'Active', ['papel-x']), emails: ['com@ex.com'] },
    { index: person('id-sem', 'Sem Papel', 'Active', ['outro']), emails: ['sem@ex.com'] },
    { index: person('id-outro-mod', 'So Modulo', 'Active', ['papel-x']), emails: ['mod@ex.com'], loginModule: 'modulo-alfa' },
  ]);
  await runtime.mdmEntityIndex.insert({
    record: { ...person('id-company', 'Empresa', 'Active', ['papel-x']), subtype: 'Company' },
  });
  await runtime.mdmTag.insert({ record: loginTag('id-company', 'co@ex.com') });

  for (const callerModule of ['modulo-alfa', 'modulo-beta']) {
    void callerModule;
    const withRole = await runtime.mdmIdentityUsers!.listPage(query({ roleTag: 'papel-x', roleTagMode: 'with' }));
    const withoutRole = await runtime.mdmIdentityUsers!.listPage(query({ roleTag: 'papel-x', roleTagMode: 'without' }));
    assert.deepEqual(withRole.map((row) => row.mdmId), ['id-com']);
    assert.deepEqual(withoutRole.map((row) => row.mdmId), ['id-sem']);
  }
});

test('byte order, folded name, literal punctuation, status, cursor and missing document', async () => {
  const runtime = createMemoryDataRuntime();
  await seed(runtime, [
    { index: person('id-b', 'ÁNA Silva', 'Active', []), emails: ['ana@ex.com'] },
    { index: person('id-a', 'Ana Costa', 'Inactive', []), emails: ['ana.costa@ex.com'] },
    { index: person('id-c', '100%_João', 'Active', []), emails: ['joao@ex.com'], document: false },
    { index: person('id-d', 'Olga', 'Blocked', []), emails: ['olga@ex.com'] },
  ]);

  const active = await runtime.mdmIdentityUsers!.listPage(query({ status: 'Active', limit: 10 }));
  assert.deepEqual(active.map((row) => row.mdmId), ['id-b', 'id-c']);
  assert.equal(active[1]!.documentMdmId, null);
  assert.equal(active[1]!.version, null);
  assert.equal(active[0]!.version, 3);
  assert.deepEqual(active[0]!.contacts, [{ mdmId: 'contact-id-b', title: 'mail' }]);
  assert.deepEqual(active[0]!.loginTags, ['ana@ex.com']);

  const folded = await runtime.mdmIdentityUsers!.listPage(query({ status: 'all', foldedName: 'ana' }));
  assert.deepEqual(folded.map((row) => row.mdmId), ['id-a', 'id-b']);

  const literal = await runtime.mdmIdentityUsers!.listPage(query({ status: 'all', foldedName: '%_' }));
  assert.deepEqual(literal.map((row) => row.mdmId), ['id-c']);

  const page = await runtime.mdmIdentityUsers!.listPage(query({ status: 'all', limit: 2 }));
  assert.deepEqual(page.map((row) => row.mdmId), ['id-a', 'id-b']);
  const next = await runtime.mdmIdentityUsers!.listPage(query({ status: 'all', limit: 2, afterMdmId: 'id-b' }));
  assert.deepEqual(next.map((row) => row.mdmId), ['id-c', 'id-d']);
});

test('reading does not write and storage errors are not an empty page', async () => {
  const runtime = createMemoryDataRuntime();
  await seed(runtime, [{ index: person('id-1', 'Ana', 'Active', []), emails: ['ana@ex.com', 'Ana@ex.com'] }]);
  const beforeIndex = (await runtime.mdmEntityIndex.findMany()).length;
  const beforeTags = (await runtime.mdmTag.findMany()).length;
  const page = await runtime.mdmIdentityUsers!.listPage(query());
  assert.deepEqual(page[0]!.loginTags, ['ana@ex.com', 'Ana@ex.com']);
  assert.equal((await runtime.mdmEntityIndex.findMany()).length, beforeIndex);
  assert.equal((await runtime.mdmTag.findMany()).length, beforeTags);

  runtime.mdmEntityIndex.findMany = async () => {
    throw new Error('store down');
  };
  await assert.rejects(() => runtime.mdmIdentityUsers!.listPage(query()), /store down/);
});

test('transaction runtime keeps the same memory store', async () => {
  const runtime = createMemoryDataRuntime();
  await runtime.runInTransaction(async (data) => {
    await seed(data, [{ index: person('tx-1', 'Tx', 'Active', []), emails: ['tx@ex.com'] }]);
    const inside = await data.mdmIdentityUsers!.listPage(query());
    assert.deepEqual(inside.map((row) => row.mdmId), ['tx-1']);
  });
  const outside = await runtime.mdmIdentityUsers!.listPage(query());
  assert.deepEqual(outside.map((row) => row.mdmId), ['tx-1']);
});
