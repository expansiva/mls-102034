/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeSessionEmail.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import type { FastifyRequest } from 'fastify';
import { mintLocalTestCookie, setLocalTestConfigLoaderForTests } from '/_102034_/l1/server/layer_1_external/auth/localTestSession.js';
import { sessionHooks } from '/_102034_/l1/server/layer_1_external/cbe/cbeRoutes.js';
import type { LocalTestConfig } from '/_102034_/l1/server/layer_1_external/config/localTestConfig.js';

const PROJECT = '102047';
const PORT = 2047;
const HOST = `localhost:${PORT}`;
const ORIGIN = `http://localhost:${PORT}`;

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
    cookieKey: 'k'.repeat(32),
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

function requestWith(cookie: string | undefined): FastifyRequest {
  const headers: Record<string, string> = { host: HOST, origin: ORIGIN };
  if (cookie !== undefined) headers.cookie = cookie;
  return { headers } as unknown as FastifyRequest;
}

function personaCookie(alias: 'responsavel' | 'membro', state: LocalTestConfig): string {
  return `collab_local_test_${PROJECT}=${mintLocalTestCookie(alias, state)}`;
}

test('emailOf names the local-test persona; two personas give two different e-mails', async () => {
  const state = bench();
  setLocalTestConfigLoaderForTests(() => state);
  try {
    const a = await sessionHooks.emailOf(requestWith(personaCookie('responsavel', state)));
    const b = await sessionHooks.emailOf(requestWith(personaCookie('membro', state)));
    assert.equal(a, `responsavel.${PROJECT}@runtime.test`);
    assert.equal(b, `membro.${PROJECT}@runtime.test`);
    assert.notEqual(a, b);
  } finally {
    setLocalTestConfigLoaderForTests();
  }
});

test('emailOf gives no person without a cookie, with a bad cookie or with the bench off', async () => {
  const on = bench();
  setLocalTestConfigLoaderForTests(() => on);
  try {
    assert.equal(await sessionHooks.emailOf(requestWith(undefined)), undefined);
    assert.equal(await sessionHooks.emailOf(requestWith(`collab_local_test_${PROJECT}=garbage.value`)), undefined);
  } finally {
    setLocalTestConfigLoaderForTests();
  }
  setLocalTestConfigLoaderForTests(() => ({ enabled: false }));
  try {
    assert.equal(await sessionHooks.emailOf(requestWith(personaCookie('responsavel', on))), undefined);
  } finally {
    setLocalTestConfigLoaderForTests();
  }
});
