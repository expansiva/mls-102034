/// <mls fileReference="_102034_/l2/monitor/web/routes/messagesLogsState.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MonitorLogPage } from '/_102034_/l2/monitor/shared/contracts/logs.js';
import {
  applyMessagesLogsOlderPage,
  applyMessagesLogsPage,
  beginMessagesLogsLoadMore,
  beginMessagesLogsQuery,
  connectMessagesLogs,
  createMessagesLogsState,
  disconnectMessagesLogs,
  failMessagesLogsLoadMore,
  failMessagesLogsQuery,
  markMessagesLogsSourceChanged,
  messagesLogsBody,
  messagesLogsCopyText,
  messagesLogsInitialStartAt,
  messagesLogsStartAtContext,
  startAtIsoToLocal,
  startAtLocalToIso,
} from '/_102034_/l2/monitor/web/routes/messagesLogsState.js';

function page(partial: Partial<MonitorLogPage> & Pick<MonitorLogPage, 'entries'>): MonitorLogPage {
  return {
    app: 'msg',
    stream: 'error',
    file: 'msg-error.log',
    updatedAt: null,
    nextCursor: 'c1',
    hasMore: true,
    limited: false,
    scannedBytes: 10,
    untimedEntries: 0,
    ...partial,
  };
}

function loaded() {
  let state = connectMessagesLogs(createMessagesLogsState());
  state = beginMessagesLogsQuery(state, { app: 'msg', stream: 'error', startAt: '', text: '' });
  const generation = state.generation;
  state = applyMessagesLogsPage(state, generation, page({
    entries: [
      { id: 'b', timestamp: '2026-10-20T14:00:00Z', text: 'second', truncated: false },
      { id: 'c', timestamp: '2026-10-20T14:00:01Z', text: 'third', truncated: false },
    ],
  }));
  return { state, generation };
}

test('a late page from another process or filter does not replace the current result', () => {
  let state = connectMessagesLogs(createMessagesLogsState());
  state = beginMessagesLogsQuery(state, { app: 'msg', stream: 'error', startAt: '', text: 'old' });
  const first = state.generation;
  state = beginMessagesLogsQuery(state, { app: 'msg-worker', stream: 'out', startAt: '2026-10-20T00:00:00Z', text: '' });
  const second = state.generation;
  const ignored = applyMessagesLogsPage(state, first, page({
    app: 'msg',
    stream: 'error',
    entries: [{ id: 'stale', timestamp: null, text: 'stale', truncated: false }],
  }));
  assert.equal(ignored.generation, second);
  assert.equal(ignored.phase, 'loading');
  assert.deepEqual(ignored.entries, []);
  const applied = applyMessagesLogsPage(ignored, second, page({
    app: 'msg-worker',
    stream: 'out',
    file: 'worker-out.log',
    entries: [{ id: 'new', timestamp: null, text: 'worker line', truncated: false }],
    nextCursor: null,
    hasMore: false,
  }));
  assert.equal(applied.phase, 'result');
  assert.equal(applied.query.app, 'msg-worker');
  assert.deepEqual(applied.entries.map((entry) => entry.id), ['new']);
});

test('load more prepends by id and ignores a second call for the same cursor', () => {
  const { state: ready, generation } = loaded();
  const started = beginMessagesLogsLoadMore(ready);
  assert.equal(started.phase, 'loading-more');
  assert.equal(started.pendingCursor, 'c1');
  const again = beginMessagesLogsLoadMore(started);
  assert.equal(again, started);
  const merged = applyMessagesLogsOlderPage(started, generation, 'c1', page({
    entries: [
      { id: 'a', timestamp: '2026-10-20T13:00:00Z', text: 'first', truncated: false },
      { id: 'b', timestamp: '2026-10-20T14:00:00Z', text: 'second duplicate', truncated: false },
    ],
    nextCursor: 'c0',
  }));
  assert.deepEqual(merged.entries.map((entry) => entry.id), ['a', 'b', 'c']);
  assert.equal(merged.entries[1].text, 'second');
  assert.equal(merged.pendingCursor, null);
  assert.equal(merged.nextCursor, 'c0');
});

