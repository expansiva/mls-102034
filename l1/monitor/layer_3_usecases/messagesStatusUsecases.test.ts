/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/messagesStatusUsecases.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessagesStatusHandler } from '/_102034_/l1/monitor/layer_2_controllers/messagesHandlers.js';
import { createMonitorRouter } from '/_102034_/l1/monitor/layer_2_controllers/router.js';
import {
  isLocalMsgTarget,
  loadMessagesStatus,
  msgHealthUrl,
  msgReadyUrl,
  resolveMsgProxyTarget,
} from '/_102034_/l1/monitor/layer_3_usecases/messagesStatusUsecases.js';
import type { MonitorMessagesStatusResponse } from '/_102034_/l2/monitor/shared/contracts/messages.js';
import type { IRequestEnvelope } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

const NOW = new Date('2026-09-06T12:00:00.000Z');
const STORAGE_OK = {
  dynamoRegion: 'us-east-1',
  s3Region: 'us-east-1',
  bucket: 'org-bucket',
  tablePrefix: '',
  instanceId: 'org-1',
  accountId: '123456789012',
  ok: true,
};
const STORAGE_ERROR = {
  dynamoRegion: 'us-east-1',
  s3Region: 'us-east-1',
  bucket: 'org-bucket',
  tablePrefix: '',
  instanceId: 'org-1',
  ok: false,
  error: 'UnrecognizedClientException',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetch(routes: Record<string, Response | Error>): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const hit = routes[url];
    if (!hit) throw new Error(`unexpected fetch ${url}`);
    if (hit instanceof Error) throw hit;
    return hit;
  }) as typeof fetch;
}

const PM2_SAMPLE = [
  {
    name: 'msg',
    pm2_env: { status: 'online', restart_time: 2, pm_uptime: NOW.getTime() - 60_000 },
    monit: { memory: 80 * 1024 * 1024, cpu: 1.2 },
  },
  {
    name: 'msg',
    pm2_env: { status: 'online', restart_time: 1, pm_uptime: NOW.getTime() - 50_000 },
    monit: { memory: 70 * 1024 * 1024, cpu: 0.8 },
  },
  {
    name: 'msg-worker',
    pm2_env: { status: 'online', restart_time: 0, pm_uptime: NOW.getTime() - 120_000 },
    monit: { memory: 40 * 1024 * 1024, cpu: 0.1 },
  },
  { name: 'app2051', pm2_env: { status: 'online', restart_time: 9 } },
];

test('resolveMsgProxyTarget defaults to loopback 8180 and strips a trailing slash', () => {
  assert.equal(resolveMsgProxyTarget({}), 'http://127.0.0.1:8180');
  assert.equal(
    resolveMsgProxyTarget({ MSG_PROXY_TARGET: 'https://100554.collabcodes.com/' }),
    'https://100554.collabcodes.com',
  );
});

test('local target uses /health; remote target uses /msg/health on the host origin', () => {
  assert.equal(isLocalMsgTarget('http://127.0.0.1:8180'), true);
  assert.equal(isLocalMsgTarget('http://localhost:8180'), true);
  assert.equal(isLocalMsgTarget('https://100554.collabcodes.com'), false);
  assert.equal(msgHealthUrl('http://127.0.0.1:8180', true), 'http://127.0.0.1:8180/health');
  assert.equal(
    msgHealthUrl('https://100554.collabcodes.com', false),
    'https://100554.collabcodes.com/msg/health',
  );
  assert.equal(
    msgReadyUrl('https://100554.collabcodes.com', false),
    'https://100554.collabcodes.com/msg/ready',
  );
});

