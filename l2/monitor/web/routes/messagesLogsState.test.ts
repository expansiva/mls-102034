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
  assert.equal(messagesLogsCopyText(withFilter), [
    'Process: API',
    'Output: Error output',
    'Start at (UTC): 2026-10-20T13:00:00Z',
    'Message contains: [config_error]',
    '',
    'first\nstack [config_error]',
    '2026-10-20T14:00:00Z second',
    '2026-10-20T14:00:01Z third',
  ].join('\n'));
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

test('start at local is UTC and rejects a calendar that does not exist', () => {
  assert.deepEqual(startAtLocalToIso(''), { ok: true, iso: '' });
  assert.deepEqual(startAtLocalToIso('2026-10-20T14:35:52'), { ok: true, iso: '2026-10-20T14:35:52Z' });
  const invalid = startAtLocalToIso('2026-02-31T00:00:00');
  assert.equal(invalid.ok, false);
});
