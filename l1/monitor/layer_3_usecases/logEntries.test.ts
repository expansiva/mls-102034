/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/logEntries.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import type { MonitorLogCursor } from '/_102034_/l2/monitor/shared/contracts/logs.js';
import {
  cutLatestLogPage,
  encodeMonitorLogCursor,
  filterKeyOf,
  filterMonitorLogEntries,
  parseExplicitTimestamp,
  parseMonitorLogEntries,
  validateMonitorLogPageInput,
} from '/_102034_/l1/monitor/layer_3_usecases/logEntries.js';

const FILE = 'msg-error';

function query(raw: string, filters: { startAt?: string; text?: string; limit?: number }) {
  const validated = validateMonitorLogPageInput({
    app: 'msg',
    stream: 'error',
    ...filters,
  });
  assert.equal(validated.ok, true);
  if (!validated.ok) throw new Error('unreachable');
  const parsed = parseMonitorLogEntries(FILE, raw);
  const filtered = filterMonitorLogEntries(parsed, {
    startAt: validated.value.startAt,
    text: validated.value.text,
  });
  return {
    parsed,
    filtered,
    page: cutLatestLogPage(filtered.entries, validated.value.limit),
    value: validated.value,
  };
}

test('PM2 stamp without a zone is UTC and ISO Z is preserved', () => {
  const entries = parseMonitorLogEntries(FILE, [
    '2026-10-20T14:35:52: pm2 line',
    '2026-10-20T14:35:53.5Z iso line',
  ].join('\n'));
  assert.deepEqual(entries.map((entry) => entry.timestamp), [
    '2026-10-20T14:35:52.000Z',
    '2026-10-20T14:35:53.500Z',
  ]);
  assert.deepEqual(entries.map((entry) => entry.text), ['pm2 line', 'iso line']);
});

test('startAt is inclusive and a Brazil offset normalizes to UTC', () => {
  const startAt = '2026-10-20T12:00:00-03:00';
  assert.equal(parseExplicitTimestamp(startAt), '2026-10-20T15:00:00.000Z');
  const raw = [
    '2026-10-20T14:59:59.999Z: before',
    '2026-10-20T15:00:00Z: at',
    '2026-10-20T15:00:01Z: after',
  ].join('\n');
  const { filtered } = query(raw, { startAt });
  assert.deepEqual(filtered.entries.map((entry) => entry.text), ['at', 'after']);
  assert.equal(filtered.untimedEntries, 0);
});

test('invalid calendar dates are rejected and are not log timestamps', () => {
  const rejected = validateMonitorLogPageInput({
    app: 'msg',
    stream: 'out',
    startAt: '2026-02-31T00:00:00Z',
  });
  assert.equal(rejected.ok, false);
  if (rejected.ok) return;
  assert.equal(rejected.error.status, 400);

  const zoneLess = validateMonitorLogPageInput({
    app: 'msg-worker',
    stream: 'error',
    startAt: '2026-10-20T12:00:00',
  });
  assert.equal(zoneLess.ok, false);

  const entries = parseMonitorLogEntries(FILE, '2026-02-31T10:00:00: not a real day\n');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].timestamp, null);
  assert.match(entries[0].text, /not a real day/);
});

test('literal text matches the middle of a line and a stack, including brackets', () => {
  const raw = [
    '2026-10-20T14:35:52: ready',
    '2026-10-20T14:35:53: failed while reading [config_error] token',
    '    at Worker.load (/app/src/boot.ts:40:12)',
    'Error: [config_error] nested',
    '2026-10-20T14:35:54: other a.b',
  ].join('\n');
  const bracket = query(raw, { text: '[config_error]' });
  assert.equal(bracket.filtered.entries.length, 1);
  assert.match(bracket.filtered.entries[0].text, /failed while reading/);
  assert.match(bracket.filtered.entries[0].text, /nested/);
  assert.equal(query(raw, { text: 'CONFIG_ERROR' }).filtered.entries.length, 1);
  assert.equal(query(raw, { text: 'a.b' }).filtered.entries.map((entry) => entry.text).join('\n').includes('other a.b'), true);
  assert.equal(query(raw, { text: 'a.b' }).filtered.entries.some((entry) => entry.text.includes('axb')), false);
  assert.equal(query(`${raw}\naxb`, { text: '.*' }).filtered.entries.length, 0);
});