test('loadMessagesStatus health ok returns storage and local pm2', async () => {
  let pm2Calls = 0;
  const status = await loadMessagesStatus({
    getTarget: () => 'http://127.0.0.1:8180',
    now: () => NOW,
    listPm2: () => {
      pm2Calls += 1;
      return PM2_SAMPLE;
    },
    fetchFn: mockFetch({
      'http://127.0.0.1:8180/health': jsonResponse(200, {
        status: 'ok',
        storage: { ...STORAGE_OK, awsAccessKeyId: 'AKIA-MUST-NOT-LEAK' },
      }),
      'http://127.0.0.1:8180/ready': jsonResponse(200, { statusCode: 200, status: 'ready' }),
    }),
  });

  assert.equal(status.local, true);
  assert.equal(status.target, 'http://127.0.0.1:8180');
  assert.equal(status.health.reachable, true);
  assert.equal(status.health.storage?.ok, true);
  assert.equal(status.health.storage?.accountId, '123456789012');
  assert.equal(status.health.storage?.dynamoRegion, 'us-east-1');
  assert.equal(status.health.storage?.bucket, 'org-bucket');
  assert.equal(status.health.storage?.instanceId, 'org-1');
  assert.equal('awsAccessKeyId' in (status.health.storage ?? {}), false);
  assert.equal(status.ready.status, 'ready');
  assert.equal(pm2Calls, 1);
  assert.equal(status.pm2.length, 2);
  assert.deepEqual(
    status.pm2.map((proc) => ({ name: proc.name, instances: proc.instances, restarts: proc.restarts, status: proc.status })),
    [
      { name: 'msg', instances: 2, restarts: 3, status: 'online' },
      { name: 'msg-worker', instances: 1, restarts: 0, status: 'online' },
    ],
  );
});

test('loadMessagesStatus surfaces the AWS error code when storage is not ok', async () => {
  const status = await loadMessagesStatus({
    getTarget: () => 'http://127.0.0.1:8180',
    now: () => NOW,
    listPm2: () => [],
    fetchFn: mockFetch({
      'http://127.0.0.1:8180/health': jsonResponse(200, { status: 'ok', storage: STORAGE_ERROR }),
      'http://127.0.0.1:8180/ready': jsonResponse(503, {
        statusCode: 503,
        status: 'not-ready',
        error: 'UnrecognizedClientException',
      }),
    }),
  });

  assert.equal(status.health.storage?.ok, false);
  assert.equal(status.health.storage?.error, 'UnrecognizedClientException');
  assert.equal(status.ready.statusCode, 503);
  assert.equal(status.ready.status, 'not-ready');
  assert.equal(status.ready.error, 'UnrecognizedClientException');
});

test('remote target reports where /msg points and skips local pm2', async () => {
  let pm2Calls = 0;
  const fetched: string[] = [];
  const target = 'https://100554.collabcodes.com';
  const status = await loadMessagesStatus({
    getTarget: () => target,
    now: () => NOW,
    listPm2: () => {
      pm2Calls += 1;
      return PM2_SAMPLE;
    },
    fetchFn: (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      fetched.push(url);
      if (url === `${target}/msg/health`) {
        return jsonResponse(200, { status: 'ok', storage: STORAGE_OK });
      }
      if (url === `${target}/msg/ready`) {
        return jsonResponse(200, { statusCode: 200, status: 'ready' });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch,
  });

  assert.equal(status.local, false);
  assert.equal(status.target, target);
  assert.deepEqual(fetched, [`${target}/msg/health`, `${target}/msg/ready`]);
  assert.equal(pm2Calls, 0);
  assert.deepEqual(status.pm2, []);
  assert.equal(status.health.storage?.accountId, '123456789012');
});

test('createMessagesStatusHandler returns ok when the upstream is unreachable', async () => {
  const handler = createMessagesStatusHandler({
    getTarget: () => 'http://127.0.0.1:8180',
    now: () => NOW,
    listPm2: () => {
      throw new Error('pm2 missing');
    },
    fetchFn: mockFetch({
      'http://127.0.0.1:8180/health': new Error('fetch failed'),
      'http://127.0.0.1:8180/ready': new Error('fetch failed'),
    }),
  });
  const envelope = { request: { routine: 'monitor.messages.status', params: {} }, ctx: {} } as IRequestEnvelope;
  const response = await handler(envelope);
  assert.equal(response.ok, true);
  const data = response.data as MonitorMessagesStatusResponse | null;
  assert.equal(data?.health.reachable, false);
  assert.match(data?.health.error ?? '', /fetch failed/);
  assert.equal(data?.pm2Error, 'pm2 missing');
});

test('createMonitorRouter registers monitor.messages.status', () => {
  assert.equal(createMonitorRouter().has('monitor.messages.status'), true);
});
