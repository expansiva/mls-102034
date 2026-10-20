/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/identityUsers.ts" enhancement="_blank" />
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { ContactSummaryValue } from '/_102034_/l1/mdm/module.js';
import { storedLoginEmailFromTags } from '/_102034_/l1/mdm/layer_3_usecases/identityLogin.js';
import {
  encodeUserDirectoryCursor,
  normalizeListUsersInput,
  type MdmListUsersInput,
  type MdmListUsersResult,
  type MdmUserDirectoryFilter,
  type MdmUserDirectoryRow,
  type MdmUserStatus,
  type MdmUserSummary,
} from '/_102034_/l1/mdm/layer_3_usecases/identityUsersContracts.js';

const USER_STATUSES: ReadonlySet<string> = new Set(['Active', 'Inactive', 'Merged', 'Blocked']);
const PERSON_SUBTYPE = 'Person';

function unavailable(): never {
  throw new AppError(
    'MDM_USER_DIRECTORY_UNAVAILABLE',
    'User directory is not available on this runtime',
    503,
  );
}

function sanitizeId(value: string): string | null {
  if (value.length === 0 || value.length > 200 || /[\u0000-\u001F]/u.test(value)) return null;
  return value;
}

function incomplete(mdmId: string): never {
  throw new AppError(
    'MDM_USER_DIRECTORY_INCOMPLETE',
    'User directory row is incomplete',
    503,
    { mdmId: sanitizeId(mdmId) },
  );
}

function readTags(value: unknown, mdmId: string): string[] {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) incomplete(mdmId);
  return value.slice();
}

function readContacts(value: unknown, mdmId: string): ContactSummaryValue[] {
  // PersonDetailRecord.contacts is optional: a person with no stored contacts has none.
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) incomplete(mdmId);
  return value.map((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) incomplete(mdmId);
    const record = item as Record<string, unknown>;
    if (typeof record.mdmId !== 'string' || record.mdmId.length === 0 || typeof record.title !== 'string') {
      incomplete(mdmId);
    }
    return { mdmId: record.mdmId, title: record.title };
  });
}

function summaryOf(row: MdmUserDirectoryRow): MdmUserSummary {
  if (row.documentMdmId === null || row.documentMdmId !== row.mdmId) incomplete(row.mdmId);
  if (row.documentSubtype !== PERSON_SUBTYPE) incomplete(row.mdmId);
  if (typeof row.version !== 'number' || !Number.isInteger(row.version) || row.version < 0) incomplete(row.mdmId);
  if (typeof row.name !== 'string' || !USER_STATUSES.has(row.status)) incomplete(row.mdmId);
  const loginEmail = storedLoginEmailFromTags(row.loginTags, row.mdmId);
  if (loginEmail === null) incomplete(row.mdmId);
  return {
    mdmId: row.mdmId,
    version: row.version,
    name: row.name,
    loginEmail,
    status: row.status as MdmUserStatus,
    tags: readTags(row.tags, row.mdmId),
    contacts: readContacts(row.contacts, row.mdmId),
  };
}

function filterOf(query: MdmUserDirectoryFilter): MdmUserDirectoryFilter {
  return {
    foldedName: query.foldedName,
    status: query.status,
    roleTag: query.roleTag,
    roleTagMode: query.roleTagMode,
  };
}

/** Reads one directory page. Does not authorize the caller and does not mutate MDM. */
export async function listUsers(
  ctx: RequestContext,
  input: MdmListUsersInput = {},
): Promise<MdmListUsersResult> {
  const query = normalizeListUsersInput(input);
  const reader = ctx.data.mdmIdentityUsers;
  if (!reader) unavailable();
  const rows = await reader.listPage(query);
  const pageSize = query.limit - 1;
  if (rows.length > query.limit) incomplete('');
  const summaries = rows.map(summaryOf);
  const items = summaries.slice(0, pageSize);
  const nextCursor = rows.length > pageSize
    ? encodeUserDirectoryCursor(items[items.length - 1]!.mdmId, filterOf(query))
    : null;
  return { items, nextCursor };
}
