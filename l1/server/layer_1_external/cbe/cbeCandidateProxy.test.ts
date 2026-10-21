/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeCandidateProxy.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { CANDIDATE_BODY_LIMIT, candidateActionAllowed, candidateForwardHeaders, candidateHubMode, candidateHubOrgId, candidateIdentity, candidateLocalCaller, candidateOrigin, proxyCandidateRequest } from '/_102034_/l1/server/layer_1_external/cbe/cbeCandidateProxy.js';
import { registerCbeRoutes } from '/_102034_/l1/server/layer_1_external/cbe/cbeRoutes.js';

test('candidate proxy allowlists exactly read, publish and mark-result', () => {
  assert.equal(candidateActionAllowed({ action: 'candidateRead' }), true);
  assert.equal(candidateActionAllowed({ action: 'candidatePublish' }), true);
  assert.equal(candidateActionAllowed({ action: 'candidateMarkResult' }), true);
  assert.equal(candidateActionAllowed({ action: 'login' }), false);
  assert.equal(candidateActionAllowed(null), false);
});

const TEST_ORIGIN = { CANDIDATE_ORIGIN: 'https://candidate.invalid' };

test('candidate proxy forwards only the verified cauth token and preserves conflict', async () => {
  const result = await proxyCandidateRequest(
    { action: 'candidatePublish', project: 102047 }, 'verified token',
    async (input, init) => {
      assert.equal(String(input), 'https://candidate.invalid/exec/candidate');
      assert.equal(init?.redirect, 'manual');
      assert.deepEqual(init?.headers, {
        'Content-Type': 'application/json', Cookie: 'cauth=verified%20token',
      });
      assert.equal((init?.headers as Record<string, string>).Authorization, undefined);
      return new Response(JSON.stringify({ statusCode: 409, status: 'conflict' }), {
        status: 409, headers: { 'Content-Type': 'application/json' },
      });
    },
    TEST_ORIGIN,
  );
  assert.equal(result.statusCode, 409);
  assert.deepEqual(result.body, { statusCode: 409, status: 'conflict' });
});

test('candidate origin requires an explicit URL and rejects non-loopback HTTP', async () => {
  const previous = process.env.CANDIDATE_ORIGIN;
  delete process.env.CANDIDATE_ORIGIN;
  try {
    assert.throws(() => candidateOrigin(), /CANDIDATE_ORIGIN is not configured/);
    assert.equal(candidateOrigin({ CANDIDATE_ORIGIN: 'https://candidate.invalid/' }), 'https://candidate.invalid');
    let fetches = 0;
    const neverFetch = async () => {
      fetches += 1;
      return new Response('{}', { status: 200 });
    };
    for (const origin of [undefined, '', '   ', 'not a url', 'http://example.com'] as const) {
      await assert.rejects(
        () => proxyCandidateRequest({ action: 'candidateRead' }, 'jwt', neverFetch, { CANDIDATE_ORIGIN: origin }),
      );
    }
    assert.equal(fetches, 0);
    await proxyCandidateRequest({ action: 'candidateRead' }, 'jwt', async (input) => {
      assert.equal(String(input), 'http://127.0.0.1:2047/exec/candidate');
      return new Response('{}', { status: 200 });
    }, { CANDIDATE_ORIGIN: 'http://127.0.0.1:2047' });
    await proxyCandidateRequest({ action: 'candidateRead' }, 'jwt', async (input) => {
      assert.equal(String(input), 'http://localhost:2047/exec/candidate');
      return new Response('{}', { status: 200 });
    }, { CANDIDATE_ORIGIN: 'http://localhost:2047/' });
  } finally {
    if (previous === undefined) delete process.env.CANDIDATE_ORIGIN;
    else process.env.CANDIDATE_ORIGIN = previous;
  }
});

test('candidate hub mode is local only when CANDIDATE_HUB=local', () => {
  assert.equal(candidateHubMode({}), 'forward');
  assert.equal(candidateHubMode({ CANDIDATE_HUB: '' }), 'forward');
  assert.equal(candidateHubMode({ CANDIDATE_HUB: 'remote' }), 'forward');
  assert.equal(candidateHubMode({ CANDIDATE_HUB: 'local' }), 'local');
});

