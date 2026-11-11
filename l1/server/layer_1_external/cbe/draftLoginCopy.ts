/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/draftLoginCopy.ts" enhancement="_blank" />
// Login copy on draft entry (seed and copy only): app database → draft database, once per login
// per draft per parent process. Inserts use ON CONFLICT DO NOTHING so a row the person changed
// in the draft is never overwritten. One hop of mdm_relationship; the organization company the
// draft boot already created is reused, not copied again.

import { Client } from 'pg';
import { draftDatabaseUrl, draftDirOf } from '/_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.js';
import {
  readDraftData,
  type DraftDataLang,
  type DraftDataSourceName,
} from '/_102034_/l1/server/layer_1_external/cbe/draftDataSource.js';
import { assertLoginEmail } from '/_102034_/l1/mdm/layer_3_usecases/identityLogin.js';
import { MDM_LOGIN_ENTITY_TYPE, MDM_LOGIN_NAMESPACE } from '/_102034_/l1/mdm/layer_3_usecases/identityUsecases.js';
import { MDM_ORGANIZATION_MODULE_ID } from '/_102034_/l1/mdm/module.js';

const TEXT: Record<DraftDataLang, {
  failed: string;
  missing: string;
  incomplete: string;
  otherEnd: string;
  draftCompany: string;
  notConfigured: string;
}> = {
  en: {
    failed: 'Could not copy the login into the draft',
    missing: 'This login is not in the app database',
    incomplete: 'The login in the app database is incomplete',
    otherEnd: 'The login link is missing the other end',
    draftCompany: 'The draft organization company is missing',
    notConfigured: 'The draft database is not configured on this server',
  },
  pt: {
    failed: 'Não foi possível copiar o login para o rascunho',
    missing: 'Este login não está no banco do aplicativo',
    incomplete: 'O login no banco do aplicativo está incompleto',
    otherEnd: 'Falta a outra ponta do vínculo do login',
    draftCompany: 'Falta a empresa da organização no rascunho',
    notConfigured: 'O banco do rascunho não está configurado neste servidor',
  },
  es: {
    failed: 'No se pudo copiar el inicio de sesión al borrador',
    missing: 'Este inicio de sesión no está en la base de la aplicación',
    incomplete: 'El inicio de sesión en la base de la aplicación está incompleto',
    otherEnd: 'Falta el otro extremo del vínculo del inicio de sesión',
    draftCompany: 'Falta la empresa de la organización en el borrador',
    notConfigured: 'La base del borrador no está configurada en este servidor',
  },
};

export function draftLoginCopyText(key: keyof (typeof TEXT)['en'], lang: DraftDataLang = 'en'): string {
  return TEXT[lang][key];
}

export class DraftLoginCopyError extends Error {
  readonly code = 'DRAFT_LOGIN_COPY';

  constructor(message: string) {
    super(message);
    this.name = 'DraftLoginCopyError';
  }
}

