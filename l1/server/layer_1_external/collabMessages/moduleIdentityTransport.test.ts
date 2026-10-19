import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createServerMessagesClient } from '/_102034_/l1/server/layer_1_external/collabMessages/client.js';
import type { ServerMessagesClient } from '/_102034_/l1/server/layer_1_external/collabMessages/client.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

const TOKEN_A = 'sentinel-rt102-transport-a';
const TOKEN_B = 'sentinel-rt102-transport-b';
const TOKEN_ROTATED = 'sentinel-rt102-transport-rotated';
const TOKEN_GLOBAL = 'sentinel-rt102-transport-global';
const APP_A = '102094';
const APP_B = '102095';
const ORG_A = 'org-private-a';
const ORG_B = 'org-private-b';
const ORG_ENV = 'org-from-env';
const TIMEOUT_MS = 200;
const SECRETS = [TOKEN_A, TOKEN_B, TOKEN_ROTATED, TOKEN_GLOBAL];

type Seen = {
  action: unknown;
  userId: unknown;
  body: Record<string, unknown>;
  authorization: string | undefined;
  userHeader: string | undefined;
  orgHeader: string | undefined;
  appHeader: string | undefined;
  cookie: string | undefined;
};

const open: Array<{ close: () => Promise<void> }> = [];
const tempDirs: string[] = [];
const envKeys = ['CBE_PROJECT_FILES_DIR'] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const key of envKeys) savedEnv[key] = process.env[key];

afterEach(async () => {
  while (open.length > 0) {
    const server = open.pop();
    if (server) await server.close();
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
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
      open.push({
        async close(): Promise<void> {
          for (const socket of sockets) socket.destroy();
          if (!server.listening) return;
          await new Promise<void>((done, fail) => {
            server.close((err) => { if (err) fail(err); else done(); });
          });
        },
      });
      resolve({
        port: address.port,
        hits: () => hits,
        sockets: () => sockets.size,
      });
    });
  });
}

function projectFilesDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rt102-transport-'));
  tempDirs.push(dir);
  process.env.CBE_PROJECT_FILES_DIR = dir;
  return dir;
}

function appFile(dir: string, projectId: string): string {
  return join(dir, `${projectId}.json`);
}

function writeAppFile(dir: string, projectId: string, token: string, orgId: string): string {
  const filePath = appFile(dir, projectId);
  writeFileSync(filePath, JSON.stringify({
    schema: 1,
    generatedAt: '2026-10-19T00:00:00.000Z',
    org: { orgId, slug: 'private', name: 'Private', createdAt: '2026-10-19T00:00:00.000Z' },
    project: {
      projectId,
      domain: 'app.test',
      appEnv: null,
      language: null,
      type: 'app',
      createdAt: '2026-10-19T00:00:00.000Z',
    },
    collabMessages: { token },
  }));
  return filePath;
}

function bumpMtime(filePath: string): void {
  const future = new Date(Date.now() + 5000);
  utimesSync(filePath, future, future);
}

function clientFor(port: number, projectId?: string, timeoutMs = 10_000): ServerMessagesClient {
  return createServerMessagesClient({
    projectId,
    timeoutMs,
    env: {
      MSG_PROXY_TOKEN: TOKEN_GLOBAL,
      MSG_PROXY_ORG_ID: ORG_ENV,
      MSG_PROXY_USER_ID: 'user-from-env',
      MSG_PROXY_TARGET: `http://127.0.0.1:${port}`,
    },
  });
}

function tech(projectId: string): string {
  return `app:${projectId}`;
}

function capture(req: http.IncomingMessage, body: Record<string, unknown>): Seen {
  return {
    action: body.action,
    userId: body.userId,
    body,
    authorization: header(req, 'authorization'),
    userHeader: header(req, 'x-user-id'),
    orgHeader: header(req, 'x-org-id'),
    appHeader: header(req, 'x-app-id'),
    cookie: header(req, 'cookie'),
  };
}

function assertNoSecret(value: string): void {
  for (const secret of SECRETS) assert.equal(value.includes(secret), false);
}