test('candidate proxy refuses anonymous, redirects and non-json transport', async () => {
  assert.equal((await proxyCandidateRequest({ action: 'candidateRead' }, '')).statusCode, 401);
  await assert.rejects(() => proxyCandidateRequest({ action: 'candidateRead' }, 'jwt',
    async () => new Response('', { status: 302, headers: { Location: 'https://evil.example/' } }), TEST_ORIGIN));
  await assert.rejects(() => proxyCandidateRequest({ action: 'candidateRead' }, 'jwt',
    async () => new Response('<html/>', { status: 200 }), TEST_ORIGIN));
});

test('runtime candidate route rejects test-user auth and rejects non-candidate actions locally', async () => {
  const previousUser = process.env.CBE_TEST_LOGIN_USER;
  const previousOrigin = process.env.CANDIDATE_ORIGIN;
  const previousHub = process.env.CANDIDATE_HUB;
  const previousProxyToken = process.env.MSG_PROXY_TOKEN;
  const previousProxyUser = process.env.MSG_PROXY_USER_ID;
  process.env.CBE_TEST_LOGIN_USER = 'local-test-user';
  delete process.env.CANDIDATE_HUB;
  delete process.env.MSG_PROXY_TOKEN;
  delete process.env.MSG_PROXY_USER_ID;
  // If the allowlist regresses this unreachable origin would make the assertion fail as 503.
  process.env.CANDIDATE_ORIGIN = 'https://127.0.0.1.invalid';
  const app = Fastify();
  registerCbeRoutes(app);
  try {
    const anonymous = await app.inject({ method: 'POST', url: '/exec/candidate', payload: { action: 'candidateRead' } });
    assert.equal(anonymous.statusCode, 401);
    assert.equal(anonymous.json().msg, 'candidate.unauthorized');
    const forbidden = await app.inject({ method: 'POST', url: '/exec/candidate', payload: { action: 'login' } });
    assert.equal(forbidden.statusCode, 400);
    assert.equal(forbidden.json().msg, 'candidate.invalid_action');
  } finally {
    await app.close();
    if (previousUser === undefined) delete process.env.CBE_TEST_LOGIN_USER;
    else process.env.CBE_TEST_LOGIN_USER = previousUser;
    if (previousOrigin === undefined) delete process.env.CANDIDATE_ORIGIN;
    else process.env.CANDIDATE_ORIGIN = previousOrigin;
    if (previousHub === undefined) delete process.env.CANDIDATE_HUB;
    else process.env.CANDIDATE_HUB = previousHub;
    if (previousProxyToken === undefined) delete process.env.MSG_PROXY_TOKEN;
    else process.env.MSG_PROXY_TOKEN = previousProxyToken;
    if (previousProxyUser === undefined) delete process.env.MSG_PROXY_USER_ID;
    else process.env.MSG_PROXY_USER_ID = previousProxyUser;
  }
});

test('hub identity is service only for the exact non-empty token plus a user id', () => {
  assert.deepEqual(candidateIdentity({
    authorization: 'Bearer secret', userId: 'desenv', orgId: 'collabcodes', serviceToken: 'secret',
  }), { kind: 'service', owner: 'desenv', orgId: 'collabcodes' });
  assert.deepEqual(candidateIdentity({
    email: 'alice@example.com', authorization: 'Bearer secret', userId: 'desenv', serviceToken: 'secret',
  }), { kind: 'jwt' });
  assert.deepEqual(candidateIdentity({
    authorization: 'Bearer wrong', userId: 'desenv', serviceToken: 'secret',
  }), { kind: 'none' });
  assert.deepEqual(candidateIdentity({
    authorization: 'Bearer secret', userId: 'desenv', serviceToken: '',
  }), { kind: 'none' });
  assert.deepEqual(candidateIdentity({
    authorization: 'Bearer secret', userId: 'desenv',
  }), { kind: 'none' });
  assert.deepEqual(candidateIdentity({
    authorization: 'Bearer secret', userId: '   ', serviceToken: 'secret',
  }), { kind: 'none' });
  assert.deepEqual(candidateIdentity({
    authorization: 'Bearer secret', serviceToken: 'secret',
  }), { kind: 'none' });
});

