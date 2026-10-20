/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/logFilePages.ts" enhancement="_blank" />
import { createHash } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';
import type { MonitorLogEntry, MonitorLogPage } from '/_102034_/l2/monitor/shared/contracts/logs.js';
import {
  encodeMonitorLogCursor,
  filterKeyOf,
  filterMonitorLogEntries,
  parseMonitorLogEntries,
  validateMonitorLogPageInput,
  type NormalizedLogQuery,
} from '/_102034_/l1/monitor/layer_3_usecases/logEntries.js';

export const LOG_PAGE_READ_BUDGET = 2 * 1024 * 1024;
export const LOG_PAGE_TEXT_BUDGET = 512 * 1024;

const ANCHOR_BYTES = 64;
const SOURCE_KEY_RE = /^s1:(\d+):(\d+):(\d+):([0-9a-f]{32}):([0-9a-f]{32})$/u;

export interface LogFileTarget {
  file: string;
}

export interface LogFilePageError {
  status: 400 | 409;
  code: 'INVALID_LOG_QUERY' | 'LOG_SOURCE_CHANGED';
  message: string;
}

export type LogFilePageResult =
  | { ok: true; page: MonitorLogPage }
  | { ok: false; error: LogFilePageError };

interface Snapshot {
  dev: bigint;
  ino: bigint;
  size: bigint;
  prefixHash: string;
}

/**
 * Reads one page of an already resolved log file. History is walked backward.
 * The snapshot is dev/ino, the size at open, a hash of the first 64 bytes, and
 * a hash of 64 bytes at the cursor. Appends past that size are ignored.
 * A same-length rewrite that preserves those anchors is not detected.
 */
export async function readLogFilePage(target: LogFileTarget, input: unknown): Promise<LogFilePageResult> {
  const validated = validateMonitorLogPageInput(input);
  if (!validated.ok) return { ok: false, error: validated.error };
  const query = validated.value;
  if (typeof target?.file !== 'string' || target.file.length === 0) {
    return { ok: false, error: { status: 400, code: 'INVALID_LOG_QUERY', message: 'log target is not resolved' } };
  }

  let handle: FileHandle | undefined;
  try {
    try {
      handle = await open(target.file, 'r');
    } catch (error) {
      if (nodeCode(error) === 'ENOENT') {
        if (query.cursor) return sourceChanged();
        return { ok: true, page: emptyPage(query, target.file, null, 0) };
      }
      throw error;
    }

    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile()) {
      throw Object.assign(new Error('log source is not a file'), { code: 'EISDIR' });
    }
    if (stats.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('log file is larger than the reader can address');
    }

    const prefix = await readAt(handle, 0, Number(stats.size < BigInt(ANCHOR_BYTES) ? stats.size : BigInt(ANCHOR_BYTES)));
    const opened: Snapshot = {
      dev: stats.dev,
      ino: stats.ino,
      size: stats.size,
      prefixHash: fingerprint(prefix),
    };

    const bound = resolveBound(query, opened);
    if (bound.kind === 'error') return { ok: false, error: bound.error };
    const regionEnd = bound.regionEnd;
    if (bound.cursorEdge !== null) {
      const edge = await readAt(handle, regionEnd, anchorLength(bound.snapshotSize, regionEnd));
      if (fingerprint(edge) !== bound.cursorEdge) return sourceChanged();
    }

    const readStartBudget = regionEnd > LOG_PAGE_READ_BUDGET ? regionEnd - LOG_PAGE_READ_BUDGET : 0;
    let readStart = readStartBudget;
    let scanned = 0;
    if (readStart > 0) {
      let probe = await readAt(handle, readStart, 1);
      scanned += probe.length;
      let steps = 0;
      while (steps < 3 && readStart > 0 && probe.length === 1 && (probe[0] & 0xc0) === 0x80) {
        readStart -= 1;
        steps += 1;
        probe = await readAt(handle, readStart, 1);
        scanned += probe.length;
      }
    }

    const span = regionEnd - readStart;
    const buf = span > 0 ? await readAt(handle, readStart, span) : Buffer.alloc(0);
    scanned += buf.length;
    if (buf.length !== span) return sourceChanged();

    const snapshot = { ...opened, size: bound.snapshotSize };
    const page = await buildPage(handle, query, target.file, stats.mtime.toISOString(), snapshot, buf, readStart, regionEnd, scanned);
    return page;
  } finally {
    await handle?.close();
  }
}

function nodeCode(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
}

function sourceChangedError(): LogFilePageError {
  return { status: 409, code: 'LOG_SOURCE_CHANGED', message: 'log source changed; query again' };
}

function sourceChanged(): LogFilePageResult {
  return { ok: false, error: sourceChangedError() };
}

