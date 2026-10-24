/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/draftProxy.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CollabAuthClaims } from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';
import {
  applyDraftExecBff,
  draftDownBody,
  draftSlugForProxy,
  planDraftExecBff,
  type DraftSessionView,
} from '/_102034_/l1/server/layer_1_external/transport/http/draftProxy.js';

const SLUG = 'team-102047';
const BASE = '/tmp/draft-proxy-test';
const PORT = 4401;

interface ReplySink {
  statusCode: number;
  sent: unknown;
  headers: Record<string, string | string[]>;
}

function fakeReply(): FastifyReply & ReplySink {
  const sink: ReplySink = { statusCode: 0, sent: undefined, headers: {} };
  const reply = {
    ...sink,
    code(status: number) {
      sink.statusCode = status;
      reply.statusCode = status;
      return reply;
    },
    header(name: string, value: string | string[]) {
      sink.headers[name] = value;
      reply.headers[name] = value;
      return reply;
    },
    getHeader(name: string) {
      return sink.headers[name];
    },
    send(payload: unknown) {
      sink.sent = payload;
      reply.sent = payload;
      return reply;
    },
  };
  return reply as unknown as FastifyReply & ReplySink;
}

function fakeRequest(body: unknown, headers: Record<string, string>): FastifyRequest {
  return { body, headers } as unknown as FastifyRequest;
}

function devInfo() {
  return { port: PORT, pid: 7, startedAt: 1, lastRequestAt: 1 };
}

function readyDraft() {
  return {
    slug: SLUG,
    branch: 'team/102047',
    sourceRoot: `${BASE}/drafts/${SLUG}/mls-102047`,
  };
}

test('draftSlugForProxy reads collab-draft and stays null inside the dev process or without a valid cookie', () => {
  const previous = process.env.COLLAB_DRAFT;
  delete process.env.COLLAB_DRAFT;
  try {
    assert.equal(draftSlugForProxy(undefined), null);
    assert.equal(draftSlugForProxy(''), null);
    assert.equal(draftSlugForProxy('cauth=abc'), null);
    assert.equal(draftSlugForProxy('collab-draft=not-a-slug'), null);
    assert.equal(draftSlugForProxy(`cauth=abc; collab-draft=${SLUG}`), SLUG);

    process.env.COLLAB_DRAFT = SLUG;
    assert.equal(draftSlugForProxy(`collab-draft=${SLUG}`), null);
  } finally {
    if (previous === undefined) delete process.env.COLLAB_DRAFT;
    else process.env.COLLAB_DRAFT = previous;
  }
});