test('forward sends the cauth cookie for a jwt and MSG_PROXY headers otherwise', async () => {
  const serviceEnv = { ...TEST_ORIGIN, MSG_PROXY_TOKEN: 'svc', MSG_PROXY_USER_ID: 'desenv', MSG_PROXY_ORG_ID: 'collabcodes' };
  const withJwt = await proxyCandidateRequest({ action: 'candidateRead' }, 'verified token', async (input, init) => {
    assert.equal(String(input), 'https://candidate.invalid/exec/candidate');
    assert.deepEqual(init?.headers, { 'Content-Type': 'application/json', Cookie: 'cauth=verified%20token' });
    assert.equal((init?.headers as Record<string, string>).Authorization, undefined);
    return new Response('{}', { status: 200 });
  }, serviceEnv);
  assert.equal(withJwt.statusCode, 200);

  await proxyCandidateRequest({ action: 'candidateRead' }, '', async (_input, init) => {
    assert.deepEqual(init?.headers, {
      'Content-Type': 'application/json',
      Authorization: 'Bearer svc',
      'X-User-Id': 'desenv',
      'X-Org-Id': 'collabcodes',
    });
    return new Response('{}', { status: 200 });
  }, serviceEnv);

  assert.equal(candidateForwardHeaders('', {}), null);
  assert.equal((await proxyCandidateRequest({ action: 'candidateRead' }, '', async () => {
    throw new Error('must not fetch');
  }, {})).statusCode, 401);
  assert.equal((await proxyCandidateRequest({ action: 'candidateRead' }, '', async () => {
    throw new Error('must not fetch');
  }, { MSG_PROXY_TOKEN: 'svc', MSG_PROXY_USER_ID: '' })).statusCode, 401);
});

test('hub org id prefers the project file, then a non-empty env', () => {
  assert.equal(candidateHubOrgId('org-file', { CANDIDATE_HUB_ORG_ID: 'org-env' }), 'org-file');
  assert.equal(candidateHubOrgId(null, { CANDIDATE_HUB_ORG_ID: 'org-env' }), 'org-env');
  assert.equal(candidateHubOrgId(undefined, { CANDIDATE_HUB_ORG_ID: '  org-env  ' }), 'org-env');
  assert.equal(candidateHubOrgId('   ', { CANDIDATE_HUB_ORG_ID: 'org-env' }), 'org-env');
  assert.equal(candidateHubOrgId(null, { CANDIDATE_HUB_ORG_ID: '' }), null);
  assert.equal(candidateHubOrgId(null, { CANDIDATE_HUB_ORG_ID: '   ' }), null);
  assert.equal(candidateHubOrgId(null, {}), null);
});

test('local caller is the session, the service identity, the desenv, or null', () => {
  const desenv = { MSG_PROXY_TOKEN: 'svc', MSG_PROXY_USER_ID: 'desenv', MSG_PROXY_ORG_ID: 'collabcodes' };
  assert.deepEqual(
    candidateLocalCaller({ kind: 'jwt' }, { email: 'alice@example.com', orgId: 'org-1' }, {}),
    { owner: 'alice@example.com', orgId: 'org-1' },
  );
  assert.deepEqual(
    candidateLocalCaller({ kind: 'service', owner: 'svc-user', orgId: 'org-svc' }, {}, desenv),
    { owner: 'svc-user', orgId: 'org-svc' },
  );
  assert.deepEqual(
    candidateLocalCaller({ kind: 'none' }, {}, desenv),
    { owner: 'desenv', orgId: 'collabcodes' },
  );
  assert.equal(candidateLocalCaller({ kind: 'none' }, {}, {}), null);
  assert.equal(candidateLocalCaller({ kind: 'none' }, {}, { MSG_PROXY_TOKEN: 'svc', MSG_PROXY_USER_ID: '' }), null);
  assert.equal(candidateLocalCaller({ kind: 'none' }, {}, { MSG_PROXY_TOKEN: '', MSG_PROXY_USER_ID: 'desenv' }), null);
  assert.deepEqual(
    candidateLocalCaller({ kind: 'none' }, {}, { MSG_PROXY_TOKEN: 'svc', MSG_PROXY_USER_ID: 'desenv' }),
    { owner: 'desenv', orgId: null },
  );
  assert.equal(JSON.stringify(candidateLocalCaller({ kind: 'none' }, {}, desenv)).includes('svc'), false);
});

