/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/identityUsersContracts.ts" enhancement="_blank" />
import { createHash } from 'node:crypto';

import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { ContactSummaryValue } from '/_102034_/l1/mdm/module.js';

export type MdmUserStatus = 'Active' | 'Inactive' | 'Merged' | 'Blocked';
export type MdmListUsersStatusFilter = MdmUserStatus | 'all';
export type MdmRoleTagMode = 'with' | 'without';

export interface MdmListUsersInput {
  name?: string;
  status?: MdmListUsersStatusFilter;
  roleTag?: string;
  roleTagMode?: MdmRoleTagMode;
  pageSize?: number;
  cursor?: string;
}

export interface MdmUserSummary {
  mdmId: string;
  version: number;
  name: string;
  loginEmail: string;
  status: MdmUserStatus;
  tags: string[];
  contacts: ContactSummaryValue[];
}

export interface MdmListUsersResult {
  items: MdmUserSummary[];
  nextCursor: string | null;
}

/** Normalized directory page. `limit` is pageSize + 1. Filters exclude page size. */
export interface MdmUserDirectoryQuery {
  foldedName: string | null;
  status: MdmListUsersStatusFilter;
  roleTag: string | null;
  roleTagMode: MdmRoleTagMode | null;
  afterMdmId: string | null;
  limit: number;
}

export interface MdmUserDirectoryFilter {
  foldedName: string | null;
  status: MdmListUsersStatusFilter;
  roleTag: string | null;
  roleTagMode: MdmRoleTagMode | null;
}

/**
 * Index plus the few document fields the facade must check.
 * No private namespaces, consent, tokens, or the whole document.
 */
export interface MdmUserDirectoryRow {
  mdmId: string;
  name: string;
  status: MdmUserStatus;
  tags: string[];
  version: number | null;
  documentMdmId: string | null;
  documentSubtype: string | null;
  contacts: unknown;
  loginTags: string[];
}

export interface MdmIdentityUserReader {
  listPage(query: MdmUserDirectoryQuery): Promise<MdmUserDirectoryRow[]>;
}

const NAME_MAX = 200;
const ROLE_TAG_MAX = 200;
const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MIN = 1;
const PAGE_SIZE_MAX = 100;
const CURSOR_MAX_CHARS = 4 * 1024;
const CURSOR_VERSION = 1;

const USER_STATUSES: readonly MdmUserStatus[] = ['Active', 'Inactive', 'Merged', 'Blocked'];
const STATUS_FILTERS: readonly MdmListUsersStatusFilter[] = [...USER_STATUSES, 'all'];
const ROLE_TAG_MODES: readonly MdmRoleTagMode[] = ['with', 'without'];
const INPUT_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'status',
  'roleTag',
  'roleTagMode',
  'pageSize',
  'cursor',
]);

const COMBINING_MARKS = /[\u0300-\u036F]/gu;

function invalid(field: string, message: string): never {
  throw new AppError('VALIDATION_ERROR', message, 400, { field });
}