test('empty text is no filter and an untimed block stays visible until a time filter', () => {
  const raw = [
    'boot without a clock',
    'still booting',
    '2026-10-20T14:35:52: started',
  ].join('\n');
  const open = query(raw, { text: '   ' });
  assert.equal(open.filtered.entries.length, 2);
  assert.equal(open.filtered.untimedEntries, 0);
  assert.match(open.filtered.entries[0].text, /boot without a clock\nstill booting/);

  const timed = query(raw, { startAt: '2026-10-20T14:35:52Z', text: 'boot' });
  assert.equal(timed.filtered.entries.length, 0);
  assert.equal(timed.filtered.untimedEntries, 1);

  const textOnly = query(raw, { text: 'clock' });
  assert.equal(textOnly.filtered.entries.length, 1);
  assert.equal(textOnly.filtered.entries[0].timestamp, null);
});

test('repeated timestamp and text stay distinct entries', () => {
  const raw = '2026-10-20T14:35:52: same\n2026-10-20T14:35:52: same\n';
  const entries = parseMonitorLogEntries(FILE, raw);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].timestamp, entries[1].timestamp);
  assert.equal(entries[0].text, entries[1].text);
  assert.notEqual(entries[0].id, entries[1].id);
  const filtered = filterMonitorLogEntries(entries, { startAt: entries[0].timestamp, text: 'same' });
  assert.equal(filtered.entries.length, 2);
});

test('time and text apply before the page cut', () => {
  const raw = [
    '2026-10-20T14:00:00Z: [config_error] early',
    '2026-10-20T15:00:00Z: noise',
    '2026-10-20T16:00:00Z: noise',
  ].join('\n');
  const { page } = query(raw, { text: '[config_error]', limit: 1 });
  assert.deepEqual(page.map((entry) => entry.text), ['[config_error] early']);
});

test('invalid app, stream, limit, extra field, path and cursor are 400', () => {
  assert.equal(validateMonitorLogPageInput({ app: 'app', stream: 'error' }).ok, false);
  assert.equal(validateMonitorLogPageInput({ app: 'msg', stream: 'stdout' }).ok, false);
  assert.equal(validateMonitorLogPageInput({ app: 'msg', stream: 'out', limit: 0 }).ok, false);
  assert.equal(validateMonitorLogPageInput({ app: 'msg', stream: 'out', limit: 201 }).ok, false);
  assert.equal(validateMonitorLogPageInput({ app: 'msg', stream: 'out', lines: 200 }).ok, false);
  const path = validateMonitorLogPageInput({ app: 'msg', stream: 'out', path: '/tmp/pm2-api-error.log' });
  assert.equal(path.ok, false);
  if (!path.ok) assert.equal(path.error.status, 400);

  const defaults = validateMonitorLogPageInput({ app: 'msg-worker', stream: 'out' });
  assert.equal(defaults.ok, true);
  if (defaults.ok) assert.equal(defaults.value.limit, 100);

  const cursor: MonitorLogCursor = {
    v: 1,
    app: 'msg',
    stream: 'error',
    filterKey: filterKeyOf(null, '[config_error]'),
    sourceKey: 'msg-error',
    offset: 40,
  };
  const accepted = validateMonitorLogPageInput({
    app: 'msg',
    stream: 'error',
    cursor: encodeMonitorLogCursor(cursor),
  });
  assert.equal(accepted.ok, true);
  if (accepted.ok) assert.deepEqual(accepted.value.cursor, cursor);

  const withPath = Buffer.from(JSON.stringify({ ...cursor, path: '/etc/passwd' }), 'utf8').toString('base64url');
  assert.equal(validateMonitorLogPageInput({ app: 'msg', stream: 'error', cursor: withPath }).ok, false);
  assert.equal(validateMonitorLogPageInput({
    app: 'msg',
    stream: 'error',
    cursor: 'x'.repeat(4097),
  }).ok, false);
  assert.equal(validateMonitorLogPageInput({ app: 'msg', stream: 'out', text: 'a'.repeat(501) }).ok, false);

  // The cursor carries a hash of the filters, never the search text itself.
  assert.match(cursor.filterKey, /^[0-9a-f]{64}$/u);
  assert.equal(encodeMonitorLogCursor(cursor).includes(Buffer.from('config_error').toString('base64url')), false);
  assert.notEqual(filterKeyOf(null, '[config_error]'), filterKeyOf(null, '[config_errors]'));
  const rawKey = Buffer.from(JSON.stringify({ ...cursor, filterKey: '\n[config_error]' }), 'utf8').toString('base64url');
  assert.equal(validateMonitorLogPageInput({ app: 'msg', stream: 'error', cursor: rawKey }).ok, false);
});
