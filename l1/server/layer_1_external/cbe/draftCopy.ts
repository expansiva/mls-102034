/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/draftCopy.ts" enhancement="_blank" />
// Copy app data into the draft database after the draft schema is already applied.
// Data only: pg_dump / pg_restore. A column mismatch or a failed restore names the table,
// drops the draft database and leaves the source as seed.

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { moduleTableNamespacePrefix } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import { appendDraftDataLog, writeDraftData, type DraftDataLang } from '/_102034_/l1/server/layer_1_external/cbe/draftDataSource.js';
import { forgetDraftLoginCopy } from '/_102034_/l1/server/layer_1_external/cbe/draftLoginCopy.js';

const execFileAsync = promisify(execFile);

/** Registry rows the person can include: documents, indexes, tags and relationships. */
export const DRAFT_COPY_REGISTRY = [
  'mdm_documents',
  'mdm_documents_entities_index',
  'mdm_documents_prospects_index',
  'mdm_relationship',
  'mdm_prospect_relationship',
  'mdm_tag',
] as const;

const REGISTRY = new Set<string>(DRAFT_COPY_REGISTRY);

const EXCLUDED = new Set<string>([
  'mdm_outbox',
  'mdm_audit_log',
  'mdm_monitoring_write',
  '_schema_migrations',
  '_schema_module_state',
  'platform_schema_snapshot_log',
]);

const MODULE_ID = /^[A-Za-z][A-Za-z0-9]*$/u;
const IDENT = /^[a-z_][a-z0-9_]*$/u;
const COPY_TIMEOUT_MS = 120_000;

const TEXT: Record<DraftDataLang, {
  column: string;
  missing: string;
  failed: string;
  empty: string;
  notConfigured: string;
  badModules: string;
}> = {
  en: {
    column: 'The table columns do not match the draft',
    missing: 'The table is missing',
    failed: 'Could not copy the app data into the draft',
    empty: 'There are no tables to copy',
    notConfigured: 'The app database is not configured on this server',
    badModules: 'The module list is invalid',
  },
  pt: {
    column: 'As colunas da tabela não coincidem com o rascunho',
    missing: 'A tabela não existe',
    failed: 'Não foi possível copiar os dados do aplicativo para o rascunho',
    empty: 'Não há tabelas para copiar',
    notConfigured: 'O banco do aplicativo não está configurado neste servidor',
    badModules: 'A lista de módulos é inválida',
  },
  es: {
    column: 'Las columnas de la tabla no coinciden con el borrador',
    missing: 'La tabla no existe',
    failed: 'No se pudieron copiar los datos de la aplicación al borrador',
    empty: 'No hay tablas para copiar',
    notConfigured: 'La base de la aplicación no está configurada en este servidor',
    badModules: 'La lista de módulos no es válida',
  },
};

export function draftCopyText(key: keyof (typeof TEXT)['en'], lang: DraftDataLang = 'en'): string {
  return TEXT[lang][key];
}

export class DraftCopyError extends Error {
  readonly code = 'DRAFT_COPY';
  readonly table: string | null;

  constructor(message: string, table: string | null = null) {
    super(message);
    this.name = 'DraftCopyError';
    this.table = table;
  }
}

export function isDraftCopyModuleId(value: string): boolean {
  return MODULE_ID.test(value);
}

/** True for monitor tables, schema snapshot/hash tables, and the registry tables that stay out. */
export function isDraftCopyExcluded(name: string): boolean {
  return EXCLUDED.has(name) || name.startsWith('monitor_') || name.startsWith('_schema_') || name.startsWith('platform_schema_');
}

/**
 * Tables to copy.
 * No `modules`: every business table of this project plus the registry.
 * With `modules`: only those modules; the registry only when `withRegistry` is true.
 */
export function draftCopyTables(input: {
  projectId: number;
  tables: readonly string[];
  modules?: readonly string[];
  withRegistry?: boolean;
}): string[] {
  const projectPrefix = `mls${input.projectId}_`;
  const selected = input.modules?.map((moduleId) => moduleTableNamespacePrefix(moduleId)) ?? null;
  const includeRegistry = selected === null || input.withRegistry === true;
  const chosen: string[] = [];
  for (const name of input.tables) {
    if (!IDENT.test(name)) {
      console.error(`[cbe] draft copy: skipped table with an unsafe name: ${name}`);
      continue;
    }
    if (isDraftCopyExcluded(name)) continue;
    if (REGISTRY.has(name)) {
      if (includeRegistry) chosen.push(name);
      continue;
    }
    if (!name.startsWith(projectPrefix)) continue;
    const rest = name.slice(projectPrefix.length);
    if (selected === null) {
      chosen.push(name);
      continue;
    }
    if (selected.some((prefix) => prefix !== '' && rest.startsWith(prefix))) chosen.push(name);
  }
  return [...new Set(chosen)].sort((left, right) => left.localeCompare(right));
}