/** NFD, drop combining marks U+0300..U+036F, then lowercase. Literal characters stay. */
export function foldUserName(value: string): string {
  return value.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function filterOf(query: MdmUserDirectoryFilter): MdmUserDirectoryFilter {
  return {
    foldedName: query.foldedName,
    status: query.status,
    roleTag: query.roleTag,
    roleTagMode: query.roleTagMode,
  };
}

/** SHA-256 hex of the stable filter projection. Page size is not part of the key. */
export function userDirectoryFilterKey(filter: MdmUserDirectoryFilter): string {
  const stable = JSON.stringify(filterOf(filter));
  return createHash('sha256').update(stable, 'utf8').digest('hex');
}

/**
 * Navigation cursor only: base64url JSON `{v,lastMdmId,filterKey}` at most 4 KiB.
 * It is not an authorization grant and it carries no login data.
 */
export function encodeUserDirectoryCursor(lastMdmId: string, filter: MdmUserDirectoryFilter): string {
  if (typeof lastMdmId !== 'string' || lastMdmId.length === 0) {
    invalid('cursor', 'cursor lastMdmId is required');
  }
  const payload = {
    v: CURSOR_VERSION,
    lastMdmId,
    filterKey: userDirectoryFilterKey(filter),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  if (encoded.length > CURSOR_MAX_CHARS) invalid('cursor', 'cursor exceeds 4 KiB');
  return encoded;
}

function readOptionalString(record: Record<string, unknown>, field: string): string | undefined {
  if (!Object.hasOwn(record, field)) return undefined;
  const value = record[field];
  if (typeof value !== 'string') invalid(field, `${field} must be a string`);
  return value;
}

function readName(record: Record<string, unknown>): string | null {
  const raw = readOptionalString(record, 'name');
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > NAME_MAX) invalid('name', 'name exceeds 200 characters');
  return foldUserName(trimmed);
}

function readStatus(record: Record<string, unknown>): MdmListUsersStatusFilter {
  if (!Object.hasOwn(record, 'status')) return 'Active';
  const value = record.status;
  if (typeof value !== 'string' || !STATUS_FILTERS.includes(value as MdmListUsersStatusFilter)) {
    invalid('status', 'status is not a supported value');
  }
  return value as MdmListUsersStatusFilter;
}

function readRole(record: Record<string, unknown>): { roleTag: string | null; roleTagMode: MdmRoleTagMode | null } {
  const rawTag = readOptionalString(record, 'roleTag');
  const hasMode = Object.hasOwn(record, 'roleTagMode');
  const rawMode = hasMode ? record.roleTagMode : undefined;
  if (hasMode && (typeof rawMode !== 'string' || !ROLE_TAG_MODES.includes(rawMode as MdmRoleTagMode))) {
    invalid('roleTagMode', 'roleTagMode must be with or without');
  }
  if (rawTag === undefined) {
    if (hasMode) invalid('roleTagMode', 'roleTagMode requires roleTag');
    return { roleTag: null, roleTagMode: null };
  }
  const roleTag = rawTag.trim();
  if (roleTag.length === 0) invalid('roleTag', 'roleTag is empty');
  if (roleTag.length > ROLE_TAG_MAX) invalid('roleTag', 'roleTag exceeds 200 characters');
  return { roleTag, roleTagMode: (rawMode as MdmRoleTagMode | undefined) ?? 'with' };
}

function readPageSize(record: Record<string, unknown>): number {
  if (!Object.hasOwn(record, 'pageSize')) return PAGE_SIZE_DEFAULT;
  const value = record.pageSize;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < PAGE_SIZE_MIN || value > PAGE_SIZE_MAX) {
    invalid('pageSize', 'pageSize must be an integer from 1 to 100');
  }
  return value;
}

function rejectUnknownFields(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    if (!INPUT_FIELDS.has(key)) invalid(key, `unknown field ${key}`);
  }
}

interface CursorPayload {
  lastMdmId: string;
  filterKey: string;
}

function decodeCursor(raw: string): CursorPayload {
  if (raw.length === 0 || raw.length > CURSOR_MAX_CHARS) invalid('cursor', 'cursor is malformed');
  if (!/^[A-Za-z0-9_-]+$/u.test(raw)) invalid('cursor', 'cursor is malformed');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    invalid('cursor', 'cursor is malformed');
  }
  if (!isPlainObject(parsed)) invalid('cursor', 'cursor is malformed');
  const keys = Object.keys(parsed);
  if (keys.length !== 3 || keys[0] !== 'v' || keys[1] !== 'lastMdmId' || keys[2] !== 'filterKey') {
    invalid('cursor', 'cursor is malformed');
  }
  if (parsed.v !== CURSOR_VERSION) invalid('cursor', 'cursor is malformed');
  if (typeof parsed.lastMdmId !== 'string' || parsed.lastMdmId.length === 0) {
    invalid('cursor', 'cursor is malformed');
  }
  if (typeof parsed.filterKey !== 'string' || !/^[0-9a-f]{64}$/u.test(parsed.filterKey)) {
    invalid('cursor', 'cursor is malformed');
  }
  return { lastMdmId: parsed.lastMdmId, filterKey: parsed.filterKey };
}

/** Validates a list input and returns the directory query. Unknown fields and bad cursors are 400. */
export function normalizeListUsersInput(input: unknown): MdmUserDirectoryQuery {
  if (!isPlainObject(input)) invalid('input', 'input must be an object');
  rejectUnknownFields(input);
  const filter: MdmUserDirectoryFilter = {
    foldedName: readName(input),
    status: readStatus(input),
    ...readRole(input),
  };
  const pageSize = readPageSize(input);
  const cursorRaw = readOptionalString(input, 'cursor');
  let afterMdmId: string | null = null;
  if (cursorRaw !== undefined) {
    const cursor = decodeCursor(cursorRaw);
    if (cursor.filterKey !== userDirectoryFilterKey(filter)) {
      invalid('cursor', 'cursor does not match the current filters');
    }
    afterMdmId = cursor.lastMdmId;
  }
  return {
    ...filter,
    afterMdmId,
    limit: pageSize + 1,
  };
}
