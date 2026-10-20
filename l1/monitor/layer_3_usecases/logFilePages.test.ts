/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/logFilePages.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { mkdtemp, open, rm, writeFile, chmod, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { encodeMonitorLogCursor } from '/_102034_/l1/monitor/layer_3_usecases/logEntries.js';
import {
  LOG_PAGE_READ_BUDGET,
  LOG_PAGE_TEXT_BUDGET,
  readLogFilePage,
  type LogFilePageResult,
} from '/_102034_/l1/monitor/layer_3_usecases/logFilePages.js';
import type { MonitorLogEntry, MonitorLogPage } from '/_102034_/l2/monitor/shared/contracts/logs.js';

const input = {
  app: 'msg' as const,
  stream: 'error' as const,
  limit: 100,
};

async function okPage(file: string, extra: Record<string, unknown> = {}): Promise<MonitorLogPage> {
  const result = await readLogFilePage({ file }, { ...input, ...extra });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('unreachable');
  return result.page;
}

async function pageAll(file: string, extra: Record<string, unknown> = {}): Promise<MonitorLogEntry[]> {
  const seen = new Set<string>();
  const chrono: MonitorLogEntry[] = [];
  let cursor: string | undefined;
  for (let hop = 0; hop < 30; hop += 1) {
    const page = await okPage(file, { ...extra, cursor });
    const older = page.entries.filter((entry) => {
      assert.equal(seen.has(entry.id), false);
      seen.add(entry.id);
      return true;
    });
    chrono.unshift(...older);
    if (!page.hasMore) {
      assert.equal(page.nextCursor, null);
      return chrono;
    }
    assert.ok(page.nextCursor);
    assert.notEqual(page.nextCursor, cursor);
    cursor = page.nextCursor ?? undefined;
  }
  throw new Error('pagination did not finish');
}

test('pages more than 300 entries, including a match outside the newest 200', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rt110-'));
  try {
    const file = join(dir, 'pm2-api-error.log');
    const lines = Array.from({ length: 320 }, (_, index) => {
      const text = index === 0 ? 'needle [config_error] outside tail' : 'ordinary';
      return `2026-10-20T08:00:00: ${String(index).padStart(4, '0')} ${text}`;
    });
    await writeFile(file, `${lines.join('\n')}\n`);
    const first = await okPage(file, { text: 'needle', limit: 200 });
    assert.equal(first.entries.length, 1);
    assert.match(first.entries[0]?.text ?? '', /outside tail/);
    const all = await pageAll(file);
    assert.equal(all.length, 320);
    assert.equal(all[0]?.text.includes('needle [config_error]'), true);
    assert.deepEqual(all.map((entry) => entry.text), lines.map((line) => line.slice('2026-10-20T08:00:00: '.length)));
    const found = await pageAll(file, { text: '[config_error]' });
    assert.equal(found.length, 1);
    assert.match(found[0]?.text ?? '', /needle/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('startAt is inclusive and paging keeps order without repeats', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rt110-'));
  try {
    const file = join(dir, 'pm2-api-error.log');
    const lines = [
      '2026-10-20T01:00:00: before',
      '2026-10-20T02:00:00: at',
      '2026-10-20T03:00:00: after',
    ];
    await writeFile(file, `${lines.join('\n')}\n`);
    const matched = await pageAll(file, { startAt: '2026-10-20T02:00:00Z', limit: 1 });
    assert.deepEqual(matched.map((entry) => entry.text), ['at', 'after']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('append between pages does not shift or reject the snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rt110-'));
  try {
    const file = join(dir, 'pm2-api-error.log');
    const lines = Array.from({ length: 150 }, (_, index) => `2026-10-20T04:00:00: row ${index}`);
    await writeFile(file, `${lines.join('\n')}\n`);
    const first = await okPage(file, { limit: 40 });
    assert.equal(first.entries.at(-1)?.text, 'row 149');
    await writeFile(file, `\n2026-10-20T05:00:00: appended\n`, { flag: 'a' });
    const second = await okPage(file, { limit: 40, cursor: first.nextCursor });
    assert.equal(second.entries.at(-1)?.text, 'row 109');
    assert.equal(second.entries.some((entry) => entry.text === 'appended'), false);
    assert.equal(second.entries.some((entry) => first.entries.some((kept) => kept.id === entry.id)), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rotation and truncation are LOG_SOURCE_CHANGED', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rt110-'));
  try {
    const file = join(dir, 'pm2-api-error.log');
    await writeFile(file, '2026-10-20T04:00:00: first\n');
    const first = await okPage(file, { limit: 10 });
    assert.ok(first.nextCursor === null || first.hasMore === false);
    await writeFile(file, `${'2026-10-20T04:00:00: pad\n'.repeat(20)}`);
    const grown = await okPage(file, { limit: 10 });
    assert.equal(grown.hasMore, true);
    await rm(file);
    await writeFile(file, '2026-10-20T06:00:00: rotated\n');
    const rotated = await readLogFilePage({ file }, { ...input, cursor: grown.nextCursor });
    assert.equal(rotated.ok, false);
    if (rotated.ok) return;
    assert.equal(rotated.error.status, 409);
    assert.equal(rotated.error.code, 'LOG_SOURCE_CHANGED');

    await writeFile(file, `${'2026-10-20T04:00:00: pad\n'.repeat(30)}`);
    const again = await okPage(file, { limit: 10 });
    const handle = await open(file, 'r+');
    await handle.truncate(8);
    await handle.close();
    const truncated = await readLogFilePage({ file }, { ...input, cursor: again.nextCursor });
    assert.equal(truncated.ok, false);
    if (!truncated.ok) assert.equal(truncated.error.code, 'LOG_SOURCE_CHANGED');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CRLF, UTF-8 and a multiline entry survive a block boundary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rt110-'));
  try {
    const file = join(dir, 'pm2-api-error.log');
    const marker = '2026-10-19T00:00:00: OLD\r\n';
    const head = '2026-10-20T05:00:00: head\r\n';
    const stack = 'stack [config_error] café 😀\r\n';
    const before = Buffer.from(marker + head + stack.slice(0, stack.indexOf('😀')), 'utf8');
    const desired = LOG_PAGE_READ_BUDGET + before.length + 2;
    const filler = Buffer.from(`2026-10-20T06:00:00: ${'tail '.repeat(400)}\r\n`, 'utf8');
    const chunks = [Buffer.from(marker + head + stack, 'utf8')];
    let size = chunks[0]?.length ?? 0;
    while (size < desired) {
      chunks.push(filler);
      size += filler.length;
    }
    await writeFile(file, Buffer.concat(chunks));
    const found: MonitorLogEntry[] = [];
    let cursor: string | undefined;
    for (let hop = 0; hop < 8; hop += 1) {
      const page = await okPage(file, { limit: 200, cursor });
      found.push(...page.entries);
      if (found.some((entry) => entry.text === 'OLD')) break;
      assert.equal(page.hasMore, true);
      assert.notEqual(page.nextCursor, cursor);
      cursor = page.nextCursor ?? undefined;
    }
    const joined = found.find((entry) => entry.text.includes('head'));
    assert.ok(joined);
    assert.match(joined?.text ?? '', /café 😀/);
    assert.match(joined?.text ?? '', /\[config_error\]/);
    assert.equal(found.filter((entry) => entry.text.includes('stack [config_error]')).length, 1);
    assert.equal(found.some((entry) => entry.text === 'OLD'), true);
    assert.equal(found.some((entry) => entry.text.includes('\r')), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a multiline block cut by the read budget is returned whole, never as a headless tail', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rt110-'));
  try {
    const file = join(dir, 'pm2-api-error.log');
    const blocks: string[][] = [];
    let bytes = 0;
    for (let index = 0; bytes < LOG_PAGE_READ_BUDGET + 900_000; index += 1) {
      const stamp = new Date(Date.UTC(2026, 9, 20, 0, 0, 0) + index * 1000).toISOString().slice(0, 19);
      const lines = [`${stamp}: evt-${index}`];
      for (let line = 0; line < 20; line += 1) lines.push(`    at frame${line} (${'x'.repeat(80)})`);
      blocks.push(lines);
      bytes += Buffer.byteLength(`${lines.join('\n')}\n`);
    }
    // The first page reads [size - budget, size). Find the block that window cuts, and put the only match in a
    // stack line after the cut, by replacing characters so no offset moves.
    const cut = bytes - LOG_PAGE_READ_BUDGET;
    let at = 0;
    let target = -1;
    let line = -1;
    for (let index = 0; index < blocks.length && target < 0; index += 1) {
      for (let row = 0; row < (blocks[index]?.length ?? 0); row += 1) {
        const size = Buffer.byteLength(`${blocks[index]?.[row]}\n`);
        if (row > 0 && at > cut + 1) {
          target = index;
          line = row;
          break;
        }
        at += size;
      }
    }
    assert.ok(target > 0 && line > 0);
    const original = blocks[target]?.[line] ?? '';
    blocks[target]![line] = original.replace('x'.repeat(14), '[config_error]');
    assert.equal(Buffer.byteLength(blocks[target]![line]!), Buffer.byteLength(original));
    await writeFile(file, blocks.map((rows) => `${rows.join('\n')}\n`).join(''));

    const entries = await pageAll(file, { text: '[config_error]', limit: 200 });
    assert.equal(entries.length, 1, JSON.stringify(entries.map((entry) => entry.text.slice(0, 30))));
    assert.notEqual(entries[0]?.timestamp, null);
    assert.equal(entries[0]?.text.split('\n')[0], `evt-${target}`);
    assert.match(entries[0]?.text ?? '', /\[config_error\]/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('empty and absent files are distinct, and an unreadable file is not empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rt110-'));
  const hidden = join(dir, 'denied.log');
  try {
    const empty = join(dir, 'empty.log');
    await writeFile(empty, '');
    const blank = await okPage(empty);
    assert.equal(blank.entries.length, 0);
    assert.equal(blank.hasMore, false);
    assert.equal(typeof blank.updatedAt, 'string');

    const missing = await okPage(join(dir, 'missing.log'));
    assert.equal(missing.entries.length, 0);
    assert.equal(missing.hasMore, false);
    assert.equal(missing.updatedAt, null);

    await writeFile(hidden, '2026-10-20T00:00:00: secret\n');
    await chmod(hidden, 0);
    const denied = await readLogFilePage({ file: hidden }, input).then(
      () => 'returned',
      (error: NodeJS.ErrnoException) => error.code,
    );
    assert.ok(denied === 'EACCES' || denied === 'EPERM');
  } finally {
    await chmod(hidden, 0o644).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

test('a line beyond the read budget and a sparse scan advance the cursor', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rt110-'));
  try {
    const wide = join(dir, 'wide.log');
    const body = 'B'.repeat(LOG_PAGE_READ_BUDGET + 100);
    await writeFile(wide, `2026-10-20T00:00:00: ${body}\n`);
    const first = await okPage(wide, { limit: 10 });
    assert.equal(first.limited, true);
    assert.equal(first.hasMore, true);
    assert.ok(first.entries.every((entry) => entry.truncated));
    assert.ok((first.entries[0]?.text.length ?? 0) <= LOG_PAGE_TEXT_BUDGET);
    const second = await okPage(wide, { limit: 10, cursor: first.nextCursor });
    assert.notEqual(second.nextCursor, first.nextCursor);
    assert.equal(second.entries.some((entry) => first.entries.some((prev) => prev.id === entry.id)), false);

    const sparse = join(dir, 'sparse.log');
    const noise = Buffer.from('2026-10-20T00:00:00: noise\n', 'utf8');
    const head = Buffer.from('2026-10-20T00:00:00: [config_error] buried\n', 'utf8');
    const blocks = [head];
    let total = head.length;
    while (total < LOG_PAGE_READ_BUDGET + noise.length * 10) {
      blocks.push(noise);
      total += noise.length;
    }
    await writeFile(sparse, Buffer.concat(blocks));
    const scanned: string[] = [];
    let cursor: string | undefined;
    let sawLimitedEmpty = false;
    for (let hop = 0; hop < 6; hop += 1) {
      const page = await okPage(sparse, { text: '[config_error]', cursor });
      scanned.push(...page.entries.map((entry) => entry.text));
      if (page.entries.length === 0 && page.limited && page.hasMore) sawLimitedEmpty = true;
      if (!page.hasMore) break;
      assert.notEqual(page.nextCursor, cursor);
      cursor = page.nextCursor ?? undefined;
    }
    assert.equal(sawLimitedEmpty, true);
    assert.equal(scanned.some((text) => text.includes('buried')), true);
    await stat(sparse);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a cursor that names another stream is rejected and is not a path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rt110-'));
  try {
    const file = join(dir, 'pm2-api-error.log');
    await writeFile(file, '2026-10-20T00:00:00: kept\n');
    const forged = encodeMonitorLogCursor({
      v: 1,
      app: 'msg-worker',
      stream: 'out',
      filterKey: 'ab'.repeat(32),
      sourceKey: 's1:1:1:1:cd'.padEnd(4, '0'),
      offset: 0,
    });
    const result: LogFilePageResult = await readLogFilePage({ file }, { ...input, cursor: forged });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.status, 400);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
