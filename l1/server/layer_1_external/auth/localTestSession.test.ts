/// <mls fileReference="_102034_/l1/server/layer_1_external/auth/localTestSession.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { claimAuthorities, resolveBffSession } from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';
import {
  LOCAL_TEST_MAX_AGE_SEC,
  mintLocalTestCookie,
  readLocalTestCookie,
  setLocalTestConfigLoaderForTests,
  type LocalTestSessionClaims,
} from '/_102034_/l1/server/layer_1_external/auth/localTestSession.js';
import type { LocalTestConfig } from '/_102034_/l1/server/layer_1_external/config/localTestConfig.js';

const PROJECT = '102047';
const PORT = 2047;
const KEY = 'k'.repeat(32);
const HOST = `localhost:${PORT}`;
const ORIGIN = `http://localhost:${PORT}`;
const nowMs = Date.now();

function bench(): LocalTestConfig {
  return {
    enabled: true,
    projectId: PROJECT,
    organizationKey: 'org-bench',
    companyMdmId: 'company-1',
    cmOrgId: `runtime-test:${PROJECT}`,
    cmTarget: 'http://127.0.0.1:8180',
    storagePrefix: 'desenv_',
    allowedOrigins: [ORIGIN, `http://127.0.0.1:${PORT}`],
    cookieKey: KEY,
    personas: {
      responsavel: {
        alias: 'responsavel',
        email: `responsavel.${PROJECT}@runtime.test`,
        name: 'Responsavel',
        sub: `local-test:${PROJECT}:responsavel`,
        personMdmId: 'person-responsavel',
        cmUserId: 'cm-responsavel',
      },
      membro: {
        alias: 'membro',
        email: `membro.${PROJECT}@runtime.test`,
        name: 'Membro',
        sub: `local-test:${PROJECT}:membro`,
        personMdmId: 'person-membro',
        cmUserId: 'cm-membro',
      },
    },
  };
}

function cookieHeader(alias: 'responsavel' | 'membro', state = bench()): string {
  return `collab_local_test_${state.projectId}=${mintLocalTestCookie(alias, state, nowMs)}`;
}

function headers(cookie: string, extra: Record<string, string> = {}): Record<string, string> {
  return { cookie, host: HOST, ...extra };
}

