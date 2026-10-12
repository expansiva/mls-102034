/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/draftProxy.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  applyDraftExecBff,
  draftDownBody,
  draftSlugForProxy,
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

test('a fetch failure answers 503 DRAFT_DOWN', async () => {
  delete process.env.COLLAB_DRAFT;
  const reply = fakeReply();
  const result = await applyDraftExecBff({
    request: fakeRequest({ routine: 'x.y.z' }, { cookie: `collab-draft=${SLUG}`, 'content-type': 'application/json' }),
    reply,
    base: BASE,
    clientProjectId: '102047',
    resolveSession: async () => ({ reject: false }),
    refreshedAuthCookie: (token) => token,
    ensureDevProcessImpl: () => devInfo(),
    touchDevProcessImpl: () => {},
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED');
    },
  });

  assert.equal(result.handled, true);
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
