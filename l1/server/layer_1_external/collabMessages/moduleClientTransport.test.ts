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
import type {
  AgentIntentModuleAdvance,
  RequestEnsureModuleThread,
  RequestGetModuleTask,
  RequestListModuleTasks,
  RequestOpenModuleTask,
} from '/_102036_/l2/shared/interfaces.js';

const TOKEN_A = 'sentinel-rt94-transport-a';
const TOKEN_B = 'sentinel-rt94-transport-b';
const TOKEN_ROTATED = 'sentinel-rt94-transport-rotated';
const TOKEN_GLOBAL = 'sentinel-rt94-transport-global';
const APP_A = '102094';
const APP_B = '102095';
const ORG_A = 'org-private-a';
const ORG_B = 'org-private-b';
const ORG_ENV = 'org-from-env';
const USER = 'cm-user-tech';
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

const savedConsole = {
  error: console.error,
  warn: console.warn,
  log: console.log,
  info: console.info,
};

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
  console.error = savedConsole.error;
  console.warn = savedConsole.warn;
  console.log = savedConsole.log;
  console.info = savedConsole.info;
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
  const dir = mkdtempSync(join(tmpdir(), 'rt94-transport-'));
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

function ref(project: string): RequestGetModuleTask['ref'] {
  return { project, module: 'mod', entity: 'order', recordId: 'rec-1', processId: 'proc-1' };
}

function ensureInput(project: string): Omit<RequestEnsureModuleThread, 'action' | 'userId'> {
  return { email: 'a@b.c', project, module: 'mod', name: 'Room' };
}

function openInput(project: string): Omit<RequestOpenModuleTask, 'action' | 'userId'> {
  return {
    ref: { ...ref(project), workflowVersion: null },
    plan: {
      processId: 'proc-1',
      title: 'plan',
      moduleTitle: 'Module',
      steps: [{ key: 's', kind: 'mechanical', ownerKind: 'module', next: [] }],
    },
    startStep: 's',
    origin: { kind: 'schedule', config: 'nightly' },
    owner: 'owner-1',
    actorNow: null,
    title: 't',
    room: { mode: 'exclusive' },
    message: { content: 'opened' },
  };
}

function listInput(project: string): Omit<RequestListModuleTasks, 'action' | 'userId'> {
  return { project, module: 'mod', processId: 'proc-1', cursor: 'cursor-1', pageSize: 20 };
}