function signRaw(payload: Record<string, unknown>, key = KEY): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${mac}`;
}

test('two cookies resolve to their own claims and ignore body or header identity', async () => {
  const state = bench();
  setLocalTestConfigLoaderForTests(() => state);
  try {
    const responsavel = await resolveBffSession(headers(cookieHeader('responsavel'), {
      'x-alias': 'membro',
      'x-user-id': 'cm-membro',
      'x-person-id': 'person-membro',
    }));
    const membro = await resolveBffSession(headers(cookieHeader('membro'), { origin: ORIGIN }));
    assert.equal(responsavel.source, 'local-test');
    assert.equal(membro.source, 'local-test');
    assert.equal(responsavel.reject, false);
    assert.equal(membro.reject, false);
    assert.equal(responsavel.claims?.sub, state.personas.responsavel.sub);
    assert.equal(responsavel.claims?.email, state.personas.responsavel.email);
    assert.equal(responsavel.claims?.name, state.personas.responsavel.name);
    assert.deepEqual(responsavel.claims?.active_org, { id: state.cmOrgId });
    assert.equal(membro.claims?.sub, state.personas.membro.sub);
    assert.equal(membro.claims?.email, state.personas.membro.email);
    assert.deepEqual(claimAuthorities(responsavel.claims), []);
    assert.equal((responsavel.claims as LocalTestSessionClaims & { personMdmId?: string }).personMdmId, undefined);
    assert.equal((responsavel.claims as { cmUserId?: string }).cmUserId, undefined);
    assert.notEqual(responsavel.claims?.sub, membro.claims?.sub);
  } finally {
    setLocalTestConfigLoaderForTests();
  }
});

test('tamper, expiry, wrong project and a public host do not authenticate', async () => {
  const state = bench();
  setLocalTestConfigLoaderForTests(() => state);
  const minted = mintLocalTestCookie('responsavel', state, nowMs);
  const flipped = `${minted.slice(0, -2)}${minted.endsWith('a') ? 'b' : 'a'}`;
  const nowSec = Math.floor(nowMs / 1000);
  const expired = signRaw({
    alg: 'HS256', alias: 'responsavel', project: PROJECT,
    iat: nowSec - LOCAL_TEST_MAX_AGE_SEC - 10,
    exp: nowSec - 10,
  });
  const tooLong = signRaw({
    alg: 'HS256', alias: 'responsavel', project: PROJECT,
    iat: nowSec,
    exp: nowSec + LOCAL_TEST_MAX_AGE_SEC + 1,
  });
  const otherProject = signRaw({
    alg: 'HS256', alias: 'responsavel', project: '102099',
    iat: nowSec,
    exp: nowSec + 60,
  });
  const noneAlg = signRaw({
    alg: 'none', alias: 'responsavel', project: PROJECT,
    iat: nowSec,
    exp: nowSec + 60,
  });
  const forgedIds = signRaw({
    alg: 'HS256', alias: 'responsavel', project: PROJECT,
    iat: nowSec,
    exp: nowSec + 60,
    personMdmId: 'forged-person',
    cmUserId: 'forged-cm',
  });
  try {
    for (const token of [flipped, expired, tooLong, otherProject, noneAlg, '']) {
      const outcome = await resolveBffSession({
        cookie: `collab_local_test_${PROJECT}=${token}`,
        host: HOST,
      });
      assert.equal(outcome.reason, 'invalid-token', token.slice(0, 24));
      assert.equal(outcome.reject, true);
      assert.equal(outcome.claims, undefined);
      assert.equal(outcome.source, undefined);
    }
    const publicHost = await resolveBffSession({
      cookie: `collab_local_test_${PROJECT}=${minted}`,
      host: 'app.example.com',
      origin: ORIGIN,
    });
    assert.equal(publicHost.reason, 'invalid-token');
    assert.equal(publicHost.claims, undefined);

    const foreignOrigin = await resolveBffSession({
      cookie: `collab_local_test_${PROJECT}=${minted}`,
      host: HOST,
      origin: 'http://evil.example',
    });
    assert.equal(foreignOrigin.reason, 'invalid-token');

    const kept = readLocalTestCookie(forgedIds, state, HOST, '', nowMs);
    assert.equal(kept?.sub, state.personas.responsavel.sub);
    assert.equal(kept?.personMdmId, 'person-responsavel');
    assert.equal(kept?.cmUserId, 'cm-responsavel');
  } finally {
    setLocalTestConfigLoaderForTests();
  }
});

test('a real cauth wins, and a disabled bench ignores a leftover cookie', async () => {
  const state = bench();
  delete process.env.BFF_JWT_ENABLED;
  setLocalTestConfigLoaderForTests(() => state);
  try {
    const real = await resolveBffSession({
      cookie: `cauth=not-a-jwt; ${cookieHeader('responsavel')}`,
      host: HOST,
      authorization: 'Bearer also-not-a-jwt',
    });
    assert.equal(real.reason, 'invalid-token');
    assert.equal(real.source, undefined);
    assert.equal(real.claims, undefined);
  } finally {
    setLocalTestConfigLoaderForTests();
  }

  setLocalTestConfigLoaderForTests(() => ({ enabled: false }));
  try {
    const ignored = await resolveBffSession(headers(cookieHeader('membro')));
    assert.equal(ignored.reason, 'missing-token');
    assert.equal(ignored.reject, false);
    assert.equal(ignored.claims, undefined);
    assert.equal(ignored.source, undefined);

    const anonymous = await resolveBffSession({ host: HOST });
    assert.equal(anonymous.reason, 'missing-token');
    assert.equal(anonymous.reject, false);
  } finally {
    setLocalTestConfigLoaderForTests();
  }
});

test('a broken manifest rejects a leftover local cookie and still skips a request without one', async () => {
  setLocalTestConfigLoaderForTests(() => {
    throw new Error('local test session manifest is invalid');
  });
  try {
    const refused = await resolveBffSession({ cookie: `collab_local_test_${PROJECT}=abc`, host: HOST });
    assert.equal(refused.reason, 'invalid-token');
    assert.equal(refused.reject, true);
    const open = await resolveBffSession({ host: HOST });
    assert.equal(open.reason, 'missing-token');
    assert.equal(open.reject, false);
  } finally {
    setLocalTestConfigLoaderForTests();
  }
});