function emptyPage(query: NormalizedLogQuery, file: string, updatedAt: string | null, scanned: number): MonitorLogPage {
  return {
    app: query.app,
    stream: query.stream,
    file,
    updatedAt,
    entries: [],
    nextCursor: null,
    hasMore: false,
    limited: false,
    scannedBytes: scanned,
    untimedEntries: 0,
  };
}

function fingerprint(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex').slice(0, 32);
}

function anchorLength(size: bigint, offset: number): number {
  const room = size - BigInt(offset);
  if (room <= 0n) return 0;
  return Number(room < BigInt(ANCHOR_BYTES) ? room : BigInt(ANCHOR_BYTES));
}

function resolveBound(
  query: NormalizedLogQuery,
  opened: Snapshot,
): { kind: 'ok'; regionEnd: number; snapshotSize: bigint; cursorEdge: string | null } | { kind: 'error'; error: LogFilePageError } {
  if (!query.cursor) {
    return { kind: 'ok', regionEnd: Number(opened.size), snapshotSize: opened.size, cursorEdge: null };
  }
  const cursor = query.cursor;
  if (cursor.app !== query.app || cursor.stream !== query.stream || cursor.filterKey !== filterKeyOf(query.startAt, query.text)) {
    return { kind: 'error', error: { status: 400, code: 'INVALID_LOG_QUERY', message: 'cursor does not match this query' } };
  }
  const match = SOURCE_KEY_RE.exec(cursor.sourceKey);
  if (!match) {
    return { kind: 'error', error: { status: 400, code: 'INVALID_LOG_QUERY', message: 'cursor is not valid' } };
  }
  const dev = BigInt(match[1] ?? '0');
  const ino = BigInt(match[2] ?? '0');
  const size = BigInt(match[3] ?? '0');
  const prefixHash = match[4] ?? '';
  const edgeHash = match[5] ?? '';
  if (dev !== opened.dev || ino !== opened.ino || opened.size < size || prefixHash !== opened.prefixHash) {
    return { kind: 'error', error: sourceChangedError() };
  }
  const snapshotEnd = Number(size);
  if (!Number.isSafeInteger(cursor.offset) || cursor.offset > snapshotEnd) {
    return { kind: 'error', error: { status: 400, code: 'INVALID_LOG_QUERY', message: 'cursor is outside the snapshot' } };
  }
  return { kind: 'ok', regionEnd: cursor.offset, snapshotSize: size, cursorEdge: edgeHash };
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  if (length <= 0) return Buffer.alloc(0);
  const buf = Buffer.allocUnsafe(length);
  let got = 0;
  while (got < length) {
    const { bytesRead } = await handle.read(buf, got, length - got, position + got);
    if (bytesRead === 0) break;
    got += bytesRead;
  }
  return buf.subarray(0, got);
}

async function buildPage(
  handle: FileHandle,
  query: NormalizedLogQuery,
  file: string,
  updatedAt: string,
  opened: Snapshot,
  buf: Buffer,
  readStart: number,
  regionEnd: number,
  scanned: number,
): Promise<LogFilePageResult> {
  if (regionEnd === 0) {
    return { ok: true, page: { ...emptyPage(query, file, updatedAt, scanned), file } };
  }

  let parseAt = 0;
  if (readStart > 0) {
    const previous = await readAt(handle, readStart - 1, 1);
    if (previous.length !== 1) return sourceChanged();
    if (previous[0] !== 0x0a) {
      const newline = buf.indexOf(0x0a);
      if (newline < 0) {
        const giant = splitGiant(query, buf, readStart, regionEnd);
        const edgeHash = giant.hasMore
          ? fingerprint(await readAt(handle, giant.nextOffset, anchorLength(opened.size, giant.nextOffset)))
          : '';
        return {
          ok: true,
          page: finish(query, file, updatedAt, opened, scanned, edgeHash, giant),
        };
      }
      parseAt = newline + 1;
    }
  }

  const body = buf.subarray(parseAt);
  const base = readStart + parseAt;
  if (body.length === 0 && parseAt > LOG_PAGE_TEXT_BUDGET) {
    const prefix = buf.subarray(0, parseAt - 1);
    const giant = splitGiant(query, prefix, readStart, readStart + prefix.length);
    const edgeHash = giant.hasMore
      ? fingerprint(await readAt(handle, giant.nextOffset, anchorLength(opened.size, giant.nextOffset)))
      : '';
    return { ok: true, page: finish(query, file, updatedAt, opened, scanned, edgeHash, giant) };
  }
  const parsedAll = parseMonitorLogEntries(`${query.app}-${query.stream}`, body.toString('utf8'), base);
  // When the read window does not start at the file start, a leading block without a header is the tail of a
  // message whose header lies before the window. Leave it out here; the next page ends after it and reads it whole.
  const parsed = readStart > 0 && parsedAll.length > 1 && parsedAll[0]?.timestamp === null ? parsedAll.slice(1) : parsedAll;
  const filtered = filterMonitorLogEntries(parsed, { startAt: query.startAt, text: query.text });
  const selected = selectEntries(filtered.entries, query.limit);
  const oldest = selected.entries[0];
  const oldestStart = oldest ? entryStart(oldest) : base;
  const moreInFile = oldest ? oldestStart > 0 : (parsed !== parsedAll ? true : base > 0);
  const stoppedByCap = filtered.entries.length > selected.entries.length && selected.entries.length >= query.limit && !selected.truncated;
  const hasMore = moreInFile || filtered.entries.length > selected.entries.length;
  const limited = selected.truncated || (!stoppedByCap && hasMore && selected.entries.length < query.limit);
  const firstKept = parsed[0];
  const nextOffset = selected.entries.length > 0 ? oldestStart : (firstKept && parsed !== parsedAll ? entryStart(firstKept) : base);
  const moving = hasMore && nextOffset < regionEnd && nextOffset >= 0;
  const edgeHash = moving ? fingerprint(await readAt(handle, nextOffset, anchorLength(opened.size, nextOffset))) : '';
  return {
    ok: true,
    page: finish(query, file, updatedAt, opened, scanned, edgeHash, {
      entries: selected.entries,
      untimedEntries: filtered.untimedEntries,
      hasMore: moving,
      limited,
      nextOffset,
    }),
  };
}