test('a valid draft cookie with an accepted session proxies /execBff to the dev process', async () => {
  delete process.env.COLLAB_DRAFT;
  const body = { routine: 'cafe.page.load', params: { id: 1 } };
  const request = fakeRequest(body, {
    cookie: `collab-draft=${SLUG}`,
    'content-type': 'application/json',
    host: '102047.collabcodes.com',
    connection: 'keep-alive',
  });
  const reply = fakeReply();
  let touched = 0;
  const fetched: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];

  const result = await applyDraftExecBff({
    request,
    reply,
    base: BASE,
    clientProjectId: '102047',
    resolveSession: async (): Promise<DraftSessionView> => ({ reject: false, newAccessToken: 'renewed' }),
    refreshedAuthCookie: (token) => `cauth=${token}; Path=/; HttpOnly`,
    resolveRequestDraftImpl: async () => readyDraft(),
    ensureDevProcessImpl: (opts) => {
      assert.deepEqual(opts, { base: BASE, slug: SLUG, clientProjectId: 102047 });
      return devInfo();
    },
    touchDevProcessImpl: (base, slug, now) => {
      assert.equal(base, BASE);
      assert.equal(slug, SLUG);
      assert.equal(typeof now, 'number');
      touched += 1;
    },
    waitForDevReadyImpl: async () => {
      throw new Error('probe on the happy path');
    },
    fetchImpl: async (url, init) => {
      fetched.push({
        url: String(url),
        method: String(init?.method),
        headers: init?.headers as Record<string, string>,
        body: String(init?.body),
      });
      return new Response(JSON.stringify({ ok: true, data: { n: 1 }, error: null }), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'set-cookie': 'loginMsg=dev',
        },
      });
    },
  });

  assert.equal(result.handled, true);
  assert.equal(touched, 1);
  assert.equal(fetched.length, 1);
  const call = fetched[0];
  assert.equal(call.url, `http://127.0.0.1:${PORT}/execBff`);
  assert.equal(call.method, 'POST');
  assert.equal(call.body, JSON.stringify(body));
  assert.equal(call.headers['content-type'], 'application/json');
  assert.equal(call.headers.host, undefined);
  assert.equal(call.headers.connection, undefined);
  assert.equal(reply.statusCode, 200);
  assert.equal(Buffer.isBuffer(reply.sent) ? reply.sent.toString() : '', '{"ok":true,"data":{"n":1},"error":null}');
  assert.equal(reply.headers['content-type'], 'application/json; charset=utf-8');
  assert.deepEqual(reply.headers['set-cookie'], ['cauth=renewed; Path=/; HttpOnly', 'loginMsg=dev']);
});

