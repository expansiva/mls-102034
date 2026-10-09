/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeLogout.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { logoutCookies, registerCbeRoutes, revokeCrefresh } from '/_102034_/l1/server/layer_1_external/cbe/cbeRoutes.js';

function cookieNames(setCookie: string | string[] | undefined): string[] {
  const list = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie];
  return list.map((line) => line.split('=')[0]);
}

test('logoutCookies expires cauth, crefresh, loginMsg and sets loginUser=anonymous', () => {
  const cookies = logoutCookies();
  assert.equal(cookies.length, 4);
  assert.ok(cookies.some((c) => c.startsWith('cauth=') && c.includes('Expires=')));
  assert.ok(cookies.some((c) => c.startsWith('crefresh=') && c.includes('Expires=')));
  assert.ok(cookies.some((c) => c.startsWith('loginMsg=') && c.includes('Expires=')));
  assert.ok(cookies.some((c) => c.startsWith('loginUser=anonymous')));
});

test('revokeCrefresh does not call collab-auth without a token', async () => {
  let calls = 0;
  await revokeCrefresh(undefined, async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  });
  await revokeCrefresh('', async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  });
  assert.equal(calls, 0);
});

test('GET /exec/logout is 303 to / with the four cookies', async () => {
  const app = Fastify();
  registerCbeRoutes(app);
  const res = await app.inject({ method: 'GET', url: '/exec/logout' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/');
  assert.equal(res.headers['cache-control'], 'no-store');
  const names = cookieNames(res.headers['set-cookie']);
  assert.deepEqual(new Set(names), new Set(['cauth', 'crefresh', 'loginUser', 'loginMsg']));
  await app.close();
});

test('GET /exec/logout is 303 when revocation fails', async () => {
  const app = Fastify();
  registerCbeRoutes(app);
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('auth down');
  }) as typeof fetch;
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/exec/logout',
      headers: { cookie: 'crefresh=refresh-token' },
    });
    assert.equal(res.statusCode, 303);
    assert.equal(res.headers.location, '/');
  } finally {
    globalThis.fetch = previous;
    await app.close();
  }
});

test('GET /exec/logout does not call collab-auth without crefresh', async () => {
  const app = Fastify();
  registerCbeRoutes(app);
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    const res = await app.inject({ method: 'GET', url: '/exec/logout' });
    assert.equal(res.statusCode, 303);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previous;
    await app.close();
  }
});
