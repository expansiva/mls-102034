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

test('draftSlugForProxy reads the header first, then the cookie, and stays null inside the dev process', () => {
  const previous = process.env.COLLAB_DRAFT;
  delete process.env.COLLAB_DRAFT;
  try {
    const cookie = `cauth=abc; collab-draft=${SLUG}`;
    assert.equal(draftSlugForProxy(undefined), null);
    assert.equal(draftSlugForProxy({}), null);
    assert.equal(draftSlugForProxy({ cookie: '' }), null);
    assert.equal(draftSlugForProxy({ cookie: 'cauth=abc' }), null);
    assert.equal(draftSlugForProxy({ cookie: 'collab-draft=not-a-slug' }), null);
    assert.equal(draftSlugForProxy({ cookie }), SLUG);
    assert.equal(draftSlugForProxy({ 'x-collab-draft': 'user-0123456789abcdef', cookie }), 'user-0123456789abcdef');
    assert.equal(draftSlugForProxy({ 'x-collab-draft': 'not-a-slug', cookie }), null);
    assert.equal(draftSlugForProxy({ 'x-collab-draft': SLUG }), SLUG);
    // The service worker passes only the cookie, so a header on the same request cannot choose it.
    assert.equal(draftSlugForProxy({ cookie }), SLUG);

    process.env.COLLAB_DRAFT = SLUG;
    assert.equal(draftSlugForProxy({ 'x-collab-draft': SLUG, cookie }), null);
  } finally {
    if (previous === undefined) delete process.env.COLLAB_DRAFT;
    else process.env.COLLAB_DRAFT = previous;
  }
});

test('/execBff uses x-collab-draft ahead of the cookie and ignores the cookie when the header is invalid', async () => {
  delete process.env.COLLAB_DRAFT;
  const cookie = `collab-draft=${SLUG}`;
  const session = async () => ({ reject: false });
  const deps = {
    base: BASE,
    clientProjectId: '102047',
    resolveSession: session,
    refreshedAuthCookie: (token: string) => token,
    resolveRequestDraftImpl: async () => readyDraft(),
    ensureDevProcessImpl: () => devInfo(),
    touchDevProcessImpl: () => {},
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, data: null, error: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  };

  const headerWins = fakeReply();
  const won = await applyDraftExecBff({
    ...deps,
    request: fakeRequest({ routine: 'x.y.z' }, { cookie, 'x-collab-draft': 'user-0123456789abcdef' }),
    reply: headerWins,
  });
  assert.equal(won.handled, true);
  assert.equal(headerWins.statusCode, 200);

  const invalidHeader = fakeReply();
  let resolved = 0;
  const lost = await applyDraftExecBff({
    ...deps,
    request: fakeRequest({ routine: 'x.y.z' }, { cookie, 'x-collab-draft': 'not-a-slug' }),
    reply: invalidHeader,
    resolveRequestDraftImpl: async () => {
      resolved += 1;
      return readyDraft();
    },
  });
  assert.deepEqual(lost, { handled: false });
  assert.equal(resolved, 0);
  assert.equal(invalidHeader.statusCode, 0);

  const neither = await applyDraftExecBff({
    ...deps,
    request: fakeRequest({ routine: 'x.y.z' }, {}),
    reply: fakeReply(),
  });
  assert.deepEqual(neither, { handled: false });
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
    resolveRequestDraftImpl: async (headers, base, projectId) => {
      order.push('resolve');
      assert.equal(headers?.cookie, `collab-draft=${SLUG}`);
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
  const plan = await planDraftExecBff({ cookie: `collab-draft=${SLUG}` }, async () => ({
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

const TOKEN = 'renewed-access-token';
const COOKIE = `cauth=${TOKEN}; collab-draft=${SLUG}`;

async function withLogs(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const info = console.info;
  const error = console.error;
  console.info = (...args: unknown[]) => {
    lines.push(args.map((part) => String(part)).join(' '));
  };
  console.error = (...args: unknown[]) => {
    lines.push(args.map((part) => String(part)).join(' '));
  };
  try {
    await run();
  } finally {
    console.info = info;
    console.error = error;
  }
  return lines;
}

function assertLogHasNoSecrets(lines: string[]): void {
  const text = lines.join('\n');
  assert.equal(text.includes(TOKEN), false);
  assert.equal(text.includes(IDENTITY_SECRET), false);
  assert.equal(text.includes('cauth'), false);
  assert.equal(text.includes(VERIFIED_CLAIMS.email), false);
  assert.equal(text.includes(VERIFIED_CLAIMS.sub), false);
}

test('draft forward logs identity yes and reason ok when the session has claims', async () => {
  delete process.env.COLLAB_DRAFT;
  const lines = await withLogs(async () => {
    const result = await applyDraftExecBff({
      request: fakeRequest({ routine: 'cafe.page.load' }, { cookie: COOKIE }),
      reply: fakeReply(),
      base: BASE,
      clientProjectId: '102047',
      resolveSession: async () => ({
        reject: false,
        claims: VERIFIED_CLAIMS,
        reason: 'ok',
        newAccessToken: TOKEN,
        source: 'local-test',
      }),
      refreshedAuthCookie: (token) => `cauth=${token}; Path=/; HttpOnly`,
      resolveRequestDraftImpl: async () => readyDraft(),
      ensureDevProcessImpl: () => ({ ...devInfo(), identitySecret: IDENTITY_SECRET }),
      touchDevProcessImpl: () => {},
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, data: null, error: null }), { status: 200 }),
    });
    assert.equal(result.handled, true);
  });
  const line = lines.find((entry) => entry.includes('[draftProxy]') && entry.includes('identity: yes'));
  assert.ok(line);
  assert.match(line, /reason: ok/);
  assert.match(line, /source: local-test/);
  assert.match(line, /renewed: yes/);
  assert.match(line, /routine=cafe\.page\.load/);
  assert.match(line, /status=200/);
  assertLogHasNoSecrets(lines);
});

test('draft forward logs identity no and missing-token when there is no cauth', async () => {
  delete process.env.COLLAB_DRAFT;
  const lines = await withLogs(async () => {
    await applyDraftExecBff({
      request: fakeRequest({ routine: 'cafe.page.load' }, { cookie: `collab-draft=${SLUG}` }),
      reply: fakeReply(),
      base: BASE,
      clientProjectId: '102047',
      resolveSession: async () => ({ reject: false, reason: 'missing-token' }),
      refreshedAuthCookie: (token) => token,
      resolveRequestDraftImpl: async () => readyDraft(),
      ensureDevProcessImpl: () => ({ ...devInfo(), identitySecret: IDENTITY_SECRET }),
      touchDevProcessImpl: () => {},
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, data: null, error: null }), { status: 200 }),
    });
  });
  const line = lines.find((entry) => entry.includes('[draftProxy]') && entry.includes('identity: no'));
  assert.ok(line);
  assert.match(line, /reason: missing-token/);
  assert.match(line, /source: none/);
  assert.match(line, /renewed: no/);
  assertLogHasNoSecrets(lines);
});