test('1.25MB route limit accommodates the maximum contracted payload', () => {
  const paths = [
    'module.defs.ts', 'journeys/index.defs.ts', 'ontology/index.defs.ts',
    'rules.defs.ts', 'workflows.defs.ts', 'access.defs.ts', 'integration.defs.ts',
    ...Array.from({ length: 73 }, (_, index) => `ontology/E${index}.defs.ts`),
  ];
  const perFile = Math.floor(700_000 / paths.length);
  let assigned = 0;
  const request = 'r'.repeat(64_000);
  const files = paths.map((path, index) => {
    const bytes = index === paths.length - 1 ? 700_000 - assigned : perFile;
    assigned += bytes;
    return { path, sha256: 'f'.repeat(64), contentBase64: Buffer.alloc(bytes, index + 1).toString('base64') };
  });
  const body = JSON.stringify({
    action: 'candidatePublish', project: 102047, moduleName: 'agendaClinica',
    expectedRevisionId: null, requestId: 'r', changeId: 'c', revisionId: 'v',
    snapshot: { hash: 'f'.repeat(64), baseId: 'b', requestRevision: 1, request, files },
  });
  assert.equal(files.length, 80);
  assert.equal(files.reduce((sum, file) => sum + Buffer.from(file.contentBase64, 'base64').length, 0), 700_000);
  assert.ok(Buffer.byteLength(body) < CANDIDATE_BODY_LIMIT, `${Buffer.byteLength(body)} must fit ${CANDIDATE_BODY_LIMIT}`);
});

test('forward route returns 503 without fetching when origin is missing or invalid', async () => {
  const previousOrigin = process.env.CANDIDATE_ORIGIN;
  const previousHub = process.env.CANDIDATE_HUB;
  const previousToken = process.env.MSG_PROXY_TOKEN;
  const previousUser = process.env.MSG_PROXY_USER_ID;
  delete process.env.CANDIDATE_HUB;
  process.env.MSG_PROXY_TOKEN = 'svc';
  process.env.MSG_PROXY_USER_ID = 'desenv';
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error('must not fetch');
  }) as typeof fetch;
  const app = Fastify();
  registerCbeRoutes(app);
  try {
    for (const origin of [undefined, '', 'http://example.com'] as const) {
      if (origin === undefined) delete process.env.CANDIDATE_ORIGIN;
      else process.env.CANDIDATE_ORIGIN = origin;
      const response = await app.inject({ method: 'POST', url: '/exec/candidate', payload: { action: 'candidateRead' } });
      assert.equal(response.statusCode, 503);
      assert.equal(response.json().msg, 'candidate.transport_unavailable');
      assert.equal(JSON.stringify(response.json()).includes('example.com'), false);
    }
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    if (previousOrigin === undefined) delete process.env.CANDIDATE_ORIGIN;
    else process.env.CANDIDATE_ORIGIN = previousOrigin;
    if (previousHub === undefined) delete process.env.CANDIDATE_HUB;
    else process.env.CANDIDATE_HUB = previousHub;
    if (previousToken === undefined) delete process.env.MSG_PROXY_TOKEN;
    else process.env.MSG_PROXY_TOKEN = previousToken;
    if (previousUser === undefined) delete process.env.MSG_PROXY_USER_ID;
    else process.env.MSG_PROXY_USER_ID = previousUser;
  }
});

test('registerCbeRoutes boots without an origin and local hub does not need one', () => {
  const previousOrigin = process.env.CANDIDATE_ORIGIN;
  const previousHub = process.env.CANDIDATE_HUB;
  const lines: string[] = [];
  const previousInfo = console.info;
  console.info = ((message?: unknown) => { lines.push(String(message)); }) as typeof console.info;
  const forwardApp = Fastify();
  const localApp = Fastify();
  try {
    delete process.env.CANDIDATE_ORIGIN;
    delete process.env.CANDIDATE_HUB;
    registerCbeRoutes(forwardApp);
    assert.ok(lines.some((line) => line.includes('CANDIDATE_ORIGIN is not configured')));
    lines.length = 0;
    process.env.CANDIDATE_HUB = 'local';
    registerCbeRoutes(localApp);
    assert.ok(lines.some((line) => line.includes('candidate: local hub')));
    assert.equal(lines.some((line) => line.includes('CANDIDATE_ORIGIN')), false);
  } finally {
    console.info = previousInfo;
    void forwardApp.close();
    void localApp.close();
    if (previousOrigin === undefined) delete process.env.CANDIDATE_ORIGIN;
    else process.env.CANDIDATE_ORIGIN = previousOrigin;
    if (previousHub === undefined) delete process.env.CANDIDATE_HUB;
    else process.env.CANDIDATE_HUB = previousHub;
  }
});
