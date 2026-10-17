import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createServerMessagesClient } from '/_102034_/l1/server/layer_1_external/collabMessages/client.js';

const SENTINEL = 'SENTINEL_TOKEN_rt79';

type Seen = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  redirect: string;
};

const envKeys = ['MSG_PROXY_TOKEN', 'MSG_PROXY_USER_ID', 'MSG_PROXY_ORG_ID', 'MSG_PROXY_TARGET'] as const;
const saved: Record<string, string | undefined> = {};

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
});

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
    name: 'ensureModuleThread' as const,
    call: 'ensureModuleThread' as const,
    input: { email: 'a@b.c', project: 'p', module: 'm', name: 'n', action: 'nope', userId: 'body-user' },
    expect: { email: 'a@b.c', project: 'p', module: 'm', name: 'n' },
  },
  {
    name: 'openModuleTask' as const,
    call: 'openModuleTask' as const,
    input: { threadId: 'th', title: 't', content: 'c', ref: { moduleId: 'm' }, step: 's', action: 'nope', userId: 'body-user' },
    expect: { threadId: 'th', title: 't', content: 'c', ref: { moduleId: 'm' }, step: 's' },
  },
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
      () => client.ensureModuleThread('ada@collab.codes', { email: 'ada@collab.codes', project: 'p', module: 'm', name: 'n' }),
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
      const client = createServerMessagesClient({ env: baseEnv(), fetchImpl });
      await assert.rejects(
        () => client.openModuleTask('user-a', { threadId: 'th', title: 't', content: 'c', ref: { moduleId: 'm' }, step: 's' } as never),
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
    const result = await client.ensureModuleThread('ada@collab.codes', {
      email: 'ada@collab.codes',
      project: 'p',
      module: 'm',
      name: 'n',
    });
    assert.equal(calls[0].url, 'http://127.0.0.1:8180/msg');
    assert.equal(result.body.userId, 'cm-1');
    assert.equal(result.body.statusCode, 201);
    assert.equal(result.httpStatus, 200);
  });
});
