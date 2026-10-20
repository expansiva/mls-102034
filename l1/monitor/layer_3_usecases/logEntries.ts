/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/logEntries.ts" enhancement="_blank" />
import { createHash } from 'node:crypto';
import type {
  MonitorLogApp,
  MonitorLogCursor,
  MonitorLogEntry,
  MonitorLogStream,
} from '/_102034_/l2/monitor/shared/contracts/logs.js';

export const LOG_QUERY_CURSOR_MAX_BYTES = 4096;
export const LOG_QUERY_TEXT_MAX = 500;
export const LOG_QUERY_LIMIT_DEFAULT = 100;
export const LOG_QUERY_LIMIT_MAX = 200;

const APPS = new Set<MonitorLogApp>(['msg', 'msg-worker']);
const STREAMS = new Set<MonitorLogStream>(['out', 'error']);
const INPUT_FIELDS = new Set(['app', 'stream', 'startAt', 'text', 'cursor', 'limit']);
const CURSOR_FIELDS = new Set(['v', 'app', 'stream', 'filterKey', 'sourceKey', 'offset']);

const ISO_PREFIX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})/u;
const PM2_PREFIX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/u;

export interface NormalizedLogQuery {
  app: MonitorLogApp;
  stream: MonitorLogStream;
  startAt: string | null;
  text: string | null;
  cursor: MonitorLogCursor | null;
  limit: number;
}

export interface LogQueryError {
  status: 400;
  code: 'INVALID_LOG_QUERY';
  message: string;
}

export type LogQueryValidation =
  | { ok: true; value: NormalizedLogQuery }
  | { ok: false; error: LogQueryError };

export interface LogFilterResult {
  entries: MonitorLogEntry[];
  untimedEntries: number;
}

function invalid(message: string): LogQueryValidation {
  return { ok: false, error: { status: 400, code: 'INVALID_LOG_QUERY', message } };
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month] ?? 0;
}

function utcIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  fraction: string | undefined,
  offsetMinutes: number,
): string | null {
  if (year < 1970 || year > 9999) return null;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > 14 * 60) return null;
  let millis = 0;
  if (fraction !== undefined) {
    if (!/^\d{1,9}$/u.test(fraction)) return null;
    millis = Number(fraction.slice(0, 3).padEnd(3, '0'));
  }
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, millis) - offsetMinutes * 60_000;
  if (!Number.isFinite(utc)) return null;
  return new Date(utc).toISOString();
}

function parseOffset(token: string): number | null {
  if (token === 'Z') return 0;
  const match = /^([+-])(\d{2}):(\d{2})$/u.exec(token);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
  const total = hours * 60 + minutes;
  return match[1] === '-' ? -total : total;
}

function messageStart(value: string, stampLength: number): number {
  let index = stampLength;
  if (value[index] === ':') index += 1;
  if (value[index] === ' ') index += 1;
  return index;
}

/** ISO with Z or a numeric offset. A zone-less PM2 stamp does not match. */
export function parseExplicitTimestamp(value: string): string | null {
  const match = ISO_PREFIX.exec(value);
  if (!match || match.index !== 0) return null;
  const offset = parseOffset(match[8] ?? '');
  if (offset === null) return null;
  const iso = utcIso(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
    match[7],
    offset,
  );
  if (iso === null || messageStart(value, match[0].length) !== value.length) return null;
  return iso;
}

function parseHeader(line: string): { iso: string | null; text: string } | null {
  const isoMatch = ISO_PREFIX.exec(line);
  if (isoMatch && isoMatch.index === 0) {
    const offset = parseOffset(isoMatch[8] ?? '');
    if (offset === null) return null;
    const iso = utcIso(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
      Number(isoMatch[4]),
      Number(isoMatch[5]),
      Number(isoMatch[6]),
      isoMatch[7],
      offset,
    );
    if (iso === null) return null;
    const bodyAt = messageStart(line, isoMatch[0].length);
    return { iso, text: line.slice(bodyAt) };
  }
  const pm2 = PM2_PREFIX.exec(line);
  if (!pm2 || pm2.index !== 0) return null;
  const next = line[pm2[0].length];
  if (next !== ':' && next !== undefined && next !== ' ') return null;
  const iso = utcIso(
    Number(pm2[1]),
    Number(pm2[2]),
    Number(pm2[3]),
    Number(pm2[4]),
    Number(pm2[5]),
    Number(pm2[6]),
    undefined,
    0,
  );
  if (iso === null) return null;
  return { iso, text: line.slice(messageStart(line, pm2[0].length)) };
}

