/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeCandidateProxy.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { CANDIDATE_BODY_LIMIT, candidateActionAllowed, proxyCandidateRequest } from '/_102034_/l1/server/layer_1_external/cbe/cbeCandidateProxy.js';
import { registerCbeRoutes } from '/_102034_/l1/server/layer_1_external/cbe/cbeRoutes.js';

test('candidate proxy allowlists exactly read, publish and mark-result', () => {
  assert.equal(candidateActionAllowed({ action: 'candidateRead' }), true);
  assert.equal(candidateActionAllowed({ action: 'candidatePublish' }), true);
  assert.equal(candidateActionAllowed({ action: 'candidateMarkResult' }), true);
  assert.equal(candidateActionAllowed({ action: 'login' }), false);
  assert.equal(candidateActionAllowed(null), false);
});

test('candidate proxy forwards only the verified cauth token and preserves conflict', async () => {
  const original = process.env.CBE_CENTRAL_ORIGIN;
  process.env.CBE_CENTRAL_ORIGIN = 'https://on.collab.codes';
  try {
    const result = await proxyCandidateRequest(
      { action: 'candidatePublish', project: 102047 }, 'verified token',
      async (input, init) => {
        assert.equal(String(input), 'https://on.collab.codes/exec/candidate');
        assert.equal(init?.redirect, 'manual');
        assert.deepEqual(init?.headers, {
          'Content-Type': 'application/json', Cookie: 'cauth=verified%20token',
        });
        assert.equal((init?.headers as Record<string, string>).Authorization, undefined);
        return new Response(JSON.stringify({ statusCode: 409, status: 'conflict' }), {
          status: 409, headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    assert.equal(result.statusCode, 409);
    assert.deepEqual(result.body, { statusCode: 409, status: 'conflict' });
  } finally {
    if (original === undefined) delete process.env.CBE_CENTRAL_ORIGIN;
    else process.env.CBE_CENTRAL_ORIGIN = original;
  }
});

test('candidate proxy refuses anonymous, redirects and non-json transport', async () => {
  assert.equal((await proxyCandidateRequest({ action: 'candidateRead' }, '')).statusCode, 401);
  await assert.rejects(() => proxyCandidateRequest({ action: 'candidateRead' }, 'jwt',
    async () => new Response('', { status: 302, headers: { Location: 'https://evil.example/' } })));
  await assert.rejects(() => proxyCandidateRequest({ action: 'candidateRead' }, 'jwt',
    async () => new Response('<html/>', { status: 200 })));
});

test('runtime candidate route rejects test-user auth and rejects non-candidate actions locally', async () => {
  const previousUser = process.env.CBE_TEST_LOGIN_USER;
  const previousOrigin = process.env.CBE_CENTRAL_ORIGIN;
  process.env.CBE_TEST_LOGIN_USER = 'local-test-user';
  // If the allowlist regresses this unreachable origin would make the assertion fail as 503.
  process.env.CBE_CENTRAL_ORIGIN = 'https://127.0.0.1.invalid';
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
    if (previousOrigin === undefined) delete process.env.CBE_CENTRAL_ORIGIN;
    else process.env.CBE_CENTRAL_ORIGIN = previousOrigin;
  }
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