test('a connection error probes the dev port and retries /execBff once', async () => {
  delete process.env.COLLAB_DRAFT;
  const body = { routine: 'x.y.z' };
  const reply = fakeReply();
  const bodies: string[] = [];
  let fetches = 0;
  let probes = 0;
  const result = await applyDraftExecBff({
    request: fakeRequest(body, { cookie: `collab-draft=${SLUG}`, 'content-type': 'application/json' }),
    reply,
    base: BASE,
    clientProjectId: '102047',
    resolveSession: async () => ({ reject: false }),
    refreshedAuthCookie: (token) => token,
    resolveRequestDraftImpl: async () => readyDraft(),
    ensureDevProcessImpl: () => devInfo(),
    touchDevProcessImpl: () => {},
    waitForDevReadyImpl: async (port) => {
      probes += 1;
      assert.equal(port, PORT);
      return true;
    },
    fetchImpl: async (_url, init) => {
      fetches += 1;
      bodies.push(String(init?.body));
      if (fetches === 1) throw new Error('connect ECONNREFUSED');
      return new Response(JSON.stringify({ ok: true, data: { n: 2 }, error: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  assert.equal(result.handled, true);
  assert.equal(probes, 1);
  assert.equal(fetches, 2);
  assert.deepEqual(bodies, [JSON.stringify(body), JSON.stringify(body)]);
  assert.equal(reply.statusCode, 200);
  assert.equal(Buffer.isBuffer(reply.sent) ? reply.sent.toString() : '', '{"ok":true,"data":{"n":2},"error":null}');
});

test('a TimeoutError answers 503 DRAFT_DOWN without probing', async () => {
  delete process.env.COLLAB_DRAFT;
  const reply = fakeReply();
  let probes = 0;
  const timeout = new Error('The operation was aborted due to timeout');
  timeout.name = 'TimeoutError';
  const result = await applyDraftExecBff({
    request: fakeRequest({ routine: 'x.y.z' }, { cookie: `collab-draft=${SLUG}` }),
    reply,
    base: BASE,
    clientProjectId: '102047',
    resolveSession: async () => ({ reject: false }),
    refreshedAuthCookie: (token) => token,
    resolveRequestDraftImpl: async () => readyDraft(),
    ensureDevProcessImpl: () => devInfo(),
    touchDevProcessImpl: () => {},
    waitForDevReadyImpl: async () => {
      probes += 1;
      return true;
    },
    fetchImpl: async () => {
      throw timeout;
    },
  });

  assert.equal(result.handled, true);
  assert.equal(probes, 0);
  assert.equal(reply.statusCode, 503);
  assert.deepEqual(reply.sent, draftDownBody());
});

test('a connection error with a down port answers 503 DRAFT_DOWN', async () => {
  delete process.env.COLLAB_DRAFT;
  const reply = fakeReply();
  let probes = 0;
  let fetches = 0;
  const result = await applyDraftExecBff({
    request: fakeRequest({ routine: 'x.y.z' }, { cookie: `collab-draft=${SLUG}`, 'content-type': 'application/json' }),
    reply,
    base: BASE,
    clientProjectId: '102047',
    resolveSession: async () => ({ reject: false }),
    refreshedAuthCookie: (token) => token,
    resolveRequestDraftImpl: async () => readyDraft(),
    ensureDevProcessImpl: () => devInfo(),
    touchDevProcessImpl: () => {},
    waitForDevReadyImpl: async () => {
      probes += 1;
      return false;
    },
    fetchImpl: async () => {
      fetches += 1;
      throw new Error('connect ECONNREFUSED');
    },
  });

  assert.equal(result.handled, true);
  assert.equal(probes, 1);
  assert.equal(fetches, 1);
  assert.equal(reply.statusCode, 503);
  assert.deepEqual(reply.sent, draftDownBody());
});

test('a rejected session is 401 and does not call the dev process', async () => {
  delete process.env.COLLAB_DRAFT;
  let devCalls = 0;
  const reply = fakeReply();
  const result = await applyDraftExecBff({
    request: fakeRequest({ routine: 'x.y.z' }, { cookie: `collab-draft=${SLUG}` }),
    reply,
    base: BASE,
    clientProjectId: '102047',
    resolveSession: async () => ({ reject: true }),
    refreshedAuthCookie: (token) => token,
    resolveRequestDraftImpl: async () => readyDraft(),
    ensureDevProcessImpl: () => {
      devCalls += 1;
      return devInfo();
    },
    touchDevProcessImpl: () => {
      devCalls += 1;
    },
    fetchImpl: async () => {
      devCalls += 1;
      return new Response('no');
    },
  });

  assert.deepEqual(result, { handled: false, statusCode: 401 });
  assert.equal(devCalls, 0);
  assert.equal(reply.statusCode, 0);
});

test('a valid draft cookie prepares the worktree before starting the dev process', async () => {
  delete process.env.COLLAB_DRAFT;
  const order: string[] = [];
  const reply = fakeReply();
  const result = await applyDraftExecBff({
    request: fakeRequest({ routine: 'x.y.z' }, { cookie: `collab-draft=${SLUG}` }),
    reply,
    base: BASE,
    clientProjectId: '102047',
    resolveSession: async () => ({ reject: false }),
    refreshedAuthCookie: (token) => token,
    resolveRequestDraftImpl: async (cookieHeader, base, projectId) => {
      order.push('resolve');
      assert.equal(cookieHeader, `collab-draft=${SLUG}`);
      assert.equal(base, BASE);
      assert.equal(projectId, 102047);
      return readyDraft();
    },
    ensureDevProcessImpl: () => {
      order.push('ensure');
      return devInfo();
    },
    touchDevProcessImpl: () => {},
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, data: null, error: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });

  assert.equal(result.handled, true);
  assert.deepEqual(order, ['resolve', 'ensure']);
  assert.equal(reply.statusCode, 200);
});

test('a worktree failure answers 503 DRAFT_DOWN and does not start the dev process', async () => {
  delete process.env.COLLAB_DRAFT;
  const reply = fakeReply();
  let ensured = 0;
  const result = await applyDraftExecBff({
    request: fakeRequest({ routine: 'x.y.z' }, { cookie: `collab-draft=${SLUG}` }),
    reply,
    base: BASE,
    clientProjectId: '102047',
    resolveSession: async () => ({ reject: false }),
    refreshedAuthCookie: (token) => token,
    resolveRequestDraftImpl: async () => {
      throw new Error('worktree missing');
    },
    ensureDevProcessImpl: () => {
      ensured += 1;
      return devInfo();
    },
    touchDevProcessImpl: () => {
      ensured += 1;
    },
    fetchImpl: async () => {
      ensured += 1;
      return new Response('no');
    },
  });

  assert.equal(result.handled, true);
  assert.equal(ensured, 0);
  assert.equal(reply.statusCode, 503);
  assert.deepEqual(reply.sent, draftDownBody());
});

const IDENTITY_SECRET = 'a'.repeat(64);
const VERIFIED_CLAIMS: CollabAuthClaims = {
  sub: 'persona-1',
  email: 'responsavel@example.com',
  authorities: ['comandaRestaurante:garcom'],
};

function identityHeaders(headers: Record<string, string> | undefined): { secret?: string; claims?: unknown } {
  const encoded = headers?.['x-collab-draft-identity'];
  return {
    secret: headers?.['x-collab-draft-identity-secret'],
    claims: encoded ? JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) : undefined,
  };
}

test('planDraftExecBff returns verified claims and source on the proxy action', async () => {
  delete process.env.COLLAB_DRAFT;
  const plan = await planDraftExecBff(`collab-draft=${SLUG}`, async () => ({
    reject: false,
    claims: VERIFIED_CLAIMS,
    source: 'local-test',
  }));
  assert.deepEqual(plan, {
    action: 'proxy',
    slug: SLUG,
    claims: VERIFIED_CLAIMS,
    source: 'local-test',
  });
});

test('draft proxy drops a browser identity header and forwards the verified one', async () => {
  delete process.env.COLLAB_DRAFT;
  const forged = Buffer.from(JSON.stringify({ sub: 'forged', email: 'x@y.z' })).toString('base64url');

  async function capture(session: DraftSessionView, forgedHeaders: boolean): Promise<Record<string, string>> {
    let headers: Record<string, string> = {};
    await applyDraftExecBff({
      request: fakeRequest({ routine: 'x.y.z' }, {
        cookie: `collab-draft=${SLUG}`,
        ...(forgedHeaders ? {
          'x-collab-draft-identity': forged,
          'x-collab-draft-identity-secret': 'browser-secret',
          'x-collab-draft-identity-extra': 'also-forged',
        } : {}),
      }),
      reply: fakeReply(),
      base: BASE,
      clientProjectId: '102047',
      resolveSession: async () => session,
      refreshedAuthCookie: (token) => token,
      resolveRequestDraftImpl: async () => readyDraft(),
      ensureDevProcessImpl: () => ({ ...devInfo(), identitySecret: IDENTITY_SECRET }),
      touchDevProcessImpl: () => {},
      fetchImpl: async (_url, init) => {
        headers = init?.headers as Record<string, string>;
        return new Response(JSON.stringify({ ok: true, data: null, error: null }), { status: 200 });
      },
    });
    return headers;
  }

  const forgedOnly = await capture({ reject: false }, true);
  assert.equal(forgedOnly['x-collab-draft-identity'], undefined);
  assert.equal(forgedOnly['x-collab-draft-identity-secret'], undefined);
  assert.equal(forgedOnly['x-collab-draft-identity-extra'], undefined);

  const verified = await capture({ reject: false, claims: VERIFIED_CLAIMS, source: 'local-test' }, true);
  assert.equal(verified['x-collab-draft-identity-secret'], IDENTITY_SECRET);
  assert.deepEqual(identityHeaders(verified).claims, VERIFIED_CLAIMS);
  assert.equal(verified['x-collab-draft-identity-extra'], undefined);

  const anonymous = await capture({ reject: false }, false);
  assert.equal(anonymous['x-collab-draft-identity'], undefined);
  assert.equal(anonymous['x-collab-draft-identity-secret'], undefined);
});
