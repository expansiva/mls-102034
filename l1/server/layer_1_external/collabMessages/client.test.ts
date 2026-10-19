import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createServerMessagesClient } from '/_102034_/l1/server/layer_1_external/collabMessages/client.js';
import type { RequestEnsureModuleThread, RequestOpenModuleTask } from '/_102036_/l2/shared/interfaces.js';

const SENTINEL = 'SENTINEL_TOKEN_rt79';
const APP_SENTINEL = 'SENTINEL_TOKEN_rt94_app';

type Seen = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  redirect: string;
};

const envKeys = ['MSG_PROXY_TOKEN', 'MSG_PROXY_USER_ID', 'MSG_PROXY_ORG_ID', 'MSG_PROXY_TARGET', 'CBE_PROJECT_FILES_DIR'] as const;
const saved: Record<string, string | undefined> = {};
const tempDirs: string[] = [];

function saveEnv(): void {
  for (const key of envKeys) saved[key] = process.env[key];
}

function restoreEnv(): void {
  for (const key of envKeys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

saveEnv();

afterEach(() => {
  restoreEnv();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PROJECT_ID = '102094';
const PRIVATE_ORG = 'org-private-rt94';

function projectFilesDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rt94-cm-'));
  tempDirs.push(dir);
  process.env.CBE_PROJECT_FILES_DIR = dir;
  return dir;
}

function writeAppFile(dir: string, projectId: string, token: string, orgId = PRIVATE_ORG): string {
  const filePath = join(dir, `${projectId}.json`);
  writeFileSync(filePath, JSON.stringify({
    schema: 1,
    generatedAt: '2026-10-19T00:00:00.000Z',
    org: { orgId, slug: 'private', name: 'Private', createdAt: '2026-10-19T00:00:00.000Z' },
    project: { projectId, domain: 'app.test', appEnv: null, language: null, type: 'app', createdAt: '2026-10-19T00:00:00.000Z' },
    collabMessages: { token },
  }));
  return filePath;
}

function ensureInput(project = PROJECT_ID): Omit<RequestEnsureModuleThread, 'action' | 'userId'> {
  return { email: 'a@b.c', project, module: 'm', name: 'n' };
}

function openInput(project = PROJECT_ID): Omit<RequestOpenModuleTask, 'action' | 'userId'> {
  return {
    ref: { project, module: 'm', entity: 'e', recordId: 'r', processId: 'proc', workflowVersion: null },
    plan: {
      processId: 'proc',
      title: 'plan',
      moduleTitle: 'module',
      steps: [{ key: 's', kind: 'mechanical', ownerKind: 'module', next: [] }],
    },
    startStep: 's',
    origin: { kind: 'schedule', config: 'nightly' },
    owner: 'owner-1',
    actorNow: null,
    title: 't',
    room: { mode: 'exclusive' },
  };
}

function baseEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    MSG_PROXY_TOKEN: SENTINEL,
    MSG_PROXY_TARGET: 'http://cm.test',
    ...extra,
  };
}

function mockFetch(handler: (seen: Seen) => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: Seen[];
} {
  const calls: Seen[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers: Record<string, string> = {};
    const raw = init?.headers;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [key, value] of Object.entries(raw as Record<string, string>)) headers[key] = value;
    }
    const seen: Seen = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      redirect: init?.redirect ?? '',
    };
    calls.push(seen);
    return handler(seen);
  };
  return { fetchImpl, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function assertNoSentinel(err: unknown): void {
  const error = err as AppError & { cause?: unknown };
  const blob = `${error.message}\n${JSON.stringify(error.details ?? null)}\n${String(error.cause ?? '')}`;
  assert.equal(blob.includes(SENTINEL), false);
  assert.equal(error.message.includes('http://'), false);
}

const actions = [
  {
    name: 'applyIntents' as const,
    call: 'applyIntents' as const,
    input: { intents: [{ kind: 'x' }], action: 'nope', userId: 'body-user' },
    expect: { intents: [{ kind: 'x' }] },
  },
  {
    name: 'getTaskUpdate' as const,
    call: 'getTaskUpdate' as const,
    input: { messageId: 'mid', taskId: 'tid', action: 'nope', userId: 'body-user' },
    expect: { messageId: 'mid', taskId: 'tid' },
  },
  {
    name: 'addMessage' as const,
    call: 'addMessage' as const,
    input: { threadId: 'th', content: 'hi', action: 'nope', userId: 'body-user' },
    expect: { threadId: 'th', content: 'hi' },
  },
  {
    name: 'addUserInThread' as const,
    call: 'addUserInThread' as const,
    input: { userIdOrName: 'who', threadId: 'th', auth: 'read', action: 'nope', userId: 'body-user' },
    expect: { userIdOrName: 'who', threadId: 'th', auth: 'read' },
  },
];

describe('createServerMessagesClient', () => {
  it('posts module operations with the application credential and leaves input intact', async () => {
    const dir = projectFilesDir();
    writeAppFile(dir, PROJECT_ID, APP_SENTINEL);
    async function postModule<T extends object>(
      input: T,
      expectBody: Record<string, unknown>,
      run: (client: ReturnType<typeof createServerMessagesClient>, input: T) => Promise<{ httpStatus: number }>,
    ): Promise<void> {
      const snapshot = { ...input };
      const { fetchImpl, calls } = mockFetch(() => jsonResponse(200, { statusCode: 200, task: { id: 't1' } }));
      const client = createServerMessagesClient({
        projectId: PROJECT_ID,
        env: baseEnv({ MSG_PROXY_ORG_ID: 'org-from-env', MSG_PROXY_USER_ID: 'proxy-default' }),
        fetchImpl,
      });
      const result = await run(client, input);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'http://cm.test/msg');
      assert.equal(calls[0].headers.authorization, `Bearer ${APP_SENTINEL}`);
      assert.equal(calls[0].headers.authorization.includes(SENTINEL), false);
      assert.equal(calls[0].headers['x-app-id'], PROJECT_ID);
      assert.equal(calls[0].headers['x-org-id'], PRIVATE_ORG);
      assert.equal(calls[0].headers['x-user-id'], 'user-a');
      assert.equal('cookie' in calls[0].headers, false);
      assert.deepEqual(calls[0].body, expectBody);
      assert.deepEqual(input, snapshot);
      assert.equal(result.httpStatus, 200);
    }
    const ensure = { ...ensureInput(), action: 'nope', userId: 'body-user' };
    await postModule(ensure, { ...ensureInput(), action: 'ensureModuleThread', userId: 'user-a' }, (client, input) => client.ensureModuleThread('  user-a  ', input));
    const open = { ...openInput(), action: 'nope', userId: 'body-user' };
    await postModule(open, { ...openInput(), action: 'openModuleTask', userId: 'user-a' }, (client, input) => client.openModuleTask('  user-a  ', input));
  });

  it('posts each action with caller identity and leaves input intact', async () => {
    const logs: unknown[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { logs.push(args); };
    try {
      for (const action of actions) {
        const input = { ...action.input };
        const { fetchImpl, calls } = mockFetch(() => jsonResponse(200, { statusCode: 200, task: { id: 't1' }, code: 'ok' }));
        const client = createServerMessagesClient({
          env: baseEnv({ MSG_PROXY_ORG_ID: 'org-1', MSG_PROXY_USER_ID: 'proxy-default' }),
          fetchImpl,
        });
        const result = await client[action.call]('  user-a  ', input as never);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, 'http://cm.test/msg');
        assert.equal(calls[0].method, 'POST');
        assert.equal(calls[0].redirect, 'manual');
        assert.equal(calls[0].headers['Content-Type'], 'application/json');
        assert.equal(calls[0].headers.authorization, `Bearer ${SENTINEL}`);
        assert.equal(calls[0].headers['x-user-id'], 'user-a');
        assert.equal(calls[0].headers['x-org-id'], 'org-1');
        assert.equal('cookie' in calls[0].headers, false);
        assert.deepEqual(calls[0].body, { ...action.expect, action: action.name, userId: 'user-a' });
        assert.deepEqual(input, action.input);
        assert.equal(result.httpStatus, 200);
        assert.equal(result.body.statusCode, 200);
        assert.equal('task' in result.body, true);
        if ('task' in result.body) assert.deepEqual(result.body.task, { id: 't1' });
        assert.equal(process.env.MSG_PROXY_USER_ID, saved.MSG_PROXY_USER_ID);
      }
      assert.deepEqual(logs, []);
    } finally {
      console.log = original;
    }
  });

  it('omits x-org-id when org is absent', async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse(200, { statusCode: 200 }));
    const client = createServerMessagesClient({ env: baseEnv(), fetchImpl });
    await client.addMessage('user-a', { threadId: 'th', content: 'hi' });
    assert.equal(calls[0].headers['x-org-id'], undefined);
  });

  it('uses the injected target and ignores later process.env mutations', async () => {
    process.env.MSG_PROXY_TARGET = 'http://from-process.example';
    process.env.MSG_PROXY_TOKEN = 'process-token';
    const { fetchImpl, calls } = mockFetch(async () => {
      process.env.MSG_PROXY_TARGET = 'http://mutated.example';
      process.env.MSG_PROXY_TOKEN = 'mutated-token';
      process.env.MSG_PROXY_USER_ID = 'leaked';
      return jsonResponse(200, { statusCode: 200 });
    });
    const client = createServerMessagesClient({ env: baseEnv(), fetchImpl });
    await Promise.all([
      client.addMessage('user-a', { threadId: '1', content: 'a' }),
      client.addMessage('user-b', { threadId: '2', content: 'b' }),
    ]);
    assert.deepEqual(calls.map((call) => call.headers['x-user-id']).sort(), ['user-a', 'user-b']);
    assert.deepEqual(calls.map((call) => call.body.userId).sort(), ['user-a', 'user-b']);
    for (const call of calls) {
      assert.equal(call.url, 'http://cm.test/msg');
      assert.equal(call.headers.authorization, `Bearer ${SENTINEL}`);
    }
  });

  it('does not fetch when the token is missing', async () => {
    let fetches = 0;
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return jsonResponse(200, { statusCode: 200 });
    };
    const client = createServerMessagesClient({ env: { MSG_PROXY_TARGET: 'http://cm.test' }, fetchImpl });
    await assert.rejects(
      () => client.addMessage('ada@collab.codes', { threadId: 'th', content: 'hi' }),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'MSG_SERVICE_NOT_CONFIGURED');
        assert.equal(err.statusCode, 503);
        assertNoSentinel(err);
        return true;
      },
    );
    assert.equal(fetches, 0);
  });

  it('rejects an empty or broken caller id before fetch', async () => {
    let fetches = 0;
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return jsonResponse(200, { statusCode: 200 });
    };
    const client = createServerMessagesClient({ env: baseEnv(), fetchImpl });
    for (const asUserId of ['', '   ', 'user\nid']) {
      await assert.rejects(() => client.addMessage(asUserId, { threadId: 'th', content: 'x' }));
    }
    assert.equal(fetches, 0);
  });

  it('preserves discordant http and envelope statuses, including 409 task payload', async () => {
    const cases = [
      { http: 200, body: { statusCode: 403, msg: 'nope', code: 'forbidden' } },
      { http: 401, body: { statusCode: 401, msg: 'missing', code: 'user_not_found' } },
      { http: 403, body: { statusCode: 403, msg: 'denied', code: 'not_human' } },
      { http: 404, body: { statusCode: 404, msg: 'gone' } },
      { http: 409, body: { statusCode: 409, msg: 'conflict', code: 'conflict', task: { taskId: 't', workflowVersion: null } } },
      { http: 500, body: { statusCode: 500, msg: 'boom', code: 'down' } },
    ];
    for (const item of cases) {
      const { fetchImpl } = mockFetch(() => jsonResponse(item.http, item.body));
      const client = createServerMessagesClient({ env: baseEnv(), fetchImpl });
      const result = await client.getTaskUpdate('user-a', { messageId: 'm', taskId: 't' });
      assert.equal(result.httpStatus, item.http);
      assert.deepEqual(result.body, item.body);
    }
  });

  it('maps invalid json, invalid envelopes and redirects to protocol errors', async () => {
    const dir = projectFilesDir();
    writeAppFile(dir, PROJECT_ID, APP_SENTINEL);
    const responses = [
      new Response('not-json', { status: 200 }),
      jsonResponse(200, []),
      jsonResponse(200, { msg: 'x' }),
      jsonResponse(200, { statusCode: 99 }),
      jsonResponse(200, { statusCode: 200.5 }),
      new Response(JSON.stringify({ statusCode: 200 }), { status: 302, headers: { Location: 'http://other.test/msg' } }),
    ];
    for (const response of responses) {
      const { fetchImpl } = mockFetch(() => response);
      const client = createServerMessagesClient({ projectId: PROJECT_ID, env: baseEnv(), fetchImpl });
      await assert.rejects(
        () => client.openModuleTask('user-a', openInput()),
        (err: unknown) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.code, 'MSG_SERVICE_PROTOCOL_ERROR');
          assert.equal(err.statusCode, 502);
          assert.match(err.message, /openModuleTask/);
          assertNoSentinel(err);
          assert.equal(err.message.includes('not-json'), false);
          assert.equal(err.message.includes('conflict'), false);
          return true;
        },
      );
    }
  });

  it('maps network failures and timeouts without the sentinel', async () => {
    const network: typeof fetch = async () => {
      throw new TypeError('connect ECONNREFUSED secret');
    };
    const client = createServerMessagesClient({ env: baseEnv(), fetchImpl: network });
    await assert.rejects(
      () => client.applyIntents('user-a', { intents: [] }),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'MSG_SERVICE_UNAVAILABLE');
        assert.equal(err.statusCode, 502);
        assert.match(err.message, /applyIntents/);
        assert.equal(err.message.includes('ECONNREFUSED'), false);
        assertNoSentinel(err);
        return true;
      },
    );

    const hanging: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const abort = new Error('aborted');
        abort.name = 'AbortError';
        reject(abort);
      });
    });
    const bodyHang: typeof fetch = async () => {
      const response = jsonResponse(200, { statusCode: 200 });
      const text = (): Promise<string> => new Promise(() => undefined);
      return new Proxy(response, {
        get(target, prop, receiver) {
          if (prop === 'text') return text;
          const value: unknown = Reflect.get(target, prop, target);
          if (typeof value === 'function') {
            return (...args: unknown[]) => Reflect.apply(value, target, args);
          }
          return value;
        },
      });
    };
    const slowBody = createServerMessagesClient({ env: baseEnv(), fetchImpl: bodyHang, timeoutMs: 20 });
    await assert.rejects(
      () => slowBody.addMessage('user-a', { threadId: 'th', content: 'x' }),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'MSG_SERVICE_TIMEOUT');
        assert.equal(err.statusCode, 504);
        assertNoSentinel(err);
        return true;
      },
    );

    const slow = createServerMessagesClient({ env: baseEnv(), fetchImpl: hanging, timeoutMs: 20 });
    await assert.rejects(
      () => slow.addUserInThread('user-a', { userIdOrName: 'b', threadId: 'th', auth: 'read' } as never),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'MSG_SERVICE_TIMEOUT');
        assert.equal(err.statusCode, 504);
        assert.match(err.message, /addUserInThread/);
        assertNoSentinel(err);
        return true;
      },
    );
  });

  it('defaults the target and timeout when env is injected empty of those keys', async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse(200, { statusCode: 201, userId: 'cm-1' }));
    const client = createServerMessagesClient({
      env: { MSG_PROXY_TOKEN: SENTINEL },
      fetchImpl,
    });
    const result = await client.addMessage('ada@collab.codes', { threadId: 'th', content: 'hi' });
    assert.equal(calls[0].url, 'http://127.0.0.1:8180/msg');
    assert.equal(result.body.statusCode, 201);
    assert.equal(result.httpStatus, 200);
  });

  it('refuses module calls without projectId or configuration and does not fetch', async () => {
    let fetches = 0;
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return jsonResponse(200, { statusCode: 200 });
    };
    const missing = createServerMessagesClient({ env: baseEnv(), fetchImpl });
    await assert.rejects(
      () => missing.ensureModuleThread('user-a', ensureInput()),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'MSG_APP_NOT_CONFIGURED');
        assert.equal(err.statusCode, 503);
        assertNoSentinel(err);
        return true;
      },
    );
    projectFilesDir();
    const bare = createServerMessagesClient({ projectId: PROJECT_ID, env: baseEnv(), fetchImpl });
    await assert.rejects(
      () => bare.openModuleTask('user-a', openInput()),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'MSG_APP_NOT_CONFIGURED');
        assert.equal(err.statusCode, 503);
        return true;
      },
    );
    assert.equal(fetches, 0);
    const { fetchImpl: commonFetch, calls } = mockFetch(() => jsonResponse(200, { statusCode: 200 }));
    const common = createServerMessagesClient({ env: baseEnv(), fetchImpl: commonFetch });
    await common.addMessage('user-a', { threadId: 'th', content: 'hi' });
    assert.equal(calls[0].headers.authorization, `Bearer ${SENTINEL}`);
    assert.equal(calls[0].headers['x-app-id'], undefined);
  });

  it('rejects a module scope that differs from the configured application before fetch', async () => {
    const dir = projectFilesDir();
    writeAppFile(dir, PROJECT_ID, APP_SENTINEL);
    writeAppFile(dir, '102095', 'SENTINEL_TOKEN_other_app');
    let fetches = 0;
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return jsonResponse(200, { statusCode: 200 });
    };
    const client = createServerMessagesClient({ projectId: PROJECT_ID, env: baseEnv(), fetchImpl });
    await assert.rejects(
      () => client.ensureModuleThread('user-a', ensureInput('102095')),
      (err: unknown) => err instanceof AppError && err.code === 'MSG_APP_SCOPE_INVALID' && err.statusCode === 400,
    );
    await assert.rejects(
      () => client.openModuleTask('user-a', openInput('102095')),
      (err: unknown) => err instanceof AppError && err.code === 'MSG_APP_SCOPE_INVALID' && err.statusCode === 400,
    );
    assert.equal(fetches, 0);
  });

  it('reads the application credential again after the file mtime changes', async () => {
    const dir = projectFilesDir();
    const filePath = writeAppFile(dir, PROJECT_ID, APP_SENTINEL);
    const { fetchImpl, calls } = mockFetch(() => jsonResponse(200, { statusCode: 200 }));
    const client = createServerMessagesClient({
      projectId: PROJECT_ID,
      env: baseEnv(),
      fetchImpl,
    });
    await client.ensureModuleThread('user-a', ensureInput());
    assert.equal(calls[0].headers.authorization, `Bearer ${APP_SENTINEL}`);
    const nextToken = 'SENTINEL_TOKEN_rt94_app_next';
    writeAppFile(dir, PROJECT_ID, nextToken);
    const later = Date.now() / 1000 + 5;
    utimesSync(filePath, later, later);
    await client.openModuleTask('user-a', openInput());
    assert.equal(calls[1].headers.authorization, `Bearer ${nextToken}`);
    assert.equal(calls[1].headers['x-app-id'], PROJECT_ID);
  });
});