interface LineSpan {
  text: string;
  start: number;
  end: number;
}

function lineSpans(raw: string): LineSpan[] {
  const bytes = Buffer.from(raw, 'utf8');
  const spans: LineSpan[] = [];
  let start = 0;
  for (let index = 0; index <= bytes.length; index += 1) {
    if (index !== bytes.length && bytes[index] !== 0x0a) continue;
    if (index === bytes.length && start === bytes.length) break;
    let contentEnd = index;
    if (contentEnd > start && bytes[contentEnd - 1] === 0x0d) contentEnd -= 1;
    spans.push({
      text: bytes.subarray(start, contentEnd).toString('utf8'),
      start,
      end: index === bytes.length ? index : index + 1,
    });
    start = index + 1;
  }
  return spans;
}

export function parseMonitorLogEntries(fileKey: string, raw: string, baseOffset = 0): MonitorLogEntry[] {
  if (fileKey.length === 0 || fileKey.includes('/') || fileKey.includes('\\') || fileKey.includes('\0')) {
    throw new Error('fileKey must be an opaque source identity');
  }
  if (!Number.isInteger(baseOffset) || baseOffset < 0) {
    throw new Error('baseOffset must be a non-negative integer');
  }
  const spans = lineSpans(raw);
  const entries: MonitorLogEntry[] = [];
  let block: { iso: string | null; lines: string[]; start: number; end: number } | null = null;

  const flush = () => {
    if (!block) return;
    const text = block.lines.join('\n');
    if (block.iso === null && text.trim().length === 0) {
      block = null;
      return;
    }
    entries.push({
      id: `${fileKey}\u001f${baseOffset + block.start}\u001f${baseOffset + block.end}`,
      timestamp: block.iso,
      text,
      truncated: false,
    });
    block = null;
  };

  for (const span of spans) {
    const header = parseHeader(span.text);
    if (header) {
      flush();
      block = { iso: header.iso, lines: [header.text], start: span.start, end: span.end };
      continue;
    }
    if (!block) {
      block = { iso: null, lines: [span.text], start: span.start, end: span.end };
      continue;
    }
    block.lines.push(span.text);
    block.end = span.end;
  }
  flush();
  return entries;
}

function textMatches(entry: MonitorLogEntry, needle: string): boolean {
  return entry.text.toLowerCase().includes(needle);
}

/** Time and text both apply before any page cut. Untimed rows stay visible only without a time filter. */
export function filterMonitorLogEntries(
  entries: readonly MonitorLogEntry[],
  filters: { startAt: string | null; text: string | null },
): LogFilterResult {
  const needle = filters.text === null ? null : filters.text.toLowerCase();
  const startAt = filters.startAt;
  const matched: MonitorLogEntry[] = [];
  let untimedEntries = 0;
  for (const entry of entries) {
    if (needle !== null && !textMatches(entry, needle)) continue;
    if (startAt !== null && entry.timestamp === null) {
      untimedEntries += 1;
      continue;
    }
    if (startAt !== null && entry.timestamp !== null && entry.timestamp < startAt) continue;
    matched.push(entry);
  }
  return { entries: matched, untimedEntries };
}

/** Keeps chronological order. The cut is the latest `limit` rows after filtering. */
export function cutLatestLogPage(entries: readonly MonitorLogEntry[], limit: number): MonitorLogEntry[] {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('limit must be a positive integer');
  }
  if (entries.length <= limit) return entries.slice();
  return entries.slice(entries.length - limit);
}

/** SHA-256 hex of the normalized filters (no page size). The cursor carries this, not the search text. */
export function filterKeyOf(startAt: string | null, text: string | null): string {
  return createHash('sha256').update(JSON.stringify([startAt, text]), 'utf8').digest('hex');
}