describe('module identity client loopback', () => {
  it('keeps each app on its own credential for link and resolve', async () => {
    const dir = projectFilesDir();
    writeAppFile(dir, APP_A, TOKEN_A, ORG_A);
    writeAppFile(dir, APP_B, TOKEN_B, ORG_B);
    const seen: Seen[] = [];
    const server = await listen(async (req, res) => {
      const body = await readBody(req);
      seen.push(capture(req, body));
      const payload = body.action === 'linkModulePerson'
        ? { statusCode: 200, cmUserId: 'cm-1', outcome: body.loginEmail === 'gone@app.test' ? 'existing' : 'linked' }
        : { statusCode: 200, people: [{ mdmId: 'mdm-1', cmUserId: 'cm-1', state: 'unlinked' }] };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
    const clientA = clientFor(server.port, APP_A);
    const clientB = clientFor(server.port, APP_B);
    await Promise.all([
      clientA.linkModulePerson(tech(APP_A), { mdmId: 'mdm-1', loginEmail: 'a@app.test' }),
      clientB.linkModulePerson(tech(APP_B), { mdmId: 'mdm-1', loginEmail: 'b@app.test' }),
      clientA.resolveModulePeople(tech(APP_A), { mdmIds: ['mdm-1'] }),
      clientB.resolveModulePeople(tech(APP_B), { cmUserIds: ['cm-1'] }),
    ]);
    assert.equal(server.hits(), 4);
    for (const row of seen) {
      assert.equal(row.cookie, undefined);
      assert.notEqual(row.authorization, `Bearer ${TOKEN_GLOBAL}`);
      assert.notEqual(row.orgHeader, ORG_ENV);
      assert.equal(row.action === 'linkModulePerson' || row.action === 'resolveModulePeople', true);
      if (row.appHeader === APP_A) {
        assert.equal(row.authorization, `Bearer ${TOKEN_A}`);
        assert.equal(row.orgHeader, ORG_A);
        assert.equal(row.userHeader, tech(APP_A));
        assert.equal(row.userId, tech(APP_A));
      } else {
        assert.equal(row.appHeader, APP_B);
        assert.equal(row.authorization, `Bearer ${TOKEN_B}`);
        assert.equal(row.orgHeader, ORG_B);
        assert.equal(row.userHeader, tech(APP_B));
        assert.equal(row.userId, tech(APP_B));
      }
    }
  });

  it('rereads a rotated credential on the next identity call', async () => {
    const dir = projectFilesDir();
    const filePath = writeAppFile(dir, APP_A, TOKEN_A, ORG_A);
    const seen: Seen[] = [];
    const server = await listen(async (req, res) => {
      const body = await readBody(req);
      seen.push(capture(req, body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ statusCode: 200, cmUserId: 'cm-1', outcome: 'linked' }));
    });
    const client = clientFor(server.port, APP_A);
    await client.linkModulePerson(tech(APP_A), { mdmId: 'mdm-1', loginEmail: 'a@app.test' });
    assert.equal(seen[0].authorization, `Bearer ${TOKEN_A}`);
    writeAppFile(dir, APP_A, TOKEN_ROTATED, ORG_A);
    bumpMtime(filePath);
    await client.resolveModulePeople(tech(APP_A), { mdmIds: ['mdm-1'] });
    assert.equal(server.hits(), 2);
    assert.equal(seen[1].authorization, `Bearer ${TOKEN_ROTATED}`);
    assert.equal(seen[1].action, 'resolveModulePeople');
  });

  it('times out one link and does not send a second request', async () => {
    const dir = projectFilesDir();
    writeAppFile(dir, APP_A, TOKEN_A, ORG_A);
    const server = await listen(() => {
      // hold headers so the client times out
    });
    const client = clientFor(server.port, APP_A, TIMEOUT_MS);
    const start = Date.now();
    await assert.rejects(
      () => client.linkModulePerson(tech(APP_A), { mdmId: 'mdm-1', loginEmail: 'a@app.test' }),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'MSG_SERVICE_TIMEOUT');
        assert.equal(err.statusCode, 504);
        assertNoSecret(`${err.message} ${err.code}`);
        return true;
      },
    );
    const waited = Date.now() - start;
    assert.ok(waited >= TIMEOUT_MS - 40);
    assert.equal(server.hits(), 1);
    await new Promise((resolve) => { setTimeout(resolve, TIMEOUT_MS); });
    assert.equal(server.hits(), 1);
  });

  it('preserves identity error envelopes without another call', async () => {
    const dir = projectFilesDir();
    writeAppFile(dir, APP_A, TOKEN_A, ORG_A);
    const envelopes = [
      { http: 409, body: { statusCode: 409, code: 'link_conflict' } },
      { http: 200, body: { statusCode: 200, people: [{ mdmId: 'mdm-9', state: 'removed' }] } },
      { http: 404, body: { statusCode: 404, code: 'user_not_found' } },
    ];
    const seen: Seen[] = [];
    const server = await listen(async (req, res) => {
      const body = await readBody(req);
      seen.push(capture(req, body));
      const item = envelopes[seen.length - 1];
      res.writeHead(item.http, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(item.body));
    });
    const client = clientFor(server.port, APP_A);
    const results = [
      await client.linkModulePerson(tech(APP_A), { mdmId: 'mdm-1', loginEmail: 'a@app.test', userId: 'nope', action: 'addMessage' } as { mdmId: string; loginEmail: string }),
      await client.resolveModulePeople(tech(APP_A), { mdmIds: ['mdm-9'] }),
      await client.linkModulePerson(tech(APP_A), { mdmId: 'mdm-1', loginEmail: 'a@app.test' }),
    ];
    assert.equal(server.hits(), 3);
    assert.deepEqual(seen.map((row) => row.action), ['linkModulePerson', 'resolveModulePeople', 'linkModulePerson']);
    assert.equal(seen[0].userId, tech(APP_A));
    for (let i = 0; i < envelopes.length; i += 1) {
      assert.deepEqual(results[i], { httpStatus: envelopes[i].http, body: envelopes[i].body });
    }
  });
});
