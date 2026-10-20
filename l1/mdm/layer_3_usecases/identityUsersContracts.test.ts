/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/identityUsersContracts.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  encodeUserDirectoryCursor,
  foldUserName,
  normalizeListUsersInput,
  userDirectoryFilterKey,
  type MdmUserDirectoryFilter,
} from '/_102034_/l1/mdm/layer_3_usecases/identityUsersContracts.js';

function rejection(input: unknown): AppError {
  try {
    normalizeListUsersInput(input);
  } catch (error) {
    assert.ok(error instanceof AppError);
    return error;
  }
  assert.fail('expected VALIDATION_ERROR');
}

function expect400(input: unknown, field: string): void {
  const error = rejection(input);
  assert.equal(error.code, 'VALIDATION_ERROR');
  assert.equal(error.statusCode, 400);
  assert.equal((error.details as { field?: string }).field, field);
}

const baseFilter: MdmUserDirectoryFilter = {
  foldedName: null,
  status: 'Active',
  roleTag: null,
  roleTagMode: null,
};

test('defaults are Active, page size 20, and no filters', () => {
  assert.deepEqual(normalizeListUsersInput({}), {
    foldedName: null,
    status: 'Active',
    roleTag: null,
    roleTagMode: null,
    afterMdmId: null,
    limit: 21,
  });
});

test('pageSize boundaries accept 1 and 100 and reject outside', () => {
  assert.equal(normalizeListUsersInput({ pageSize: 1 }).limit, 2);
  assert.equal(normalizeListUsersInput({ pageSize: 100 }).limit, 101);
  expect400({ pageSize: 0 }, 'pageSize');
  expect400({ pageSize: 101 }, 'pageSize');
  expect400({ pageSize: 20.5 }, 'pageSize');
  expect400({ pageSize: -1 }, 'pageSize');
  expect400({ pageSize: '20' }, 'pageSize');
});

test('unknown business fields are rejected', () => {
  for (const field of ['teamId', 'projectId', 'orgId', 'department']) {
    expect400({ [field]: 'x' }, field);
  }
});

test('status defaults to Active and all is explicit', () => {
  assert.equal(normalizeListUsersInput({}).status, 'Active');
  for (const status of ['Active', 'Inactive', 'Merged', 'Blocked', 'all'] as const) {
    assert.equal(normalizeListUsersInput({ status }).status, status);
  }
  expect400({ status: 'archived' }, 'status');
  expect400({ status: 'active' }, 'status');
  expect400([], 'input');
  expect400(null, 'input');
  expect400('Active', 'input');
});

test('roleTag with and without, and mode without a tag', () => {
  assert.deepEqual(normalizeListUsersInput({ roleTag: ' finance ' }), {
    foldedName: null,
    status: 'Active',
    roleTag: 'finance',
    roleTagMode: 'with',
    afterMdmId: null,
    limit: 21,
  });
  const without = normalizeListUsersInput({ roleTag: 'finance', roleTagMode: 'without' });
  assert.equal(without.roleTag, 'finance');
  assert.equal(without.roleTagMode, 'without');
  expect400({ roleTagMode: 'with' }, 'roleTagMode');
  expect400({ roleTagMode: 'without' }, 'roleTagMode');
  expect400({ roleTag: '   ' }, 'roleTag');
  expect400({ roleTag: 'x'.repeat(201) }, 'roleTag');
  expect400({ roleTag: 1 }, 'roleTag');
  assert.equal(normalizeListUsersInput({ roleTag: 'x'.repeat(200) }).roleTag, 'x'.repeat(200));
});

test('name trims, caps at 200, and blank means no filter', () => {
  const name = `  ${'Á'.repeat(200)}  `;
  assert.equal(normalizeListUsersInput({ name }).foldedName, 'a'.repeat(200));
  expect400({ name: 'a'.repeat(201) }, 'name');
  assert.equal(normalizeListUsersInput({ name: '   ' }).foldedName, null);
  expect400({ name: 12 }, 'name');
});

test('fold strips accents and keeps literal search characters', () => {
  assert.equal(foldUserName('ÁNA'), 'ana');
  assert.equal(foldUserName('João'), 'joao');
  assert.equal(foldUserName('A\u0301na'), 'ana');
  assert.equal(foldUserName("%_'\\"), "%_'\\");
  const query = normalizeListUsersInput({ name: "  João %_'\\  " });
  assert.equal(query.foldedName, "joao %_'\\");
});

test('cursor round-trips, ignores page size, and rejects a filter change', () => {
  const query = normalizeListUsersInput({ name: 'Ana', status: 'all', roleTag: 'finance' });
  const cursor = encodeUserDirectoryCursor('mdm-9', query);
  const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
  assert.deepEqual(Object.keys(decoded), ['v', 'lastMdmId', 'filterKey']);
  assert.equal(JSON.stringify(decoded).includes('@'), false);
  const next = normalizeListUsersInput({
    name: 'Ana',
    status: 'all',
    roleTag: 'finance',
    pageSize: 5,
    cursor,
  });
  assert.equal(next.afterMdmId, 'mdm-9');
  assert.equal(next.limit, 6);
  assert.equal(next.foldedName, 'ana');
  expect400({ name: 'Ana', status: 'Active', roleTag: 'finance', cursor }, 'cursor');
  expect400({ cursor: '%%%' }, 'cursor');
  expect400({ cursor: Buffer.from('[]', 'utf8').toString('base64url') }, 'cursor');
  expect400({ cursor: 'x'.repeat(4097) }, 'cursor');
});

test('filter key ignores page size and key insertion order of the same filters', () => {
  const left = normalizeListUsersInput({ status: 'Inactive', name: 'Ana', pageSize: 10 });
  const right = normalizeListUsersInput({ pageSize: 50, name: 'Ána', status: 'Inactive' });
  assert.equal(userDirectoryFilterKey(left), userDirectoryFilterKey(right));
  assert.notEqual(
    userDirectoryFilterKey(left),
    userDirectoryFilterKey({ ...baseFilter, status: 'Active' }),
  );
});