export function encodeMonitorLogCursor(cursor: MonitorLogCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): MonitorLogCursor | LogQueryError {
  if (Buffer.byteLength(raw, 'utf8') > LOG_QUERY_CURSOR_MAX_BYTES) {
    return { status: 400, code: 'INVALID_LOG_QUERY', message: 'cursor exceeds 4 KiB' };
  }
  let json: string;
  try {
    json = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return { status: 400, code: 'INVALID_LOG_QUERY', message: 'cursor is not valid' };
  }
  if (Buffer.byteLength(json, 'utf8') > LOG_QUERY_CURSOR_MAX_BYTES) {
    return { status: 400, code: 'INVALID_LOG_QUERY', message: 'cursor exceeds 4 KiB' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { status: 400, code: 'INVALID_LOG_QUERY', message: 'cursor is not valid' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 400, code: 'INVALID_LOG_QUERY', message: 'cursor is not valid' };
  }
  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key === 'path' || key === 'file' || key === 'filePath') {
      return { status: 400, code: 'INVALID_LOG_QUERY', message: 'cursor must not carry a file path' };
    }
    if (!CURSOR_FIELDS.has(key)) {
      return { status: 400, code: 'INVALID_LOG_QUERY', message: `unexpected cursor field ${key}` };
    }
  }
  if (record.v !== 1 || !isApp(record.app) || !isStream(record.stream)) {
    return { status: 400, code: 'INVALID_LOG_QUERY', message: 'cursor is not valid' };
  }
  if (typeof record.filterKey !== 'string' || !/^[0-9a-f]{64}$/u.test(record.filterKey)) {
    return { status: 400, code: 'INVALID_LOG_QUERY', message: 'cursor is not valid' };
  }
  if (
    typeof record.sourceKey !== 'string'
    || record.sourceKey.length === 0
    || record.sourceKey.length > 200
    || record.sourceKey.includes('/')
    || record.sourceKey.includes('\\')
    || record.sourceKey.includes('..')
  ) {
    return { status: 400, code: 'INVALID_LOG_QUERY', message: 'cursor must not carry a file path' };
  }
  if (typeof record.offset !== 'number' || !Number.isInteger(record.offset) || record.offset < 0) {
    return { status: 400, code: 'INVALID_LOG_QUERY', message: 'cursor is not valid' };
  }
  return {
    v: 1,
    app: record.app,
    stream: record.stream,
    filterKey: record.filterKey,
    sourceKey: record.sourceKey,
    offset: record.offset,
  };
}

function isApp(value: unknown): value is MonitorLogApp {
  return typeof value === 'string' && APPS.has(value as MonitorLogApp);
}

function isStream(value: unknown): value is MonitorLogStream {
  return typeof value === 'string' && STREAMS.has(value as MonitorLogStream);
}

export function validateMonitorLogPageInput(value: unknown): LogQueryValidation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('query must be an object');
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key === 'path' || key === 'file' || key === 'filePath') {
      return invalid('path is not accepted');
    }
    if (!INPUT_FIELDS.has(key)) {
      return invalid(`unexpected field ${key}`);
    }
  }
  if (!isApp(record.app)) return invalid('app must be msg or msg-worker');
  if (!isStream(record.stream)) return invalid('stream must be out or error');

  let startAt: string | null = null;
  if (record.startAt !== undefined && record.startAt !== null) {
    if (typeof record.startAt !== 'string') return invalid('startAt must be an ISO instant');
    const trimmed = record.startAt.trim();
    if (trimmed.length > 0) {
      const parsed = parseExplicitTimestamp(trimmed);
      if (parsed === null) return invalid('startAt must be an ISO instant with an explicit timezone');
      startAt = parsed;
    }
  }

  let text: string | null = null;
  if (record.text !== undefined && record.text !== null) {
    if (typeof record.text !== 'string') return invalid('text must be a string');
    const trimmed = record.text.trim();
    if (trimmed.length > LOG_QUERY_TEXT_MAX) return invalid('text must be at most 500 characters');
    if (trimmed.length > 0) text = trimmed;
  }

  let limit = LOG_QUERY_LIMIT_DEFAULT;
  if (record.limit !== undefined && record.limit !== null) {
    if (typeof record.limit !== 'number' || !Number.isInteger(record.limit) || record.limit < 1 || record.limit > LOG_QUERY_LIMIT_MAX) {
      return invalid('limit must be an integer from 1 to 200');
    }
    limit = record.limit;
  }

  let cursor: MonitorLogCursor | null = null;
  if (record.cursor !== undefined && record.cursor !== null) {
    if (typeof record.cursor !== 'string') return invalid('cursor must be a string');
    if (Buffer.byteLength(record.cursor, 'utf8') > LOG_QUERY_CURSOR_MAX_BYTES) {
      return invalid('cursor exceeds 4 KiB');
    }
    if (record.cursor.length > 0) {
      const decoded = decodeCursor(record.cursor);
      if ('status' in decoded) return { ok: false, error: decoded };
      cursor = decoded;
    }
  }

  return { ok: true, value: { app: record.app, stream: record.stream, startAt, text, cursor, limit } };
}