test('a failed load more keeps the entries and the cursor', () => {
  const { state: ready, generation } = loaded();
  const started = beginMessagesLogsLoadMore(ready);
  const failed = failMessagesLogsLoadMore(started, generation, 'Could not load logs.');
  assert.equal(failed.phase, 'result');
  assert.equal(failed.errorMessage, 'Could not load logs.');
  assert.deepEqual(failed.entries.map((entry) => entry.id), ['b', 'c']);
  assert.equal(failed.nextCursor, 'c1');
  assert.equal(failed.hasMore, true);
  const retry = beginMessagesLogsLoadMore(failed);
  assert.equal(retry.phase, 'loading-more');
  assert.equal(retry.pendingCursor, 'c1');
});

test('a changed source drops the list instead of mixing pages', () => {
  const { state: ready, generation } = loaded();
  const started = beginMessagesLogsLoadMore(ready);
  const changed = markMessagesLogsSourceChanged(started, generation);
  assert.equal(changed.phase, 'source-changed');
  assert.deepEqual(changed.entries, []);
  assert.equal(changed.nextCursor, null);
  assert.equal(beginMessagesLogsLoadMore(changed), changed);
  const late = applyMessagesLogsOlderPage(changed, generation, 'c1', page({
    entries: [{ id: 'x', timestamp: null, text: 'other file', truncated: false }],
  }));
  assert.deepEqual(late.entries, []);
});

test('copy includes every loaded entry in order, with the query header', () => {
  const { state: ready, generation } = loaded();
  const started = beginMessagesLogsLoadMore(ready);
  const merged = applyMessagesLogsOlderPage(started, generation, 'c1', page({
    entries: [{ id: 'a', timestamp: null, text: 'first\nstack [config_error]', truncated: false }],
    nextCursor: null,
    hasMore: false,
  }));
  const withFilter = {
    ...merged,
    query: { ...merged.query, text: '[config_error]', startAt: '2026-10-20T13:00:00Z' },
  };
  const startAt = '2026-10-20T13:00:00Z';
  const localStart = startAtIsoToLocal(startAt);
  assert.equal(messagesLogsCopyText(withFilter), [
    'Process: API',
    'Output: Error output',
    `Start at: ${localStart} (${messagesLogsStartAtContext(startAt)})`,
    `Start at (UTC): ${startAt}`,
    'Message contains: [config_error]',
    '',
    'first\nstack [config_error]',
    '2026-10-20T14:00:00Z second',
    '2026-10-20T14:00:01Z third',
  ].join('\n'));
  assert.equal(localStart.endsWith('Z'), false);
  assert.equal(messagesLogsCopyText(withFilter).includes(`Start at (UTC): ${localStart} (`), false);
  // What is copied is what the log panel shows: same body, timestamps included.
  assert.equal(messagesLogsCopyText(withFilter).endsWith(messagesLogsBody(withFilter)), true);
  const loading = beginMessagesLogsQuery(withFilter, withFilter.query);
  assert.equal(messagesLogsCopyText(loading), '');
  const errored = failMessagesLogsQuery(loading, loading.generation, 'Servidor indisponivel ou sem conexao.');
  assert.equal(messagesLogsCopyText(errored), '');
  assert.equal(errored.entries.length, 0);
});

test('disconnect and a new mount ignore the previous response', () => {
  let state = connectMessagesLogs(createMessagesLogsState());
  state = beginMessagesLogsQuery(state, { app: 'msg', stream: 'error', startAt: '', text: '' });
  const first = state.generation;
  state = disconnectMessagesLogs(state);
  state = connectMessagesLogs(state);
  const revived = applyMessagesLogsPage(state, first, page({
    entries: [{ id: 'old', timestamp: null, text: 'old mount', truncated: false }],
  }));
  assert.equal(revived.phase, 'loading');
  assert.deepEqual(revived.entries, []);
});