function advanceIntent(taskId = 'task-1'): AgentIntentModuleAdvance {
  return {
    type: 'module-advance',
    taskId,
    commandId: 'cmd-1',
    expectedRevision: 4,
    from: 's',
    to: 's2',
    actorNow: null,
    executor: { kind: 'routine', name: 'nightly' },
    wake: { everyMinutes: 15, routine: 'nightly' },
    message: { content: 'advanced' },
  };
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

function assertTimeout(err: unknown): void {
  assert.ok(err instanceof AppError);
  assert.equal(err.code, 'MSG_SERVICE_TIMEOUT');
  assert.equal(err.statusCode, 504);
  assert.equal(err.cause, undefined);
  assertNoSecret(`${err.name} ${err.message} ${err.code} ${JSON.stringify(err.details ?? null)}`);
}

async function drain(sockets: () => number): Promise<void> {
  const deadline = Date.now() + 8000;
  while (sockets() !== 0 && Date.now() < deadline) {
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
  assert.equal(sockets(), 0);
}

describe('module messages client loopback', () => {
  it('keeps each app on its own credential and leaves the global token to common calls', async () => {
    const dir = projectFilesDir();
    writeAppFile(dir, APP_A, TOKEN_A, ORG_A);
    writeAppFile(dir, APP_B, TOKEN_B, ORG_B);
    const seen: Seen[] = [];
    const server = await listen(async (req, res) => {
      const body = await readBody(req);
      seen.push(capture(req, body));
      const action = body.action;
      const payload = action === 'listModuleTasks'
        ? { statusCode: 200, items: [], cursor: 'next' }
        : action === 'applyIntents'
          ? { statusCode: 200, code: 'applied', task: { taskId: 'shared-task', revision: 5 } }
          : action === 'addMessage'
            ? { statusCode: 200, msg: 'ok' }
            : { statusCode: 200, task: { taskId: 'shared-task' }, room: { id: 'room' }, created: true, thread: { id: 'th' }, userId: USER };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
    const clientA = clientFor(server.port, APP_A);
    const clientB = clientFor(server.port, APP_B);
    const intentA = advanceIntent('shared-task');
    const intentB = advanceIntent('shared-task');
    await Promise.all([
      clientA.ensureModuleThread(USER, ensureInput(APP_A)),
      clientB.ensureModuleThread(USER, ensureInput(APP_B)),
      clientA.openModuleTask(USER, openInput(APP_A)),
      clientB.openModuleTask(USER, openInput(APP_B)),
      clientA.getModuleTask(USER, { ref: ref(APP_A) }),
      clientB.getModuleTask(USER, { ref: ref(APP_B) }),
      clientA.listModuleTasks(USER, listInput(APP_A)),
      clientB.listModuleTasks(USER, listInput(APP_B)),
      clientA.advanceModuleTask(USER, intentA),
      clientB.advanceModuleTask(USER, intentB),
      clientA.addMessage(USER, { threadId: 'th', content: 'common-a' }),
      clientB.addMessage(USER, { threadId: 'th', content: 'common-b' }),
    ]);

    assert.equal(server.hits(), 12);
    assert.equal(seen.length, 12);
    const moduleCalls = seen.filter((row) => row.action !== 'addMessage');
    const commonCalls = seen.filter((row) => row.action === 'addMessage');
    assert.equal(moduleCalls.length, 10);
    assert.equal(commonCalls.length, 2);
    for (const row of moduleCalls) {
      assert.equal(row.cookie, undefined);
      assert.equal(row.userHeader, USER);
      assert.equal(row.userId, USER);
      assert.notEqual(row.authorization, `Bearer ${TOKEN_GLOBAL}`);
      assert.notEqual(row.orgHeader, ORG_ENV);
      if (row.appHeader === APP_A) {
        assert.equal(row.authorization, `Bearer ${TOKEN_A}`);
        assert.equal(row.orgHeader, ORG_A);
      } else {
        assert.equal(row.appHeader, APP_B);
        assert.equal(row.authorization, `Bearer ${TOKEN_B}`);
        assert.equal(row.orgHeader, ORG_B);
      }
    }
    for (const row of commonCalls) {
      assert.equal(row.cookie, undefined);
      assert.equal(row.authorization, `Bearer ${TOKEN_GLOBAL}`);
      assert.equal(row.orgHeader, ORG_ENV);
      assert.equal(row.userHeader, USER);
    }
    const advances = moduleCalls.filter((row) => row.action === 'applyIntents');
    assert.equal(advances.length, 2);
    for (const row of advances) {
      const intents = row.body.intents as AgentIntentModuleAdvance[];
      assert.equal(intents.length, 1);
      assert.equal(intents[0].type, 'module-advance');
      assert.equal(intents[0].commandId, 'cmd-1');
      assert.equal(intents[0].expectedRevision, 4);
      assert.equal(intents[0].taskId, 'shared-task');
    }
    assert.equal(intentA.commandId, 'cmd-1');
    assert.equal(intentB.expectedRevision, 4);
    const listed = moduleCalls.filter((row) => row.action === 'listModuleTasks');
    assert.equal(listed.length, 2);
    assert.equal(listed.every((row) => row.body.cursor === 'cursor-1' && row.body.pageSize === 20), true);
    const opened = moduleCalls.filter((row) => row.action === 'openModuleTask');
    assert.equal(opened.length, 2);
    for (const row of opened) {
      assert.equal((row.body.origin as { by?: string }).by, undefined);
      assert.equal((row.body.ref as { project: string }).project, row.appHeader);
    }
    assert.equal(moduleCalls.some((row) => row.action === 'ensureModuleThread'), true);
    assert.equal(moduleCalls.some((row) => row.action === 'getModuleTask'), true);
  });

  it('rereads a newer file and sends nothing after the configuration is removed or corrupt', async () => {
    const dir = projectFilesDir();
    const filePath = writeAppFile(dir, APP_A, TOKEN_A, ORG_A);
    const seen: Seen[] = [];
    const server = await listen(async (req, res) => {
      const body = await readBody(req);
      seen.push(capture(req, body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ statusCode: 200, task: { taskId: 't' } }));
    });
    const client = clientFor(server.port, APP_A);
    const first = await client.getModuleTask(USER, { ref: ref(APP_A) });
    assert.equal(first.httpStatus, 200);
    assert.equal(seen[0].authorization, `Bearer ${TOKEN_A}`);

    writeAppFile(dir, APP_A, TOKEN_ROTATED, ORG_A);
    bumpMtime(filePath);
    await client.getModuleTask(USER, { ref: ref(APP_A) });
    assert.equal(server.hits(), 2);
    assert.equal(seen[1].authorization, `Bearer ${TOKEN_ROTATED}`);
    assert.notEqual(seen[1].authorization, `Bearer ${TOKEN_GLOBAL}`);

    rmSync(filePath);
    const noise: string[] = [];
    const push = (...args: unknown[]) => { noise.push(args.map(String).join(' ')); };
    console.error = push as typeof console.error;
    console.warn = push as typeof console.warn;
    console.log = push as typeof console.log;
    console.info = push as typeof console.info;
    await assert.rejects(
      () => client.getModuleTask(USER, { ref: ref(APP_A) }),
      (err: unknown) => err instanceof AppError && err.code === 'MSG_APP_NOT_CONFIGURED' && err.statusCode === 503,
    );
    writeFileSync(filePath, '{');
    bumpMtime(filePath);
    await assert.rejects(
      () => client.listModuleTasks(USER, listInput(APP_A)),
      (err: unknown) => err instanceof AppError && err.statusCode === 503,
    );
    assert.equal(server.hits(), 2);
    assertNoSecret(noise.join('\n'));
  });

  it('times out a held advance once and keeps the same command on the next explicit call', async () => {
    const dir = projectFilesDir();
    writeAppFile(dir, APP_A, TOKEN_A, ORG_A);
    let mode: 'headers' | 'body' | 'ok' = 'headers';
    const seen: Seen[] = [];
    const unchanged = { statusCode: 200, code: 'unchanged', task: { taskId: 'task-1', revision: 4 } };
    const server = await listen((req, res) => {
      if (mode === 'headers') return;
      if (mode === 'body') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{"statusCode":200');
        return;
      }
      void readBody(req).then((body) => {
        seen.push(capture(req, body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(unchanged));
      });
    });
    const client = clientFor(server.port, APP_A, TIMEOUT_MS);
    const intent = advanceIntent();

    const headerStart = Date.now();
    await assert.rejects(
      () => client.advanceModuleTask(USER, intent),
      (err: unknown) => { assertTimeout(err); return true; },
    );
    const headerWait = Date.now() - headerStart;
    assert.ok(headerWait >= TIMEOUT_MS - 40);
    assert.ok(headerWait < TIMEOUT_MS + 1500);
    assert.equal(server.hits(), 1);
    assert.equal(intent.commandId, 'cmd-1');
    assert.equal(intent.expectedRevision, 4);

    mode = 'ok';
    const again = await client.advanceModuleTask(USER, intent);
    assert.equal(server.hits(), 2);
    assert.deepEqual(again, { httpStatus: 200, body: unchanged });
    const sent = (seen[0].body.intents as AgentIntentModuleAdvance[])[0];
    assert.equal(sent.commandId, 'cmd-1');
    assert.equal(sent.expectedRevision, 4);
    assert.equal(intent.commandId, 'cmd-1');
    assert.equal(intent.expectedRevision, 4);

    mode = 'body';
    const beforeBody = server.hits();
    const bodyStart = Date.now();
    await assert.rejects(
      () => client.advanceModuleTask(USER, intent),
      (err: unknown) => { assertTimeout(err); return true; },
    );
    const bodyWait = Date.now() - bodyStart;
    assert.ok(bodyWait >= TIMEOUT_MS - 40);
    assert.ok(bodyWait < TIMEOUT_MS + 1500);
    assert.equal(server.hits(), beforeBody + 1);
    assert.equal(intent.commandId, 'cmd-1');
    await drain(server.sockets);
  });

  it('does not follow a module redirect and preserves error envelopes without a new open', async () => {
    const dir = projectFilesDir();
    writeAppFile(dir, APP_A, TOKEN_A, ORG_A);
    const other = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ statusCode: 200, code: 'applied' }));
    });
    const redirect = await listen((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${other.port}/msg` });
      res.end();
    });
    const redirectClient = clientFor(redirect.port, APP_A);
    await assert.rejects(
      () => redirectClient.advanceModuleTask(USER, advanceIntent()),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'MSG_SERVICE_PROTOCOL_ERROR');
        assert.equal(err.statusCode, 502);
        assertNoSecret(`${err.message}`);
        assert.equal(err.message.includes(String(other.port)), false);
        return true;
      },
    );
    assert.equal(redirect.hits(), 1);
    assert.equal(other.hits(), 0);

    const task = { taskId: 'task-1', revision: 4 };
    const envelopes = [
      { http: 200, body: { statusCode: 403, code: 'forbidden' } },
      { http: 409, body: { statusCode: 409, code: 'conflict', task } },
      { http: 404, body: { statusCode: 404, code: 'not_found' } },
      { http: 507, body: { statusCode: 507, code: 'task_too_large' } },
    ];
    const seen: Seen[] = [];
    const front = await listen(async (req, res) => {
      const body = await readBody(req);
      seen.push(capture(req, body));
      const item = envelopes[seen.length - 1];
      res.writeHead(item.http, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(item.body));
    });
    const client = clientFor(front.port, APP_A);
    const results = [
      await client.getModuleTask(USER, { ref: ref(APP_A) }),
      await client.advanceModuleTask(USER, advanceIntent()),
      await client.getModuleTask(USER, { ref: ref(APP_A) }),
      await client.advanceModuleTask(USER, advanceIntent()),
    ];
    assert.equal(front.hits(), 4);
    assert.equal(seen.some((row) => row.action === 'openModuleTask'), false);
    assert.deepEqual(seen.map((row) => row.action), ['getModuleTask', 'applyIntents', 'getModuleTask', 'applyIntents']);
    for (let i = 0; i < envelopes.length; i += 1) {
      assert.deepEqual(results[i], { httpStatus: envelopes[i].http, body: envelopes[i].body });
    }
    assert.equal((seen[1].body.intents as AgentIntentModuleAdvance[])[0].commandId, 'cmd-1');
    assert.equal((seen[3].body.intents as AgentIntentModuleAdvance[])[0].expectedRevision, 4);
  });
});