export interface DraftCopyColumn {
  name: string;
  type: string;
}

export interface DraftCopySpawnResult {
  code: number;
  stderr: string;
}

export const draftCopyIo = {
  tables: listPublicTables,
  columns: listColumns,
  query: execSql,
  spawn: spawnCommand,
};

export interface PerformDraftCopyInput {
  sourceUrl: string;
  targetUrl: string;
  projectId: number;
  modules?: string[];
  withRegistry?: boolean;
  draftDir: string;
  by: string;
  lang: DraftDataLang;
  adminUrl: string;
  database: string;
  dropDatabase: (adminUrl: string, database: string) => Promise<void>;
  start: () => void;
  /** Tests pass a stand-in. The route uses `draftCopyIo`. */
  io?: Pick<typeof draftCopyIo, 'tables' | 'columns' | 'query' | 'spawn'>;
}

export type PerformDraftCopyResult =
  | { ok: true; tables: string[] }
  | { ok: false; msg: string; table: string | null; seeded: boolean };

function scrub(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/postgres:\/\/\S+/giu, 'postgres://***').replace(/\s+/gu, ' ').slice(0, 240);
}

function fail(key: keyof (typeof TEXT)['en'], lang: DraftDataLang, table: string | null, detail?: string): never {
  const base = table ? `${draftCopyText(key, lang)} (${table})` : draftCopyText(key, lang);
  const message = detail ? `${base} (${detail})` : base;
  console.error(`[cbe] draft copy: ${message}`);
  throw new DraftCopyError(message, table);
}

function quoteIdent(name: string): string {
  if (!IDENT.test(name)) throw new DraftCopyError(`invalid sql identifier: ${name}`, name);
  return `"${name}"`;
}

function sameColumns(left: readonly DraftCopyColumn[], right: readonly DraftCopyColumn[]): boolean {
  if (left.length !== right.length || left.length === 0) return false;
  return left.every((column, index) => column.name === right[index]?.name && column.type === right[index]?.type);
}

function tableInText(text: string, tables: readonly string[]): string | null {
  const found = tables.filter((table) => text.includes(table));
  found.sort((left, right) => right.length - left.length);
  return found[0] ?? null;
}

function pgEnv(url: string): NodeJS.ProcessEnv {
  const parsed = new URL(url);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  if (!database) throw new Error('invalid database url');
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.PGHOST = parsed.hostname;
  env.PGPORT = parsed.port || '5432';
  env.PGUSER = decodeURIComponent(parsed.username);
  env.PGDATABASE = database;
  if (parsed.password) env.PGPASSWORD = decodeURIComponent(parsed.password);
  else delete env.PGPASSWORD;
  const sslmode = parsed.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  delete env.DATABASE_URL;
  delete env.DATABASE_URL_TEST;
  return env;
}

async function withClient<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function listPublicTables(url: string): Promise<string[]> {
  return withClient(url, async (client) => {
    const result = await client.query<{ name: string }>(
      `SELECT c.relname AS name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       ORDER BY c.relname`,
    );
    return result.rows.map((row) => row.name);
  });
}

async function listColumns(url: string, table: string): Promise<DraftCopyColumn[]> {
  if (!IDENT.test(table)) return [];
  return withClient(url, async (client) => {
    const result = await client.query<{ name: string; type: string }>(
      `SELECT a.attname AS name, t.typname AS type
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_type t ON t.oid = a.atttypid
       WHERE n.nspname = 'public' AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attnum`,
      [table],
    );
    return result.rows;
  });
}

async function execSql(url: string, text: string): Promise<void> {
  await withClient(url, async (client) => {
    await client.query(text);
  });
}

async function spawnCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<DraftCopySpawnResult> {
  try {
    const result = await execFileAsync(command, args, { env, timeout: COPY_TIMEOUT_MS, maxBuffer: 4_000_000 });
    return { code: 0, stderr: result.stderr ?? '' };
  } catch (err) {
    const error = err as { code?: number | string; stderr?: string; message?: string };
    const stderr = typeof error.stderr === 'string' && error.stderr.trim() ? error.stderr : (error.message ?? String(err));
    return { code: typeof error.code === 'number' ? error.code : 1, stderr };
  }
}

