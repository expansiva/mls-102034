/// <mls fileReference="_102034_/l1/monitor/layer_2_controllers/logsPageHandlers.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createMonitorLogsPageHandler,
  monitorLogsPageHandler,
  monitorLogsTailHandler,
} from '/_102034_/l1/monitor/layer_2_controllers/releaseHandlers.js';
import { createMonitorRouter } from '/_102034_/l1/monitor/layer_2_controllers/router.js';
import type { IRequestEnvelope } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { MonitorLogPage } from '/_102034_/l2/monitor/shared/contracts/logs.js';

const APPS = [
  { app: 'msg', prefix: 'pm2-api' },
  { app: 'msg-worker', prefix: 'pm2-worker' },
] as const;
const STREAMS = ['out', 'error'] as const;

function call(handler: ReturnType<typeof createMonitorLogsPageHandler>, params: Record<string, unknown>) {
  return handler({ request: { params } } as IRequestEnvelope);
}

async function fixture(): Promise<{ msgLogsDir: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'rt110-page-'));
  const msgLogsDir = join(root, 'msg-logs');
  await mkdir(msgLogsDir);
  for (const { prefix } of APPS) {
    for (const stream of STREAMS) {
      const lines = [0, 1, 2].map((n) => `2026-10-20T12:00:0${n}: ${prefix}-${stream}-${n}`).join('\n');
      await writeFile(join(msgLogsDir, `${prefix}-${stream}.log`), `${lines}\n`);
    }
  }
  return { msgLogsDir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('router registers monitor.logs.page and keeps monitor.logs.tail', () => {
  const router = createMonitorRouter();
  assert.equal(router.get('monitor.logs.page'), monitorLogsPageHandler);
  assert.equal(router.get('monitor.logs.tail'), monitorLogsTailHandler);
});

test('page handler reads the four msg sources and refuses another app', async () => {
  const dir = await fixture();
  const handler = createMonitorLogsPageHandler({ msgLogsDir: dir.msgLogsDir });
  try {
    for (const { app, prefix } of APPS) {
      for (const stream of STREAMS) {
        const response = await call(handler, { app, stream, limit: 10 });
        assert.equal(response.ok, true);
        const page = response.data as MonitorLogPage;
        assert.equal(page.app, app);
        assert.equal(page.stream, stream);
        assert.equal(page.file.endsWith(`${prefix}-${stream}.log`), true);
        assert.deepEqual(page.entries.map((entry) => entry.text), [
          `${prefix}-${stream}-0`,
          `${prefix}-${stream}-1`,
          `${prefix}-${stream}-2`,
        ]);
      }
    }
    const foreign = await call(handler, { app: 'app2051', stream: 'error' });
    assert.equal(foreign.ok, false);
    assert.equal(foreign.error?.code, 'INVALID_LOG_QUERY');
    assert.equal(foreign.data, null);
  } finally {
    await dir.cleanup();
  }
});

test('page handler rejects a path and a cursor from another query', async () => {
  const dir = await fixture();
  const handler = createMonitorLogsPageHandler({ msgLogsDir: dir.msgLogsDir });
  try {
    const traversal = await call(handler, { app: 'msg', stream: 'error', path: '../pm2-worker-error.log' });
    assert.equal(traversal.ok, false);
    assert.equal(traversal.error?.code, 'INVALID_LOG_QUERY');

    const first = await call(handler, { app: 'msg', stream: 'error', limit: 1 });
    const cursor = (first.data as MonitorLogPage).nextCursor;
    assert.equal(typeof cursor, 'string');
    for (const params of [
      { app: 'msg-worker', stream: 'error', cursor },
      { app: 'msg', stream: 'out', cursor },
      { app: 'msg', stream: 'error', text: 'other', cursor },
    ]) {
      const response = await call(handler, params);
      assert.equal(response.ok, false, JSON.stringify(response.error));
      assert.equal(response.error?.code, 'INVALID_LOG_QUERY');
    }
  } finally {
    await dir.cleanup();
  }
});

test('missing source stays empty and an unreadable file stays an I/O error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rt110-io-'));
  const msgLogsDir = join(root, 'msg-logs');
  await mkdir(msgLogsDir);
  const blocked = join(msgLogsDir, 'pm2-api-error.log');
  await writeFile(blocked, '2026-10-20T12:00:00: secret\n');
  await chmod(blocked, 0);
  const handler = createMonitorLogsPageHandler({ msgLogsDir });
  try {
    const missing = await call(handler, { app: 'msg-worker', stream: 'out' });
    assert.equal(missing.ok, true);
    const page = missing.data as MonitorLogPage;
    assert.deepEqual(page.entries, []);
    assert.equal(page.hasMore, false);
    assert.equal(page.file.endsWith('pm2-worker-out.log'), true);

    await assert.rejects(call(handler, { app: 'msg', stream: 'error' }));
  } finally {
    await chmod(blocked, 0o644);
    await rm(root, { recursive: true, force: true });
  }
});

test('filters apply before the page cut and the cursor loads the older page', async () => {
  const dir = await fixture();
  const handler = createMonitorLogsPageHandler({ msgLogsDir: dir.msgLogsDir });
  try {
    const filtered = await call(handler, {
      app: 'msg',
      stream: 'error',
      startAt: '2026-10-20T12:00:01Z',
      text: 'pm2-api-error',
      limit: 1,
    });
    assert.equal(filtered.ok, true);
    const page = filtered.data as MonitorLogPage;
    assert.deepEqual(page.entries.map((entry) => entry.text), ['pm2-api-error-2']);
    assert.equal(page.hasMore, true);

    const older = await call(handler, {
      app: 'msg',
      stream: 'error',
      startAt: '2026-10-20T12:00:01Z',
      text: 'pm2-api-error',
      limit: 1,
      cursor: page.nextCursor,
    });
    assert.equal(older.ok, true);
    assert.deepEqual((older.data as MonitorLogPage).entries.map((entry) => entry.text), ['pm2-api-error-1']);
  } finally {
    await dir.cleanup();
  }
});

test('legacy tail keeps lines, available and the requested app', async () => {
  const response = await monitorLogsTailHandler({
    request: { params: { app: 'msg', stream: 'error', lines: 3 } },
  } as IRequestEnvelope);
  assert.equal(response.ok, true);
  const data = response.data as { app: string; stream: string; lines: string[]; available: unknown[] };
  assert.equal(data.app, 'msg');
  assert.equal(data.stream, 'error');
  assert.ok(Array.isArray(data.lines));
  assert.ok(data.lines.length <= 3);
  assert.ok(Array.isArray(data.available));
});
