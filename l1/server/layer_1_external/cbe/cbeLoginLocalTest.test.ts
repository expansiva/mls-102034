/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeLoginLocalTest.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { chdir } from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { mintLocalTestCookie, setLocalTestConfigLoaderForTests } from '/_102034_/l1/server/layer_1_external/auth/localTestSession.js';
import { registerCbeRoutes } from '/_102034_/l1/server/layer_1_external/cbe/cbeRoutes.js';
import type { LocalTestConfig } from '/_102034_/l1/server/layer_1_external/config/localTestConfig.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';

const PROJECT = '102047';
const PORT = 2047;
const KEY = 'k'.repeat(32);
const HOST = `localhost:${PORT}`;
const ORIGIN = `http://localhost:${PORT}`;
const TEST_USER = 'test-user@runtime.test';
const TEST_CAUTH = 'fake-test-cauth-token';
const TEST_LOGIN_MSG = 'fake-test-login-msg';
const MLS_BASE = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');

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

function cookieLines(setCookie: string | string[] | undefined): string[] {
  if (setCookie === undefined) return [];
  return Array.isArray(setCookie) ? setCookie : [setCookie];
}

function cookieValue(lines: string[], name: string): string | undefined {
  const line = lines.find((entry) => entry.startsWith(`${name}=`));
  if (!line) return undefined;
  const raw = line.slice(name.length + 1).split(';')[0];
  return decodeURIComponent(raw);
}

let tail: Promise<void> = Promise.resolve();

function withTestEnv(fn: () => Promise<void>): Promise<void> {
  const run = tail.then(fn, fn);
  tail = run.then(() => undefined, () => undefined);
  return run;
}

function isolateProjects(fn: () => Promise<void>): Promise<void> {
  return withTestEnv(async () => {
    const previous = {
      user: process.env.CBE_TEST_LOGIN_USER,
      cauth: process.env.CBE_TEST_CAUTH,
      loginMsg: process.env.CBE_TEST_LOGIN_MSG,
      cwd: process.cwd(),
    };
    const root = mkdtempSync(join(tmpdir(), 'cbe-login-local-'));
    writeFileSync(join(root, 'config.json'), JSON.stringify({
      defaultProjectId: PROJECT,
      projects: {
        [PROJECT]: { root: `mls-${PROJECT}`, type: 'client' },
        '102033': { root: 'mls-102033', type: 'master frontend' },
        '102034': { root: 'mls-102034', type: 'master backend' },
      },
    }));
    process.env.CBE_TEST_LOGIN_USER = TEST_USER;
    process.env.CBE_TEST_CAUTH = TEST_CAUTH;
    process.env.CBE_TEST_LOGIN_MSG = TEST_LOGIN_MSG;
    chdir(root);
    resetProjectsConfigCache();
    try {
      await fn();
    } finally {
      chdir(previous.cwd);
      resetProjectsConfigCache();
      const restore = (key: 'CBE_TEST_LOGIN_USER' | 'CBE_TEST_CAUTH' | 'CBE_TEST_LOGIN_MSG', value: string | undefined) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      };
      restore('CBE_TEST_LOGIN_USER', previous.user);
      restore('CBE_TEST_CAUTH', previous.cauth);
      restore('CBE_TEST_LOGIN_MSG', previous.loginMsg);
      setLocalTestConfigLoaderForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });
}