export interface Sql {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface DraftLoginTagRow {
  id: string;
  entityType: string;
  entityId: string;
  tag: string;
  namespace: string | null;
  module: string;
  createdBy: string;
  createdByType: string;
  createdAt: unknown;
}

export interface DraftLoginIndexRow {
  mdmId: string;
  subtype: string;
  name: string;
  status: string;
  docType: string | null;
  docId: string | null;
  countryCode: string;
  tags: unknown;
  searchVector: string;
  mergedInto: string | null;
  dynamoPk: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface DraftLoginDocumentRow {
  mdmId: string;
  version: number;
  details: unknown;
}

export interface DraftLoginRelationshipRow {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  role: string | null;
  metadata: unknown;
  isBidirectional: boolean;
  validFrom: unknown;
  validTo: unknown;
  status: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface DraftLoginReservation {
  organizationKey: string;
  companyMdmId: string;
}

export interface DraftLoginLoaded {
  email: string;
  login: DraftLoginTagRow | null;
  indexes: ReadonlyMap<string, DraftLoginIndexRow>;
  documents: ReadonlyMap<string, DraftLoginDocumentRow>;
  relationships: readonly DraftLoginRelationshipRow[];
  sourceReservations: readonly DraftLoginReservation[];
  draftReservations: readonly DraftLoginReservation[];
  draftIndexIds: ReadonlySet<string>;
}

export interface DraftLoginPlan {
  tags: DraftLoginTagRow[];
  indexes: DraftLoginIndexRow[];
  documents: DraftLoginDocumentRow[];
  relationships: DraftLoginRelationshipRow[];
}

export interface DraftLoginCopyInput {
  sourceName: DraftDataSourceName;
  email: string;
  draftKey: string;
  generation: string;
  lang?: DraftDataLang;
  from: Sql;
  to: Sql;
  load?: (from: Sql, to: Sql, email: string, lang: DraftDataLang) => Promise<DraftLoginLoaded>;
  write?: (to: Sql, plan: DraftLoginPlan) => Promise<void>;
}

export interface DraftLoginEntry {
  base: string;
  slug: string;
  projectId: number;
  email: string;
  lang: DraftDataLang;
  waitUntilReady: () => Promise<boolean>;
  parentDatabaseUrl?: string;
}

export type DraftLoginEntryResult =
  | { ok: true; copied: boolean }
  | { ok: false; reason: 'not-ready' };

const copiedLogins = new Set<string>();
/** Login missing at the origin. Not the done set: the next draftEnter drops it, a new data.json `at` does not. */
const absentLogins = new Set<string>();
/** One warning per draft, generation and login. A later draftEnter does not warn again for the same generation. */
const absentWarnings = new Set<string>();

function memoryKey(draftKey: string, generation: string, email: string): string {
  return `${draftKey}\0${generation}\0${email}`;
}

function absentKey(draftKey: string, email: string): string {
  return `${draftKey}\0${email}`;
}

/** Drops every remembered login for this draft. A new data.json `at` also misses the key. */
export function forgetDraftLoginCopy(draftKey: string): void {
  const prefix = `${draftKey}\0`;
  for (const key of copiedLogins) {
    if (key.startsWith(prefix)) copiedLogins.delete(key);
  }
}

/** Drops only the "missing at the origin" memory for this draft. The done set stays. */
export function forgetDraftLoginAbsent(draftKey: string): void {
  const prefix = `${draftKey}\0`;
  for (const key of absentLogins) {
    if (key.startsWith(prefix)) absentLogins.delete(key);
  }
}

function rememberAbsent(draftKey: string, generation: string, email: string, lang: DraftDataLang): void {
  const warnKey = memoryKey(draftKey, generation, email);
  if (!absentWarnings.has(warnKey)) {
    absentWarnings.add(warnKey);
    console.warn(`[cbe] draft login copy: ${draftLoginCopyText('missing', lang)}`);
  }
  absentLogins.add(absentKey(draftKey, email));
}

function scrub(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/postgres:\/\/\S+/giu, 'postgres://***').replace(/\s+/gu, ' ').slice(0, 180);
}

function fail(key: keyof (typeof TEXT)['en'], lang: DraftDataLang, detail?: string): never {
  const message = detail ? `${draftLoginCopyText(key, lang)} (${detail})` : draftLoginCopyText(key, lang);
  console.error(`[cbe] draft login copy: ${message}`);
  throw new DraftLoginCopyError(message);
}

function safeId(value: string): string {
  return value.slice(0, 80).replace(/[^A-Za-z0-9_.:-]/gu, '?');
}

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
    throw new Error(`invalid sql identifier: ${name}`);
  }
  return `"${name}"`;
}

function requiredString(row: Record<string, unknown>, key: string, lang: DraftDataLang): string {
  const value = row[key];
  if (typeof value !== 'string' || value === '') fail('incomplete', lang, key);
  return value;
}

function nullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  return value;
}

function tagFrom(row: Record<string, unknown>, lang: DraftDataLang): DraftLoginTagRow {
  return {
    id: requiredString(row, 'id', lang),
    entityType: requiredString(row, 'entityType', lang),
    entityId: requiredString(row, 'entityId', lang),
    tag: requiredString(row, 'tag', lang),
    namespace: nullableString(row, 'namespace'),
    module: requiredString(row, 'module', lang),
    createdBy: requiredString(row, 'createdBy', lang),
    createdByType: requiredString(row, 'createdByType', lang),
    createdAt: row.createdAt,
  };
}