async function copyTables(input: {
  sourceUrl: string;
  targetUrl: string;
  tables: readonly string[];
  lang: DraftDataLang;
  io: Pick<typeof draftCopyIo, 'columns' | 'query' | 'spawn'>;
}): Promise<void> {
  for (const table of input.tables) {
    if (!IDENT.test(table)) fail('failed', input.lang, table, 'invalid table name');
    let sourceColumns: DraftCopyColumn[];
    let targetColumns: DraftCopyColumn[];
    try {
      sourceColumns = await input.io.columns(input.sourceUrl, table);
      targetColumns = await input.io.columns(input.targetUrl, table);
    } catch (err) {
      fail('failed', input.lang, table, scrub(err));
    }
    if (sourceColumns.length === 0 || targetColumns.length === 0) fail('missing', input.lang, table);
    if (!sameColumns(sourceColumns, targetColumns)) fail('column', input.lang, table);
  }
  const quoted = input.tables.map((table) => quoteIdent(table)).join(', ');
  try {
    await input.io.query(input.targetUrl, `TRUNCATE TABLE ${quoted} RESTART IDENTITY`);
  } catch (err) {
    fail('failed', input.lang, tableInText(scrub(err), input.tables), scrub(err));
  }
  const dir = mkdtempSync(join(tmpdir(), 'draft-copy-'));
  const dumpPath = join(dir, 'data.dump');
  try {
    const dumped = await input.io.spawn(
      'pg_dump',
      ['--format=custom', '--data-only', '--no-owner', '--no-acl', '--file', dumpPath, ...input.tables.flatMap((table) => ['--table', table])],
      pgEnv(input.sourceUrl),
    );
    if (dumped.code !== 0) {
      const detail = scrub(dumped.stderr);
      fail('failed', input.lang, tableInText(detail, input.tables), detail);
    }
    const restored = await input.io.spawn(
      'pg_restore',
      ['--data-only', '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', '--dbname', pgEnv(input.targetUrl).PGDATABASE ?? '', dumpPath],
      pgEnv(input.targetUrl),
    );
    if (restored.code !== 0) {
      const detail = scrub(restored.stderr);
      fail('failed', input.lang, tableInText(detail, input.tables), detail);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function remember(draftDir: string, source: 'copy' | 'seed', by: string, modules: string[] | undefined, withRegistry: boolean | undefined, result: 'ok' | 'failed', cause?: string): string {
  const at = new Date().toISOString();
  writeDraftData(draftDir, {
    source,
    at,
    by,
    ...(modules && modules.length > 0 ? { modules } : {}),
    ...(withRegistry !== undefined ? { withRegistry } : {}),
  });
  appendDraftDataLog(draftDir, {
    at,
    by,
    action: 'copy',
    result,
    source,
    ...(cause ? { cause } : {}),
  });
  forgetDraftLoginCopy(draftDir);
  return at;
}

/**
 * Copies, or on failure drops the draft database and records `seed`.
 * `start` runs after the source file is written so the child sees the source that was just saved.
 */
export async function performDraftCopy(input: PerformDraftCopyInput): Promise<PerformDraftCopyResult> {
  const lang = input.lang;
  const io = input.io ?? draftCopyIo;
  let tables: string[] = [];
  try {
    const present = await io.tables(input.targetUrl);
    tables = draftCopyTables({
      projectId: input.projectId,
      tables: present,
      ...(input.modules ? { modules: input.modules } : {}),
      ...(input.withRegistry !== undefined ? { withRegistry: input.withRegistry } : {}),
    });
    if (tables.length === 0) fail('empty', lang, null);
    await copyTables({ sourceUrl: input.sourceUrl, targetUrl: input.targetUrl, tables, lang, io });
    const withRegistry = input.modules ? input.withRegistry === true : undefined;
    remember(input.draftDir, 'copy', input.by, input.modules, withRegistry, 'ok');
  } catch (err) {
    const copyError = err instanceof DraftCopyError ? err : new DraftCopyError(`${draftCopyText('failed', lang)} (${scrub(err)})`);
    if (!(err instanceof DraftCopyError)) console.error(`[cbe] draft copy: ${copyError.message}`);
    let seeded = false;
    try {
      await input.dropDatabase(input.adminUrl, input.database);
      remember(input.draftDir, 'seed', input.by, undefined, undefined, 'failed', copyError.message);
      seeded = true;
    } catch (dropErr) {
      const cause = scrub(dropErr);
      console.error(`[cbe] draft copy: returning the draft database to seed failed: ${cause}`);
      try {
        appendDraftDataLog(input.draftDir, {
          at: new Date().toISOString(),
          by: input.by,
          action: 'copy',
          result: 'failed',
          cause: `${copyError.message}; ${cause}`,
        });
      } catch (logErr) {
        console.error(`[cbe] draft copy: record failed copy: ${scrub(logErr)}`);
      }
      forgetDraftLoginCopy(input.draftDir);
      return { ok: false, msg: copyError.message, table: copyError.table, seeded: false };
    }
    try {
      input.start();
    } catch (startErr) {
      console.error(`[cbe] draft copy: start after seed failed: ${scrub(startErr)}`);
    }
    return { ok: false, msg: copyError.message, table: copyError.table, seeded };
  }
  try {
    input.start();
  } catch (startErr) {
    const cause = scrub(startErr);
    console.error(`[cbe] draft copy: start after copy failed: ${cause}`);
    return { ok: false, msg: `${draftCopyText('failed', lang)} (${cause})`, table: null, seeded: false };
  }
  return { ok: true, tables };
}
