/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/localTestSessionTransport.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { getLocalTestConfig, resetLocalTestConfigCache, type LocalTestConfig } from '/_102034_/l1/server/layer_1_external/config/localTestConfig.js';
import { readProjectsConfig, resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { resolveOrganizationBinding } from '/_102034_/l1/server/layer_1_external/config/onboardingConfig.js';
import { resetAlphaAuthoritiesCache } from '/_102034_/l1/server/layer_1_external/config/alphaAuthorities.js';
import { resetResolvedTableDefinitionsCache } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { resetSharedDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/runtimeFactory.js';
import {
  getResolvedOrganizationCompanyId,
  initializeOrganizationForProcess,
  resetResolvedOrganizationCompanyId,
} from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';
import { ensureLocalTestPair } from '/_102034_/l1/mdm/layer_3_usecases/localTestSeed.js';
import { resetModuleRouterCache } from '/_102034_/l1/server/layer_2_controllers/moduleRegistry.js';
import { createDefaultRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { resetSharedBffExecutionSeriesStore } from '/_102034_/l1/monitor/layer_1_external/cache/BffExecutionSeriesStore.js';
import { setLocalTestProxyConfigLoaderForTests } from '/_102034_/l1/server/layer_1_external/transport/http/msgProxy.js';
import { buildHttpServer } from '/_102034_/l1/server/layer_1_external/transport/http/startServer.js';


const PROJECT = '109986';
const PORT = 9986;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://${HOST}`;
const KEY = 'rt86-transport-cookie-key-32b!!!!';
const TOKEN = 'rt86-service-token-must-not-leak';

const ENV_KEYS = [
  'APP_ENV',
  'RUNTIME_MODE',
  'WRITE_BEHIND_ENABLED',
  'BFF_JWT_ENABLED',
  'LOCAL_TEST_SESSION_ENABLED',
  'LOCAL_TEST_SESSIONS_FILE',
  'MSG_PROXY_TARGET',
  'MSG_PROXY_TOKEN',
  'MSG_PROXY_USER_ID',
  'MSG_PROXY_ORG_ID',
  'MSG_PROXY_ENABLED',
  'ACTIVE_COMPANY_ID',
  'ACTOR_ID',
] as const;

interface Hit {
  url: string;
  authorization: string;
  userId: string;
  orgId: string;
  cookie: string;
}

test('two local jars keep their own person, the same company, and separate cm headers', async () => {
  const savedCwd = process.cwd();
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  const root = mkdtempSync(join(tmpdir(), 'rt86-transport-'));
  const hits: Hit[] = [];
  const upstream = createServer((req: IncomingMessage, res: ServerResponse) => {
    const userId = String(req.headers['x-user-id'] ?? '');
    hits.push({
      url: req.url ?? '',
      authorization: String(req.headers.authorization ?? ''),
      userId,
      orgId: String(req.headers['x-org-id'] ?? ''),
      cookie: String(req.headers.cookie ?? ''),
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ cmUserId: userId }));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('upstream address missing');
  const upstreamUrl = `http://127.0.0.1:${address.port}`;

  let app: ReturnType<typeof buildHttpServer> | undefined;
  try {
    mkdirSync(join(root, 'dist', 'local', `_${PROJECT}_`, 'l1', 'controllers'), { recursive: true });
    mkdirSync(join(root, `mls-${PROJECT}`, 'l5'), { recursive: true });
    symlinkSync(fileURLToPath(new URL('../../../../..', import.meta.url)), join(root, 'mls-102034'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(join(root, `mls-${PROJECT}`, 'l5', 'project.json'), JSON.stringify({
      appEnv: 'development',
      orgName: 'Bench Org',
    }));
    writeFileSync(join(root, 'config.json'), JSON.stringify({
      defaultProjectId: PROJECT,
      alphaAllAuthorities: false,
      shellTemplates: { spa: './spa.html', pwa: './pwa.html' },
      onboarding: {
        moduleId: 'bench',
        entryPath: '/bench/home',
        personType: 'Member',
        companyType: 'bench.Company',
        organizationSource: 'development-project',
      },
      projects: {
        [PROJECT]: {
          root: './client',
          type: 'client',
          persistenceModules: [{
            moduleId: 'mdm',
            persistenceEntrypoint: './_102034_/l1/mdm/persistence.js',
          }],
          modules: [{
            moduleId: 'bench',
            basePath: '/bench',
            shellMode: 'spa',
            backendControllers: `./_${PROJECT}_/l1/controllers`,
            frontend: {
              pages: [{ pageId: 'home', route: '/bench/home', source: 'home.ts', componentTag: 'x-home', title: 'Home' }],
            },
          }],
        },
        '102029': { root: './fe', type: 'master frontend' },
        '102034': { root: './be', type: 'master backend' },
      },
    }));
    writeFileSync(join(root, 'dist', 'local', `_${PROJECT}_`, 'l1', 'controllers', 'observe.js'), [
      'export const routes = [{',
      "  key: 'bench.observe',",
      '  handler: async ({ request, ctx }) => ({',
      '    ok: true,',
      '    data: {',
      '      actorId: ctx.sessionContext.actorId,',
      '      personMdmId: ctx.sessionContext.person?.mdmId ?? null,',
      '      activeCompanyId: ctx.sessionContext.activeCompanyId,',
      '      verifiedEmail: request.meta?.verifiedEmail ?? null,',
      '      verifiedUserId: request.meta?.verifiedUserId ?? null,',
      '    },',
      '    error: null,',
      '  }),',
      '}];',
      '',
    ].join('\n'));

    process.chdir(root);
    process.env.APP_ENV = 'development';
    process.env.RUNTIME_MODE = 'memory';
    process.env.WRITE_BEHIND_ENABLED = 'false';
    process.env.MSG_PROXY_TARGET = upstreamUrl;
    process.env.MSG_PROXY_TOKEN = TOKEN;
    process.env.MSG_PROXY_USER_ID = 'user-desenv';
    process.env.MSG_PROXY_ORG_ID = 'org-desenv';
    delete process.env.BFF_JWT_ENABLED;
    delete process.env.MSG_PROXY_ENABLED;
    delete process.env.ACTIVE_COMPANY_ID;
    delete process.env.ACTOR_ID;
    resetProjectsConfigCache();
    resetResolvedTableDefinitionsCache();
    resetSharedDataRuntime();
    resetResolvedOrganizationCompanyId();
    resetModuleRouterCache();
    resetAlphaAuthoritiesCache();
    resetSharedBffExecutionSeriesStore();
    resetLocalTestConfigCache();

    await initializeOrganizationForProcess();
    const projects = readProjectsConfig();
    const binding = resolveOrganizationBinding(projects);
    if (!binding) throw new Error('bench organization binding missing');
    const seeded = await ensureLocalTestPair(createDefaultRequestContext(), projects, binding);
    assert.equal(getResolvedOrganizationCompanyId(), seeded.companyMdmId);
    const byAlias = Object.fromEntries(seeded.personas.map((persona) => [persona.alias, persona]));
    const manifest = {
      schema: 1,
      scope: 'lima',
      projectId: PROJECT,
      organizationKey: binding.key,
      companyMdmId: seeded.companyMdmId,
      cmTarget: 'http://127.0.0.1:8180',
      cmOrgId: `runtime-test:${PROJECT}`,
      storagePrefix: 'desenv_',
      allowedOrigins: [ORIGIN, `http://localhost:${PORT}`],
      cookieKey: KEY,
      personas: {
        responsavel: {
          email: byAlias.responsavel.email,
          name: byAlias.responsavel.name,
          sub: byAlias.responsavel.sub,
          personMdmId: byAlias.responsavel.personMdmId,
          cmUserId: 'cm-responsavel',
        },
        membro: {
          email: byAlias.membro.email,
          name: byAlias.membro.name,
          sub: byAlias.membro.sub,
          personMdmId: byAlias.membro.personMdmId,
          cmUserId: 'cm-membro',
        },
      },
    };
    const manifestPath = join(root, 'bench.json');
    writeFileSync(manifestPath, JSON.stringify(manifest));
    chmodSync(manifestPath, 0o600);
    process.env.LOCAL_TEST_SESSION_ENABLED = 'true';
    process.env.LOCAL_TEST_SESSIONS_FILE = manifestPath;
    resetLocalTestConfigCache();

    app = buildHttpServer();
    const headers = { host: HOST, origin: ORIGIN, 'content-type': 'application/json' };

    async function select(persona: 'responsavel' | 'membro' | null): Promise<string> {
      const response = await app!.inject({
        method: 'POST',
        url: '/__test/session',
        headers,
        payload: { persona },
      });
      assert.equal(response.statusCode, 204, response.body);
      return String(response.headers['set-cookie']).split(';')[0];
    }

    const jarA = await select('responsavel');
    const jarB = await select('membro');

    async function sessionOf(cookie: string) {
      const response = await app!.inject({ method: 'GET', url: '/session/info', headers: { host: HOST, cookie } });
      assert.equal(response.statusCode, 200, response.body);
      return response.json();
    }

    async function observe(cookie: string, forgedEmail: string) {
      const response = await app!.inject({
        method: 'POST',
        url: '/execBff',
        headers: { ...headers, cookie },
        payload: {
          routine: 'bench.observe',
          params: {},
          meta: {
            actorId: 'forged-actor',
            verifiedEmail: forgedEmail,
            verifiedUserId: 'forged-sub',
            activeCompanyId: 'forged-company',
          },
        },
      });
      assert.equal(response.statusCode, 200, response.body);
      return response.json().data;
    }

    const [infoA, infoB] = await Promise.all([sessionOf(jarA), sessionOf(jarB)]);
    assert.equal(infoA.sessionSource, 'local-test');
    assert.equal(infoA.userId, byAlias.responsavel.sub);
    assert.equal(infoA.email, byAlias.responsavel.email);
    assert.equal(infoA.person.mdmId, byAlias.responsavel.personMdmId);
    assert.equal(infoB.userId, byAlias.membro.sub);
    assert.equal(infoB.person.mdmId, byAlias.membro.personMdmId);
    assert.equal(infoA.company.mdmId, seeded.companyMdmId);
    assert.equal(infoB.company.mdmId, seeded.companyMdmId);
    assert.equal(JSON.stringify(infoA).includes(KEY), false);
    assert.equal(JSON.stringify(infoA).includes(TOKEN), false);

    const [seenA, seenB] = await Promise.all([
      observe(jarA, 'forged-a@runtime.test'),
      observe(jarB, 'forged-b@runtime.test'),
    ]);
    assert.equal(seenA.actorId, byAlias.responsavel.personMdmId);
    assert.equal(seenA.personMdmId, byAlias.responsavel.personMdmId);
    assert.equal(seenA.verifiedUserId, byAlias.responsavel.sub);
    assert.equal(seenA.verifiedEmail, byAlias.responsavel.email);
    assert.equal(seenA.activeCompanyId, seeded.companyMdmId);
    assert.equal(seenB.actorId, byAlias.membro.personMdmId);
    assert.equal(seenB.activeCompanyId, seeded.companyMdmId);
    assert.notEqual(seenA.actorId, 'forged-actor');
    assert.notEqual(seenA.verifiedEmail, 'forged-a@runtime.test');

    const switched = await select('membro');
    const after = await sessionOf(switched);
    const untouched = await sessionOf(jarB);
    assert.equal(after.userId, byAlias.membro.sub);
    assert.equal(untouched.userId, byAlias.membro.sub);
    assert.equal((await sessionOf(jarA)).userId, byAlias.responsavel.sub);

    const tampered = await app.inject({
      method: 'POST',
      url: '/execBff',
      headers: { ...headers, cookie: `${jarA}x` },
      payload: { routine: 'bench.observe', params: {} },
    });
    assert.equal(tampered.statusCode, 401);

    const filed = getLocalTestConfig();
    assert.equal(filed.enabled && filed.cmTarget, 'http://127.0.0.1:8180');
    setLocalTestProxyConfigLoaderForTests(() => ({ ...(filed as LocalTestConfig), cmTarget: upstreamUrl }));
    const [msgA, msgB, who] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/msg',
        headers: { ...headers, cookie: jarA, 'x-user-id': 'cm-membro' },
        payload: { action: 'getUserUpdate', userId: 'cm-responsavel' },
      }),
      app.inject({
        method: 'POST',
        url: '/msg',
        headers: { ...headers, cookie: jarB },
        payload: { action: 'getUserUpdate', userId: 'cm-responsavel' },
      }),
      app.inject({ method: 'GET', url: '/whoami', headers: { host: HOST, cookie: jarB } }),
    ]);
    assert.equal(msgA.statusCode, 200, msgA.body);
    assert.equal(msgB.statusCode, 403);
    assert.equal(who.statusCode, 200, who.body);
    assert.equal(who.json().cmUserId, 'cm-membro');
    const forwarded = hits.filter((hit) => hit.url.startsWith('/msg') || hit.url === '/whoami');
    assert.equal(forwarded.length, 2);
    const msgHit = forwarded.find((hit) => hit.url.startsWith('/msg'));
    const whoHit = forwarded.find((hit) => hit.url === '/whoami');
    assert.equal(msgHit?.userId, 'cm-responsavel');
    assert.equal(msgHit?.orgId, `runtime-test:${PROJECT}`);
    assert.equal(msgHit?.authorization, `Bearer ${TOKEN}`);
    assert.equal(msgHit?.cookie.includes('collab_local_test_'), false);
    assert.equal(whoHit?.userId, 'cm-membro');
    assert.equal(JSON.stringify(hits).includes('user-desenv'), false);

    const logout = await app.inject({ method: 'GET', url: '/exec/logout', headers: { host: HOST } });
    assert.equal(logout.statusCode, 303);
    const cleared = String(logout.headers['set-cookie']);
    assert.match(cleared, new RegExp(`collab_local_test_${PROJECT}=`));
    assert.match(cleared, /Max-Age=0/);

    delete process.env.LOCAL_TEST_SESSION_ENABLED;
    resetLocalTestConfigCache();
    const gone = await app.inject({ method: 'GET', url: '/__test/session', headers: { host: HOST } });
    assert.equal(gone.statusCode, 404);
  } finally {
    setLocalTestProxyConfigLoaderForTests();
    if (app) await app.close();
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
    process.chdir(savedCwd);
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetProjectsConfigCache();
    resetResolvedTableDefinitionsCache();
    resetSharedDataRuntime();
    resetResolvedOrganizationCompanyId();
    resetModuleRouterCache();
    resetAlphaAuthoritiesCache();
    resetSharedBffExecutionSeriesStore();
    resetLocalTestConfigCache();
    rmSync(root, { recursive: true, force: true });
  }
});
