/// <mls fileReference="_102034_/l1/monitor/layer_2_controllers/releaseHandlers.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listLogTargets,
  selectLogTarget,
} from '/_102034_/l1/monitor/layer_2_controllers/releaseHandlers.js';

function makeFixture(): { logsDir: string; msgLogsDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'cm09-logs-'));
  const logsDir = join(root, 'runtime-logs');
  const msgLogsDir = join(root, 'msg-logs');
  mkdirSync(logsDir);
  mkdirSync(msgLogsDir);
  writeFileSync(join(logsDir, 'app2051-out.log'), 'app out\n');
  writeFileSync(join(logsDir, 'app2051-error.log'), 'app err\n');
  writeFileSync(join(logsDir, 'app-out.log'), 'legacy out\n');
  writeFileSync(join(logsDir, 'notes.txt'), 'ignored\n');
  writeFileSync(join(msgLogsDir, 'pm2-api-out.log'), 'msg api out\n');
  writeFileSync(join(msgLogsDir, 'pm2-api-error.log'), 'UnrecognizedClientException\n');
  writeFileSync(join(msgLogsDir, 'pm2-worker-out.log'), 'worker out\n');
  writeFileSync(join(msgLogsDir, 'pm2-worker-error.log'), 'worker err\n');
  writeFileSync(join(msgLogsDir, 'other.log'), 'ignored\n');
  return {
    logsDir,
    msgLogsDir,
    cleanup: () => { rmSync(root, { recursive: true, force: true }); },
  };
}

test('listLogTargets maps pm2-api/pm2-worker onto msg/msg-worker and keeps app logs', () => {
  const fixture = makeFixture();
  try {
    const errorTargets = listLogTargets('error', fixture);
    assert.deepEqual(
      errorTargets.map((target) => target.app).sort(),
      ['app2051', 'msg', 'msg-worker'],
    );
    const msg = errorTargets.find((target) => target.app === 'msg');
    assert.equal(msg?.file, join(fixture.msgLogsDir, 'pm2-api-error.log'));
    const worker = errorTargets.find((target) => target.app === 'msg-worker');
    assert.equal(worker?.file, join(fixture.msgLogsDir, 'pm2-worker-error.log'));
    const app = errorTargets.find((target) => target.app === 'app2051');
    assert.equal(app?.file, join(fixture.logsDir, 'app2051-error.log'));
  } finally {
    fixture.cleanup();
  }
});

test('selectLogTarget(msg, error) tails pm2-api-error.log in the msg logs dir', () => {
  const fixture = makeFixture();
  try {
    const { target } = selectLogTarget('error', 'msg', fixture);
    assert.equal(target.app, 'msg');
    assert.equal(target.file, join(fixture.msgLogsDir, 'pm2-api-error.log'));
  } finally {
    fixture.cleanup();
  }
});

test('selectLogTarget without an app still prefers the project log over msg', () => {
  const fixture = makeFixture();
  try {
    const { target, available } = selectLogTarget('out', undefined, fixture);
    assert.equal(target.app, 'app2051');
    assert.ok(available.some((item) => item.app === 'msg'));
  } finally {
    fixture.cleanup();
  }
});

test('selectLogTarget synthesizes the msg path when the file is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'cm09-empty-'));
  const logsDir = join(root, 'runtime-logs');
  const msgLogsDir = join(root, 'msg-logs');
  mkdirSync(logsDir);
  mkdirSync(msgLogsDir);
  try {
    const { target } = selectLogTarget('error', 'msg-worker', { logsDir, msgLogsDir });
    assert.equal(target.app, 'msg-worker');
    assert.equal(target.file, join(msgLogsDir, 'pm2-worker-error.log'));
    assert.equal(target.updatedAt, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('listLogTargets returns empty when the msg directory does not exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'cm09-nomsg-'));
  const logsDir = join(root, 'runtime-logs');
  mkdirSync(logsDir);
  writeFileSync(join(logsDir, 'app-out.log'), 'legacy\n');
  try {
    const targets = listLogTargets('out', { logsDir, msgLogsDir: join(root, 'missing') });
    assert.deepEqual(targets.map((target) => target.app), ['app']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