async function login(cookie?: string): Promise<{ statusCode: number; lines: string[] }> {
  const app = Fastify();
  registerCbeRoutes(app);
  const res = await app.inject({
    method: 'POST',
    url: '/exec',
    headers: {
      host: HOST,
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    payload: { action: 'login', email: 'forged@runtime.test', baseProject: 0 },
  });
  await app.close();
  return { statusCode: res.statusCode, lines: cookieLines(res.headers['set-cookie']) };
}

test('local-test cookie logs in as the selected person and expires fake cauth and loginMsg', async () => {
  const state = bench();
  setLocalTestConfigLoaderForTests(() => state);
  await isolateProjects(async () => {
    const cookie = `collab_local_test_${PROJECT}=${mintLocalTestCookie('responsavel', state)}`;
    const res = await login(cookie);
    assert.equal(res.statusCode, 200);
    assert.equal(cookieValue(res.lines, 'loginUser'), state.personas.responsavel.email);
    assert.equal(cookieValue(res.lines, 'cauth'), '');
    assert.equal(cookieValue(res.lines, 'loginMsg'), '');
    assert.ok(res.lines.every((line) => !line.includes(TEST_CAUTH)));
    assert.ok(res.lines.find((line) => line.startsWith('cauth='))?.includes('Expires='));
    assert.ok(res.lines.find((line) => line.startsWith('loginMsg='))?.includes('Expires='));
  });
});

test('without a local-test cookie the .env test user is unchanged', async () => {
  setLocalTestConfigLoaderForTests(() => bench());
  await isolateProjects(async () => {
    const res = await login();
    assert.equal(res.statusCode, 200);
    assert.equal(cookieValue(res.lines, 'loginUser'), TEST_USER);
    assert.equal(cookieValue(res.lines, 'cauth'), TEST_CAUTH);
    assert.equal(cookieValue(res.lines, 'loginMsg'), TEST_LOGIN_MSG);
  });
});

test('a tampered local-test cookie is anonymous and does not use the test user', async () => {
  setLocalTestConfigLoaderForTests(() => bench());
  await isolateProjects(async () => {
    const res = await login(`collab_local_test_${PROJECT}=not-a-valid-cookie`);
    assert.equal(res.statusCode, 200);
    assert.equal(cookieValue(res.lines, 'loginUser'), 'anonymous');
    assert.equal(cookieValue(res.lines, 'cauth'), undefined);
    assert.ok(res.lines.every((line) => !line.includes(TEST_CAUTH)));
    assert.ok(res.lines.every((line) => !line.includes(TEST_USER)));
  });
});

test('a verified JWT keeps the existing login cookies and ignores the local-test cookie', async () => {
  const script = `
    import { createServer } from 'node:http';
    import { once } from 'node:events';
    import { exportJWK, generateKeyPair, SignJWT } from 'jose';
    import Fastify from 'fastify';
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...await exportJWK(publicKey), kid: 'fixture', alg: 'RS256', use: 'sig' };
    const issuer = 'https://fixture.invalid';
    const server = createServer((request, reply) => {
      reply.setHeader('content-type', 'application/json');
      reply.end(JSON.stringify({ keys: [jwk] }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    process.env.COLLAB_AUTH_BASE_URL = 'http://127.0.0.1:' + address.port;
    process.env.COLLAB_AUTH_JWKS_URL = process.env.COLLAB_AUTH_BASE_URL + '/.well-known/jwks.json';
    process.env.COLLAB_AUTH_ISSUER = issuer;
    process.env.AUTH_JWT_ENABLED = 'true';
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      email: 'jwt-user@runtime.test',
      active_org: { id: 'org-a' },
    }).setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).setSubject('jwt-user').setIssuer(issuer).setIssuedAt(now).setExpirationTime(now + 3600).sign(privateKey);
    const pick = (mod, name) => {
      if (typeof mod[name] === 'function') return mod[name];
      if (mod.default && typeof mod.default[name] === 'function') return mod.default[name];
      throw new Error(name + ' missing from ' + Object.keys(mod).join(','));
    };
    const sessionMod = await import('/_102034_/l1/server/layer_1_external/auth/localTestSession.js');
    const routesMod = await import('/_102034_/l1/server/layer_1_external/cbe/cbeRoutes.js');
    const configMod = await import('/_102034_/l1/server/layer_1_external/config/projectConfig.js');
    const mintLocalTestCookie = pick(sessionMod, 'mintLocalTestCookie');
    const setLocalTestConfigLoaderForTests = pick(sessionMod, 'setLocalTestConfigLoaderForTests');
    const registerCbeRoutes = pick(routesMod, 'registerCbeRoutes');
    const resetProjectsConfigCache = pick(configMod, 'resetProjectsConfigCache');
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { chdir } = await import('node:process');
    const root = mkdtempSync(join(tmpdir(), 'cbe-login-jwt-'));
    writeFileSync(join(root, 'config.json'), JSON.stringify({
      defaultProjectId: ${JSON.stringify(PROJECT)},
      projects: {
        ${JSON.stringify(PROJECT)}: { root: 'mls-${PROJECT}', type: 'client' },
        '102033': { root: 'mls-102033', type: 'master frontend' },
        '102034': { root: 'mls-102034', type: 'master backend' },
      },
    }));
    chdir(root);
    resetProjectsConfigCache();
    const state = {
      enabled: true,
      projectId: ${JSON.stringify(PROJECT)},
      organizationKey: 'org-bench',
      companyMdmId: 'company-1',
      cmOrgId: 'runtime-test:${PROJECT}',
      cmTarget: 'http://127.0.0.1:8180',
      storagePrefix: 'desenv_',
      allowedOrigins: [${JSON.stringify(ORIGIN)}],
      cookieKey: ${JSON.stringify(KEY)},
      personas: {
        responsavel: {
          alias: 'responsavel',
          email: 'responsavel.${PROJECT}@runtime.test',
          name: 'Responsavel',
          sub: 'local-test:${PROJECT}:responsavel',
          personMdmId: 'person-responsavel',
          cmUserId: 'cm-responsavel',
        },
        membro: {
          alias: 'membro',
          email: 'membro.${PROJECT}@runtime.test',
          name: 'Membro',
          sub: 'local-test:${PROJECT}:membro',
          personMdmId: 'person-membro',
          cmUserId: 'cm-membro',
        },
      },
    };
    setLocalTestConfigLoaderForTests(() => state);
    const app = Fastify();
    registerCbeRoutes(app);
    const local = 'collab_local_test_${PROJECT}=' + mintLocalTestCookie('responsavel', state);
    const res = await app.inject({
      method: 'POST',
      url: '/exec',
      headers: {
        host: ${JSON.stringify(HOST)},
        'content-type': 'application/json',
        cookie: 'cauth=' + token + '; ' + local,
      },
      payload: { action: 'login', baseProject: 0 },
    });
    await app.close();
    server.close();
    rmSync(root, { recursive: true, force: true });
    const lines = [].concat(res.headers['set-cookie'] ?? []);
    process.stdout.write(JSON.stringify({ statusCode: res.statusCode, lines }));
  `;
  const result = spawnSync(
    join(MLS_BASE, 'node_modules', '.bin', 'tsx'),
    ['--import', join(MLS_BASE, 'test/register-hooks.mjs'), '--import', join(MLS_BASE, 'test/setup-l1.ts'), '-e', script],
    {
      cwd: join(MLS_BASE, 'mls-102034/l1'),
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: join(MLS_BASE, 'test/tsconfig.runtime.json'),
        CBE_TEST_LOGIN_USER: TEST_USER,
        CBE_TEST_CAUTH: TEST_CAUTH,
        CBE_TEST_LOGIN_MSG: TEST_LOGIN_MSG,
      },
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '') as { statusCode: number; lines: string[] };
  assert.equal(parsed.statusCode, 200);
  assert.equal(cookieValue(parsed.lines, 'loginUser'), 'jwt-user@runtime.test');
  assert.equal(cookieValue(parsed.lines, 'cauth'), undefined);
  assert.ok(parsed.lines.every((line) => !line.includes(TEST_CAUTH)));
  assert.ok(parsed.lines.every((line) => !line.includes('responsavel.')));
});
