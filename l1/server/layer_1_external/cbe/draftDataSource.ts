/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/draftDataSource.ts" enhancement="_blank" />
// Draft data source, beside dev.json (survives DROP DATABASE). No file means seed.
// An unreadable or invalid file is an error — it is never treated as seed.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DRAFT_DATA_FILE = 'data.json';
export const DRAFT_DATA_LOG = 'data.log.jsonl';

export const DRAFT_DATA_SOURCES = ['seed', 'copy', 'readonly', 'same'] as const;
export type DraftDataSourceName = (typeof DRAFT_DATA_SOURCES)[number];

export const DRAFT_DATA_ACTIONS = ['view', 'reset', 'copy', 'readonly', 'sameDatabase'] as const;
export type DraftDataAction = (typeof DRAFT_DATA_ACTIONS)[number];

export type DraftDataLang = 'en' | 'pt' | 'es';

export interface DraftDataState {
  source: DraftDataSourceName;
  at: string | null;
  by: string | null;
  modules?: string[];
  withRegistry?: boolean;
}

export interface DraftDataLogEntry {
  at: string;
  by: string;
  action: string;
  result: 'ok' | 'failed';
  source?: DraftDataSourceName;
  cause?: string;
}

export class DraftDataFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DraftDataFileError';
  }
}

const TEXT: Record<DraftDataLang, { unreadable: string; invalid: string; forbidden: string }> = {
  en: {
    unreadable: 'Draft data file is unreadable',
    invalid: 'Draft data file is invalid',
    forbidden: 'You do not have permission for this draft data action',
  },
  pt: {
    unreadable: 'O arquivo de dados do rascunho não pode ser lido',
    invalid: 'O arquivo de dados do rascunho é inválido',
    forbidden: 'Você não tem permissão para esta ação de dados do rascunho',
  },
  es: {
    unreadable: 'El archivo de datos del borrador no se puede leer',
    invalid: 'El archivo de datos del borrador no es válido',
    forbidden: 'No tiene permiso para esta acción de datos del borrador',
  },
};

export function draftDataLang(header: string | undefined): DraftDataLang {
  const first = (header ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  if (first.startsWith('pt')) return 'pt';
  if (first.startsWith('es')) return 'es';
  return 'en';
}

export function draftDataText(key: keyof (typeof TEXT)['en'], lang: DraftDataLang = 'en'): string {
  return TEXT[lang][key];
}

function isSource(value: unknown): value is DraftDataSourceName {
  return typeof value === 'string' && (DRAFT_DATA_SOURCES as readonly string[]).includes(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function fail(kind: 'unreadable' | 'invalid', path: string, cause: string, lang: DraftDataLang): never {
  const message = `${draftDataText(kind, lang)} (${cause})`;
  console.error(`[cbe] draft ${DRAFT_DATA_FILE} ${kind} at ${path}: ${cause}`);
  throw new DraftDataFileError(message);
}

/** Missing file is seed. Invalid JSON or an unknown source throws; it does not become seed. */
export function readDraftData(draftDir: string, lang: DraftDataLang = 'en'): DraftDataState {
  const path = join(draftDir, DRAFT_DATA_FILE);
  if (!existsSync(path)) return { source: 'seed', at: null, by: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    fail('unreadable', path, err instanceof Error ? err.message : String(err), lang);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail('invalid', path, 'expected an object', lang);
  }
  const body = parsed as Record<string, unknown>;
  if (!isSource(body.source)) {
    fail('invalid', path, `source ${String(body.source)}`, lang);
  }
  if (body.at !== undefined && typeof body.at !== 'string') fail('invalid', path, 'at', lang);
  if (body.by !== undefined && typeof body.by !== 'string') fail('invalid', path, 'by', lang);
  if (body.modules !== undefined && !isStringList(body.modules)) fail('invalid', path, 'modules', lang);
  if (body.withRegistry !== undefined && typeof body.withRegistry !== 'boolean') {
    fail('invalid', path, 'withRegistry', lang);
  }
  return {
    source: body.source,
    at: typeof body.at === 'string' ? body.at : null,
    by: typeof body.by === 'string' ? body.by : null,
    ...(isStringList(body.modules) ? { modules: body.modules } : {}),
    ...(typeof body.withRegistry === 'boolean' ? { withRegistry: body.withRegistry } : {}),
  };
}

export function writeDraftData(draftDir: string, record: {
  source: DraftDataSourceName;
  at: string;
  by: string;
  modules?: string[];
  withRegistry?: boolean;
}): void {
  if (!isSource(record.source)) {
    const message = `${draftDataText('invalid')} (source ${String(record.source)})`;
    console.error(`[cbe] draft ${DRAFT_DATA_FILE} refused write: ${message}`);
    throw new DraftDataFileError(message);
  }
  mkdirSync(draftDir, { recursive: true });
  const body: Record<string, unknown> = { source: record.source, at: record.at, by: record.by };
  if (record.modules) body.modules = record.modules;
  if (record.withRegistry !== undefined) body.withRegistry = record.withRegistry;
  writeFileSync(join(draftDir, DRAFT_DATA_FILE), `${JSON.stringify(body)}\n`);
}

export function appendDraftDataLog(draftDir: string, entry: DraftDataLogEntry): void {
  mkdirSync(draftDir, { recursive: true });
  appendFileSync(join(draftDir, DRAFT_DATA_LOG), `${JSON.stringify(entry)}\n`);
  const who = entry.by || '(no email)';
  console.info(`[cbe] draft data ${entry.action} ${entry.result} source=${entry.source ?? '-'} by ${who} at ${entry.at}`);
}

export interface DraftDataConfig {
  alphaAllAuthorities?: unknown;
}

export type DraftDataDecision =
  | { allowed: true }
  | { allowed: false; statusCode: 403; code: 'DRAFT_DATA_FORBIDDEN'; msg: string };

/**
 * Alpha (`alphaAllAuthorities === true`) allows every action.
 * Otherwise the JWT must carry `draftData.<action>`.
 */
export function canDraftData(
  action: DraftDataAction,
  authorities: readonly string[],
  config: DraftDataConfig,
  lang: DraftDataLang = 'en',
): DraftDataDecision {
  if (config.alphaAllAuthorities === true) return { allowed: true };
  const need = `draftData.${action}`;
  if (authorities.includes(need)) return { allowed: true };
  const msg = draftDataText('forbidden', lang);
  console.error(`[cbe] draft data refused: missing ${need}`);
  return { allowed: false, statusCode: 403, code: 'DRAFT_DATA_FORBIDDEN', msg };
}