test('a new screen fixes API stdout and the last hour, and a remount keeps that instant', () => {
  const clock = new Date('2026-10-22T12:51:00.400Z');
  const created = createMessagesLogsState(clock);
  assert.equal(created.query.app, 'msg');
  assert.equal(created.query.stream, 'out');
  assert.equal(created.query.text, '');
  assert.equal(created.query.startAt, '2026-10-22T11:51:00Z');
  assert.equal(created.query.startAt, messagesLogsInitialStartAt(clock));
  const remounted = connectMessagesLogs(created);
  assert.equal(remounted.query.startAt, created.query.startAt);
  assert.equal(remounted.query.stream, 'out');
  const applied = beginMessagesLogsQuery(remounted, { ...remounted.query, text: 'keep' });
  assert.equal(beginMessagesLogsLoadMore({ ...applied, phase: 'result', hasMore: true, nextCursor: 'c1' }).query.startAt, created.query.startAt);
});

test('start at local is the browser zone and rejects a calendar or gap that does not exist', () => {
  assert.deepEqual(startAtLocalToIso(''), { ok: true, iso: '' });
  assert.equal(startAtIsoToLocal(''), '');
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const known: Record<string, { field: string; nine: string; lateLocal: string; lateIso: string }> = {
    'America/Sao_Paulo': {
      field: '2026-10-22T08:51:00',
      nine: '2026-10-22T12:00:00Z',
      lateLocal: '2026-10-22T22:00:00',
      lateIso: '2026-10-23T01:00:00Z',
    },
    UTC: {
      field: '2026-10-22T11:51:00',
      nine: '2026-10-22T09:00:00Z',
      lateLocal: '2026-10-22T22:00:00',
      lateIso: '2026-10-22T22:00:00Z',
    },
    'Etc/UTC': {
      field: '2026-10-22T11:51:00',
      nine: '2026-10-22T09:00:00Z',
      lateLocal: '2026-10-22T22:00:00',
      lateIso: '2026-10-22T22:00:00Z',
    },
    'Asia/Kolkata': {
      field: '2026-10-22T17:21:00',
      nine: '2026-10-22T03:30:00Z',
      lateLocal: '2026-10-22T02:00:00',
      lateIso: '2026-10-21T20:30:00Z',
    },
  };
  const expected = known[zone];
  const initialIso = '2026-10-22T11:51:00Z';
  if (expected) {
    assert.equal(startAtIsoToLocal(initialIso), expected.field);
    assert.deepEqual(startAtLocalToIso('2026-10-22T09:00:00'), { ok: true, iso: expected.nine });
    assert.deepEqual(startAtLocalToIso(expected.lateLocal), { ok: true, iso: expected.lateIso });
  }
  const nine = startAtLocalToIso('2026-10-22T09:00:00');
  assert.equal(nine.ok, true);
  if (nine.ok) {
    const wall = new Date(2026, 9, 22, 9, 0, 0);
    assert.equal(nine.iso, wall.toISOString().replace('.000Z', 'Z'));
    assert.equal(startAtIsoToLocal(nine.iso), '2026-10-22T09:00:00');
    assert.match(messagesLogsStartAtContext(nine.iso), / UTC[+-]\d{2}:\d{2}$/);
  }
  assert.equal(startAtLocalToIso('2026-02-31T00:00:00').ok, false);
  assert.equal(startAtLocalToIso('2026-10-22T24:00:00').ok, false);
  const gap = new Date(2018, 10, 4, 0, 30, 0);
  const gapFolded = gap.getFullYear() !== 2018 || gap.getMonth() !== 10 || gap.getDate() !== 4 || gap.getHours() !== 0 || gap.getMinutes() !== 30;
  const gapResult = startAtLocalToIso('2018-11-04T00:30:00');
  assert.equal(gapResult.ok, !gapFolded);
  const repeated = new Date(2019, 1, 16, 23, 30, 0);
  const repeatedResult = startAtLocalToIso('2019-02-16T23:30:00');
  assert.equal(repeatedResult.ok, true);
  if (repeatedResult.ok) assert.equal(repeatedResult.iso, repeated.toISOString().replace('.000Z', 'Z'));
});
