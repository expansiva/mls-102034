import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach } from 'node:test';
import { describe, it } from 'node:test';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createServerMessagesClient } from '/_102034_/l1/server/layer_1_external/collabMessages/client.js';

const SENTINEL = 'SENTINEL_TOKEN_rt79_transport';
const TIMEOUT_MS = 200;

type Seen = {
  action: unknown;
  userId: unknown;
  authorization: string | undefined;
  userHeader: string | undefined;
  orgHeader: string | undefined;
  cookie: string | undefined;
};

const open: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (open.length > 0) {
    const server = open.pop();
    if (server) await server.close();
  }
});

function header(req: http.IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value.join(', ');
  return value;
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => { chunks.push(chunk); });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function listen(onRequest: http.RequestListener): Promise<{ port: number; hits: () => number; sockets: () => number }> {
  const sockets = new Set<Socket>();
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    onRequest(req, res);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => { sockets.delete(socket); });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      const record = {
        async close(): Promise<void> {
          for (const socket of sockets) socket.destroy();
          if (!server.listening) return;
          await new Promise<void>((done, fail) => {
            server.close((err) => { if (err) fail(err); else done(); });
          });
        },
      };
      open.push(record);
      resolve({
        port: address.port,
        hits: () => hits,
        sockets: () => sockets.size,
      });
    });
  });
}

function clientFor(port: number, timeoutMs = TIMEOUT_MS) {
  return createServerMessagesClient({
    timeoutMs,
    env: {
      MSG_PROXY_TOKEN: SENTINEL,
      MSG_PROXY_ORG_ID: 'org-loop',
      MSG_PROXY_TARGET: `http://127.0.0.1:${port}`,
    },
  });
}

function assertTimeout(err: unknown, action: string): void {
  assert.ok(err instanceof AppError);
  assert.equal(err.code, 'MSG_SERVICE_TIMEOUT');
  assert.equal(err.statusCode, 504);
  assert.match(err.message, new RegExp(action));
  assert.equal(err.message.includes(SENTINEL), false);
}

describe('createServerMessagesClient loopback', () => {
  it('keeps caller identity and both statuses on the wire', async () => {
    const seen: Seen[] = [];
    const server = await listen(async (req, res) => {
      const body = await readBody(req);
      seen.push({
        action: body.action,
        userId: body.userId,
        authorization: header(req, 'authorization'),
        userHeader: header(req, 'x-user-id'),
        orgHeader: header(req, 'x-org-id'),
        cookie: header(req, 'cookie'),
      });
      if (body.userId === 'user-a') {
        const payload = {
          statusCode: 409,
          msg: 'conflict',
          code: 'conflict',
          task: { taskId: 'bench', workflowVersion: null, messageid_created: 'm-1' },
        };
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ statusCode: 403, msg: 'nope', code: 'forbidden' }));
    });
    const client = clientFor(server.port, 10_000);
    const [conflict, forbidden] = await Promise.all([
      client.addMessage('user-a', { threadId: 'th', content: 'a' }),
      client.getTaskUpdate('user-b', { messageId: 'm', taskId: 't' }),
    ]);

    assert.equal(seen.length, 2);
    const byUser = new Map(seen.map((row) => [row.userId, row]));
    for (const userId of ['user-a', 'user-b']) {
      const row = byUser.get(userId);
      assert.ok(row);
      assert.equal(row.authorization, `Bearer ${SENTINEL}`);
      assert.equal(row.userHeader, userId);
      assert.equal(row.orgHeader, 'org-loop');
      assert.equal(row.cookie, undefined);
    }
    assert.equal(byUser.get('user-a')?.action, 'addMessage');
    assert.equal(byUser.get('user-b')?.action, 'getTaskUpdate');
    assert.equal(conflict.httpStatus, 409);
    assert.equal(conflict.body.statusCode, 409);
    assert.deepEqual(conflict.body.task, { taskId: 'bench', workflowVersion: null, messageid_created: 'm-1' });
    assert.equal(forbidden.httpStatus, 200);
    assert.equal(forbidden.body.statusCode, 403);
    assert.equal(forbidden.body.code, 'forbidden');
  });

  it('bounds the wait for headers and for the body, then accepts a new call', async () => {
    let mode: 'headers' | 'body' | 'ok' = 'headers';
    const server = await listen((req, res) => {
      if (mode === 'headers') return;
      if (mode === 'body') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{"statusCode":200');
        return;
      }
      void readBody(req).then(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ statusCode: 200, msg: 'later' }));
      });
    });
    const client = clientFor(server.port);

    const headerStart = Date.now();
    await assert.rejects(
      () => client.addMessage('user-a', { threadId: 'th', content: 'hold-headers' }),
      (err: unknown) => { assertTimeout(err, 'addMessage'); return true; },
    );
    const headerWait = Date.now() - headerStart;
    assert.ok(headerWait >= TIMEOUT_MS - 40);
    assert.ok(headerWait < TIMEOUT_MS + 1500);

    mode = 'ok';
    const again = await client.addMessage('user-a', { threadId: 'th', content: 'after' });
    assert.equal(again.httpStatus, 200);
    assert.equal(again.body.statusCode, 200);

    mode = 'body';
    const bodyStart = Date.now();
    await assert.rejects(
      () => client.addUserInThread('user-b', { userIdOrName: 'b', threadId: 'th', auth: 'read' } as never),
      (err: unknown) => { assertTimeout(err, 'addUserInThread'); return true; },
    );
    const bodyWait = Date.now() - bodyStart;
    assert.ok(bodyWait >= TIMEOUT_MS - 40);
    assert.ok(bodyWait < TIMEOUT_MS + 1500);

    const deadline = Date.now() + 8000;
    while (server.sockets() !== 0 && Date.now() < deadline) {
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    }
    assert.equal(server.sockets(), 0);
  });

  it('does not follow a redirect to a second local server', async () => {
    const other = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ statusCode: 200 }));
    });
    const front = await listen((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${other.port}/msg` });
      res.end();
    });
    const client = clientFor(front.port, 10_000);
    await assert.rejects(
      () => client.openModuleTask('user-a', {
        threadId: 'th',
        title: 't',
        content: 'c',
        ref: { moduleId: 'm' },
        step: 's',
      } as never),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'MSG_SERVICE_PROTOCOL_ERROR');
        assert.equal(err.statusCode, 502);
        assert.equal(err.message.includes(SENTINEL), false);
        assert.equal(err.message.includes(String(other.port)), false);
        return true;
      },
    );
    assert.equal(front.hits(), 1);
    assert.equal(other.hits(), 0);
  });
});