test('draft forward logs status and error code when the child answers 401', async () => {
  delete process.env.COLLAB_DRAFT;
  const reply = fakeReply();
  const lines = await withLogs(async () => {
    await applyDraftExecBff({
      request: fakeRequest({ routine: 'cafe.page.load' }, { cookie: COOKIE }),
      reply,
      base: BASE,
      clientProjectId: '102047',
      resolveSession: async () => ({ reject: false, reason: 'missing-token' }),
      refreshedAuthCookie: (token) => `cauth=${token}`,
      resolveRequestDraftImpl: async () => readyDraft(),
      ensureDevProcessImpl: () => devInfo(),
      touchDevProcessImpl: () => {},
      fetchImpl: async () => new Response(
        JSON.stringify({ ok: false, data: null, error: { code: 'UNAUTHENTICATED', message: 'no' } }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
    });
  });
  const line = lines.find((entry) => entry.includes('status=401'));
  assert.ok(line);
  assert.match(line, /error=UNAUTHENTICATED/);
  assert.equal(reply.statusCode, 401);
  assert.equal(
    Buffer.isBuffer(reply.sent) ? reply.sent.toString() : '',
    '{"ok":false,"data":null,"error":{"code":"UNAUTHENTICATED","message":"no"}}',
  );
  assertLogHasNoSecrets(lines);
});

test('a session the parent rejects leaves a line saying the PRINCIPAL answered 401 and never calls the child', async () => {
  delete process.env.COLLAB_DRAFT;
  let childCalls = 0;
  const lines = await withLogs(async () => {
    const result = await applyDraftExecBff({
      request: fakeRequest({ routine: 'cafe.page.load' }, { cookie: COOKIE }),
      reply: fakeReply(),
      base: BASE,
      clientProjectId: '102047',
      resolveSession: async () => ({ reject: true, reason: 'invalid-token' }),
      refreshedAuthCookie: (token) => token,
      resolveRequestDraftImpl: async () => readyDraft(),
      ensureDevProcessImpl: () => ({ ...devInfo(), identitySecret: IDENTITY_SECRET }),
      touchDevProcessImpl: () => {},
      fetchImpl: async () => { childCalls += 1; return new Response('{}', { status: 200 }); },
    });
    assert.deepEqual(result, { handled: false, statusCode: 401 });
  });
  assert.equal(childCalls, 0);
  const line = lines.find((entry) => entry.includes('[draftProxy]') && entry.includes('by=principal'));
  assert.ok(line, lines.join('\n'));
  assert.match(line, /status=401/);
  assert.match(line, /reason: invalid-token/);
  assert.match(line, /identity: no/);
  assertLogHasNoSecrets(lines);
});

test('a routine name and a child error code with line breaks cannot forge log lines', async () => {
  delete process.env.COLLAB_DRAFT;
  const forgedRoutine = 'x\n[draftProxy] 2026-01-01T00:00:00.000Z slug=team-1 identity: yes by=child status=200';
  const forgedCode = 'UNAUTHENTICATED\n[draftProxy] forged identity: yes';
  const lines = await withLogs(async () => {
    await applyDraftExecBff({
      request: fakeRequest({ routine: forgedRoutine }, { cookie: `collab-draft=${SLUG}` }),
      reply: fakeReply(),
      base: BASE,
      clientProjectId: '102047',
      resolveSession: async () => ({ reject: false, reason: 'missing-token' }),
      refreshedAuthCookie: (token) => token,
      resolveRequestDraftImpl: async () => readyDraft(),
      ensureDevProcessImpl: () => ({ ...devInfo(), identitySecret: IDENTITY_SECRET }),
      touchDevProcessImpl: () => {},
      fetchImpl: async () => new Response(JSON.stringify({ ok: false, data: null, error: { code: forgedCode } }), { status: 401 }),
    });
  });
  const draftLines = lines.filter((entry) => entry.includes('[draftProxy]'));
  assert.equal(draftLines.length, 1, 'exactly one log line per forward, none forged: ' + lines.join(' | '));
  assert.equal(draftLines[0].includes('\n'), false);
  assert.match(draftLines[0], /identity: no/);
  assert.match(draftLines[0], /status=401/);
  assert.match(draftLines[0], /error=UNAUTHENTICATED\?/);
});