function indexFrom(row: Record<string, unknown>, lang: DraftDataLang): DraftLoginIndexRow {
  return {
    mdmId: requiredString(row, 'mdmId', lang),
    subtype: requiredString(row, 'subtype', lang),
    name: requiredString(row, 'name', lang),
    status: requiredString(row, 'status', lang),
    docType: nullableString(row, 'docType'),
    docId: nullableString(row, 'docId'),
    countryCode: requiredString(row, 'countryCode', lang),
    tags: row.tags ?? [],
    searchVector: typeof row.searchVector === 'string' ? row.searchVector : '',
    mergedInto: nullableString(row, 'mergedInto'),
    dynamoPk: requiredString(row, 'dynamoPk', lang),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function documentFrom(row: Record<string, unknown>, lang: DraftDataLang): DraftLoginDocumentRow {
  const raw = row.version;
  const version = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/u.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(version)) fail('incomplete', lang, 'version');
  return { mdmId: requiredString(row, 'mdmId', lang), version, details: row.details ?? null };
}

function relationshipFrom(row: Record<string, unknown>, lang: DraftDataLang): DraftLoginRelationshipRow {
  return {
    id: requiredString(row, 'id', lang),
    fromId: requiredString(row, 'fromId', lang),
    toId: requiredString(row, 'toId', lang),
    type: requiredString(row, 'type', lang),
    role: nullableString(row, 'role'),
    metadata: row.metadata ?? {},
    isBidirectional: row.isBidirectional === true,
    validFrom: row.validFrom,
    validTo: row.validTo ?? null,
    status: requiredString(row, 'status', lang),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function reservationFrom(value: unknown, lang: DraftDataLang): DraftLoginReservation | null {
  let body = value;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body) as unknown;
    } catch (err) {
      fail('incomplete', lang, `mdm_kv ${scrub(err)}`);
    }
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const row = body as Record<string, unknown>;
  if (row.kind !== 'organization') return null;
  if (typeof row.organizationKey !== 'string' || row.organizationKey === '') fail('incomplete', lang, 'organizationKey');
  if (typeof row.companyMdmId !== 'string' || row.companyMdmId === '') fail('incomplete', lang, 'companyMdmId');
  return { organizationKey: row.organizationKey, companyMdmId: row.companyMdmId };
}

const TAG_COLUMNS = ['id', 'entityType', 'entityId', 'tag', 'namespace', 'module', 'createdBy', 'createdByType', 'createdAt'] as const;
const INDEX_COLUMNS = ['mdmId', 'subtype', 'name', 'status', 'docType', 'docId', 'countryCode', 'tags', 'searchVector', 'mergedInto', 'dynamoPk', 'createdAt', 'updatedAt'] as const;
const DOCUMENT_COLUMNS = ['mdmId', 'version', 'details'] as const;
const RELATIONSHIP_COLUMNS = ['id', 'fromId', 'toId', 'type', 'role', 'metadata', 'isBidirectional', 'validFrom', 'validTo', 'status', 'createdAt', 'updatedAt'] as const;
const JSONB_COLUMNS = new Set<string>(['details', 'metadata']);

function placeholder(column: string, index: number): string {
  if (JSONB_COLUMNS.has(column)) return `$${index}::jsonb`;
  if (column === 'tags') return `$${index}::text[]`;
  return `$${index}`;
}

async function insertMissing(sql: Sql, table: string, columns: readonly string[], rows: readonly object[]): Promise<void> {
  if (rows.length === 0) return;
  const columnSql = columns.map((column) => quoteIdent(column)).join(', ');
  const valuesSql = columns.map((column, index) => placeholder(column, index + 1)).join(', ');
  const statement = `INSERT INTO ${quoteIdent(table)} (${columnSql}) VALUES (${valuesSql}) ON CONFLICT DO NOTHING`;
  for (const row of rows) {
    const record = row as unknown as Record<string, unknown>;
    const params = columns.map((column) => record[column] ?? null);
    await sql.query(statement, params);
  }
}

/** Inserts the plan. A failure rolls the draft transaction back; nothing is updated. */
export async function writeDraftLoginPlan(sql: Sql, plan: DraftLoginPlan): Promise<void> {
  await sql.query('BEGIN');
  try {
    await insertMissing(sql, 'mdm_documents_entities_index', INDEX_COLUMNS, plan.indexes);
    await insertMissing(sql, 'mdm_documents', DOCUMENT_COLUMNS, plan.documents);
    await insertMissing(sql, 'mdm_tag', TAG_COLUMNS, plan.tags);
    await insertMissing(sql, 'mdm_relationship', RELATIONSHIP_COLUMNS, plan.relationships);
    await sql.query('COMMIT');
  } catch (err) {
    try {
      await sql.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error(`[cbe] draft login copy rollback failed: ${scrub(rollbackErr)}`);
    }
    throw err;
  }
}

function companyRemap(
  source: readonly DraftLoginReservation[],
  draft: readonly DraftLoginReservation[],
): Map<string, string> {
  const draftByKey = new Map<string, string>();
  for (const row of draft) draftByKey.set(row.organizationKey, row.companyMdmId);
  const map = new Map<string, string>();
  for (const row of source) {
    const dest = draftByKey.get(row.organizationKey);
    if (dest && dest !== row.companyMdmId) map.set(row.companyMdmId, dest);
  }
  return map;
}

/** Rows to insert. The organization company already created by boot is not inserted again. */
export function planDraftLoginCopy(loaded: DraftLoginLoaded, lang: DraftDataLang = 'en'): DraftLoginPlan {
  if (!loaded.login) fail('missing', lang);
  const login = loaded.login;
  const personId = login.entityId;
  const remap = companyRemap(loaded.sourceReservations, loaded.draftReservations);
  for (const dest of remap.values()) {
    if (!loaded.draftIndexIds.has(dest)) fail('draftCompany', lang, safeId(dest));
  }

  const otherIds: string[] = [];
  const seen = new Set<string>();
  const relationships: DraftLoginRelationshipRow[] = [];
  for (const rel of loaded.relationships) {
    if (rel.fromId !== personId && rel.toId !== personId) continue;
    relationships.push({
      ...rel,
      fromId: remap.get(rel.fromId) ?? rel.fromId,
      toId: remap.get(rel.toId) ?? rel.toId,
    });
    for (const end of [rel.fromId, rel.toId]) {
      if (end === personId || remap.has(end) || seen.has(end)) continue;
      seen.add(end);
      otherIds.push(end);
    }
  }

  const personIndex = loaded.indexes.get(personId);
  if (!personIndex) fail('incomplete', lang, 'mdm_documents_entities_index');
  const personDocument = loaded.documents.get(personId);
  if (!personDocument) fail('incomplete', lang, 'mdm_documents');

  const indexes = [personIndex];
  const documents = [personDocument];
  for (const id of otherIds) {
    const index = loaded.indexes.get(id);
    const document = loaded.documents.get(id);
    if (!index || !document) fail('otherEnd', lang, safeId(id));
    indexes.push(index);
    documents.push(document);
  }

  return {
    tags: [{ ...login, tag: loaded.email }],
    indexes,
    documents,
    relationships,
  };
}

const SELECT_TAG = `SELECT "id", "entityType", "entityId", tag, namespace, module, "createdBy", "createdByType", "createdAt"
  FROM "mdm_tag"
  WHERE "entityType" = $1 AND lower(tag) = $2 AND module = $3 AND namespace = $4
  LIMIT 2`;

const SELECT_INDEX = `SELECT "mdmId", subtype, name, status, "docType", "docId", "countryCode", tags, "searchVector", "mergedInto", "dynamoPk", "createdAt", "updatedAt"
  FROM "mdm_documents_entities_index" WHERE "mdmId" = ANY($1::text[])`;

const SELECT_DOCUMENT = `SELECT "mdmId", version, details FROM "mdm_documents" WHERE "mdmId" = ANY($1::text[])`;

const SELECT_RELATIONSHIP = `SELECT "id", "fromId", "toId", type, role, metadata, "isBidirectional", "validFrom", "validTo", status, "createdAt", "updatedAt"
  FROM "mdm_relationship" WHERE "fromId" = $1 OR "toId" = $1`;

const SELECT_KV = `SELECT key, value FROM "mdm_kv" WHERE key LIKE 'runtime.onboarding/org/%'`;

const SELECT_DRAFT_IDS = `SELECT "mdmId" FROM "mdm_documents_entities_index" WHERE "mdmId" = ANY($1::text[])`;

async function reservationsOf(sql: Sql, lang: DraftDataLang): Promise<DraftLoginReservation[]> {
  const result = await sql.query<{ value: unknown }>(SELECT_KV);
  const rows: DraftLoginReservation[] = [];
  for (const row of result.rows) {
    const reservation = reservationFrom(row.value, lang);
    if (reservation) rows.push(reservation);
  }
  return rows;
}

async function rowsById<T extends { mdmId: string }>(
  sql: Sql,
  statement: string,
  ids: readonly string[],
  map: (row: Record<string, unknown>) => T,
): Promise<Map<string, T>> {
  const found = new Map<string, T>();
  if (ids.length === 0) return found;
  const result = await sql.query(statement, [ids]);
  for (const row of result.rows) {
    const mapped = map(row);
    found.set(mapped.mdmId, mapped);
  }
  return found;
}

export async function loadDraftLogin(from: Sql, to: Sql, email: string, lang: DraftDataLang): Promise<DraftLoginLoaded> {
  const tags = await from.query(SELECT_TAG, [MDM_LOGIN_ENTITY_TYPE, email, MDM_ORGANIZATION_MODULE_ID, MDM_LOGIN_NAMESPACE]);
  if (tags.rows.length > 1) {
    console.error('[cbe] draft login copy: more than one login row; copying the first');
  }
  const login = tags.rows[0] ? tagFrom(tags.rows[0], lang) : null;
  if (!login) {
    return {
      email,
      login: null,
      indexes: new Map(),
      documents: new Map(),
      relationships: [],
      sourceReservations: [],
      draftReservations: [],
      draftIndexIds: new Set(),
    };
  }

  const relationshipRows = await from.query(SELECT_RELATIONSHIP, [login.entityId]);
  const relationships = relationshipRows.rows.map((row) => relationshipFrom(row, lang));
  const sourceReservations = await reservationsOf(from, lang);
  const draftReservations = await reservationsOf(to, lang);
  const remap = companyRemap(sourceReservations, draftReservations);
  const sourceIds = [login.entityId];
  for (const rel of relationships) {
    for (const end of [rel.fromId, rel.toId]) {
      if (end !== login.entityId && !remap.has(end) && !sourceIds.includes(end)) sourceIds.push(end);
    }
  }
  const indexes = await rowsById(from, SELECT_INDEX, sourceIds, (row) => indexFrom(row, lang));
  const documents = await rowsById(from, SELECT_DOCUMENT, sourceIds, (row) => documentFrom(row, lang));
  const draftIds = [...remap.values()];
  const draftIndexIds = new Set<string>();
  if (draftIds.length > 0) {
    const present = await to.query<{ mdmId: string }>(SELECT_DRAFT_IDS, [draftIds]);
    for (const row of present.rows) {
      if (typeof row.mdmId === 'string') draftIndexIds.add(row.mdmId);
    }
  }
  return { email, login, indexes, documents, relationships, sourceReservations, draftReservations, draftIndexIds };
}

function asCopyError(err: unknown, lang: DraftDataLang): DraftLoginCopyError {
  if (err instanceof DraftLoginCopyError) return err;
  const cause = scrub(err);
  console.error(`[cbe] draft login copy failed: ${cause}`);
  return new DraftLoginCopyError(`${draftLoginCopyText('failed', lang)} (${cause})`);
}

export async function copyDraftLogin(input: DraftLoginCopyInput): Promise<{ copied: boolean }> {
  const lang = input.lang ?? 'en';
  if (input.sourceName === 'readonly' || input.sourceName === 'same') return { copied: false };
  if (absentLogins.has(absentKey(input.draftKey, input.email))) return { copied: false };
  let email: string;
  try {
    email = assertLoginEmail(input.email);
  } catch (err) {
    console.error(`[cbe] draft login copy refused: ${scrub(err)}`);
    absentLogins.add(absentKey(input.draftKey, input.email));
    return { copied: false };
  }
  const key = memoryKey(input.draftKey, input.generation, email);
  if (copiedLogins.has(key)) return { copied: false };
  if (absentLogins.has(absentKey(input.draftKey, email))) return { copied: false };
  const load = input.load ?? loadDraftLogin;
  const write = input.write ?? writeDraftLoginPlan;
  let loaded: DraftLoginLoaded;
  try {
    loaded = await load(input.from, input.to, email, lang);
  } catch (err) {
    throw asCopyError(err, lang);
  }
  if (!loaded.login) {
    rememberAbsent(input.draftKey, input.generation, email, lang);
    return { copied: false };
  }
  const plan = planDraftLoginCopy({ ...loaded, email }, lang);
  try {
    await write(input.to, plan);
  } catch (err) {
    throw asCopyError(err, lang);
  }
  copiedLogins.add(key);
  return { copied: true };
}

function asSql(client: Client): Sql & { close(): Promise<void> } {
  return {
    query: async <T extends Record<string, unknown>>(text: string, params?: unknown[]) => {
      const result = await client.query<T>(text, params);
      return { rows: result.rows };
    },
    close: async () => {
      await client.end();
    },
  };
}

async function openSql(url: string): Promise<Sql & { close(): Promise<void> }> {
  const client = new Client({ connectionString: url });
  await client.connect();
  return asSql(client);
}

/**
 * After the draft child is ready: copy this login from the app database into the draft database.
 * `readonly` and `same` do nothing. A login already copied for this data.json generation does nothing.
 * A login missing at the origin does nothing until the next draftEnter.
 */
export async function ensureDraftLoginCopied(input: DraftLoginEntry): Promise<DraftLoginEntryResult> {
  const lang = input.lang;
  let state: ReturnType<typeof readDraftData>;
  try {
    state = readDraftData(draftDirOf(input.base, input.slug), lang);
  } catch (err) {
    throw asCopyError(err, lang);
  }
  if (state.source === 'readonly' || state.source === 'same') return { ok: true, copied: false };
  const draftKey = draftDirOf(input.base, input.slug);
  const generation = state.at ?? '';
  if (absentLogins.has(absentKey(draftKey, input.email))) return { ok: true, copied: false };
  let email: string;
  try {
    email = assertLoginEmail(input.email);
  } catch (err) {
    console.error(`[cbe] draft login copy refused: ${scrub(err)}`);
    absentLogins.add(absentKey(draftKey, input.email));
    return { ok: true, copied: false };
  }
  if (copiedLogins.has(memoryKey(draftKey, generation, email))) return { ok: true, copied: false };
  if (absentLogins.has(absentKey(draftKey, email))) return { ok: true, copied: false };

  let ready = false;
  try {
    ready = await input.waitUntilReady();
  } catch (err) {
    console.error(`[cbe] draft ${input.slug} login copy ready check failed: ${scrub(err)}`);
    return { ok: false, reason: 'not-ready' };
  }
  if (!ready) return { ok: false, reason: 'not-ready' };

  const parentUrl = input.parentDatabaseUrl ?? process.env.DATABASE_URL_TEST ?? '';
  if (!parentUrl) fail('notConfigured', lang);
  let draftUrl: string;
  try {
    draftUrl = draftDatabaseUrl(parentUrl, input.slug, input.projectId);
  } catch (err) {
    throw asCopyError(err, lang);
  }

  let from: Sql & { close(): Promise<void> } | undefined;
  let to: Sql & { close(): Promise<void> } | undefined;
  try {
    from = await openSql(parentUrl);
    to = await openSql(draftUrl);
    const result = await copyDraftLogin({
      sourceName: state.source,
      email,
      draftKey,
      generation,
      lang,
      from,
      to,
    });
    if (result.copied) console.info(`[cbe] draft ${input.slug} login copy ok`);
    return { ok: true, copied: result.copied };
  } catch (err) {
    throw asCopyError(err, lang);
  } finally {
    await to?.close().catch((err: unknown) => {
      console.error(`[cbe] draft login copy close failed: ${scrub(err)}`);
    });
    await from?.close().catch((err: unknown) => {
      console.error(`[cbe] draft login copy close failed: ${scrub(err)}`);
    });
  }
}