function splitGiant(
  query: NormalizedLogQuery,
  buf: Buffer,
  readStart: number,
  regionEnd: number,
): { entries: MonitorLogEntry[]; untimedEntries: number; hasMore: boolean; limited: boolean; nextOffset: number } {
  const slice = utf8Tail(buf, LOG_PAGE_TEXT_BUDGET);
  const sliceStart = regionEnd - slice.length;
  const parsed = slice.length > 0
    ? parseMonitorLogEntries(`${query.app}-${query.stream}`, slice.toString('utf8'), sliceStart)
    : [];
  const marked = parsed.map((entry) => ({ ...entry, truncated: true }));
  const filtered = filterMonitorLogEntries(marked, { startAt: query.startAt, text: query.text });
  const nextOffset = sliceStart > readStart ? sliceStart : readStart;
  const advanced = nextOffset < regionEnd ? nextOffset : Math.max(0, regionEnd - 1);
  return {
    entries: filtered.entries,
    untimedEntries: filtered.untimedEntries,
    hasMore: advanced > 0,
    limited: true,
    nextOffset: advanced,
  };
}

function selectEntries(
  entries: readonly MonitorLogEntry[],
  limit: number,
): { entries: MonitorLogEntry[]; truncated: boolean } {
  const kept: MonitorLogEntry[] = [];
  let used = 0;
  let truncated = false;
  for (let index = entries.length - 1; index >= 0 && kept.length < limit; index -= 1) {
    const entry = entries[index];
    if (!entry) break;
    const size = Buffer.byteLength(entry.text, 'utf8');
    if (size > LOG_PAGE_TEXT_BUDGET) {
      if (kept.length > 0) break;
      kept.push({ ...entry, text: truncateUtf8Text(entry.text, LOG_PAGE_TEXT_BUDGET), truncated: true });
      truncated = true;
      break;
    }
    if (used + size > LOG_PAGE_TEXT_BUDGET) {
      truncated = true;
      break;
    }
    used += size;
    kept.push(entry);
  }
  kept.reverse();
  return { entries: kept, truncated };
}

function finish(
  query: NormalizedLogQuery,
  file: string,
  updatedAt: string,
  opened: Snapshot,
  scanned: number,
  edgeHash: string,
  page: { entries: MonitorLogEntry[]; untimedEntries: number; hasMore: boolean; limited: boolean; nextOffset: number },
): MonitorLogPage {
  let nextCursor: string | null = null;
  if (page.hasMore) {
    nextCursor = encodeMonitorLogCursor({
      v: 1,
      app: query.app,
      stream: query.stream,
      filterKey: filterKeyOf(query.startAt, query.text),
      sourceKey: `s1:${opened.dev}:${opened.ino}:${opened.size}:${opened.prefixHash}:${edgeHash}`,
      offset: page.nextOffset,
    });
  }
  return {
    app: query.app,
    stream: query.stream,
    file,
    updatedAt,
    entries: page.entries,
    nextCursor,
    hasMore: page.hasMore,
    limited: page.limited,
    scannedBytes: scanned,
    untimedEntries: page.untimedEntries,
  };
}

function entryStart(entry: MonitorLogEntry): number {
  const start = Number(entry.id.split('\u001f')[1]);
  return Number.isSafeInteger(start) ? start : 0;
}

function utf8Tail(buf: Buffer, maxBytes: number): Buffer {
  if (buf.length <= maxBytes) return buf;
  let start = buf.length - maxBytes;
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) start += 1;
  return buf.subarray(start);
}

function truncateUtf8Text(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  return buf.subarray(0, end).toString('utf8');
}
