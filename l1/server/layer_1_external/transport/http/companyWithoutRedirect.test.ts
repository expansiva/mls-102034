/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/companyWithoutRedirect.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { resetProjectsConfigCache, resolveWebDistPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { resetResolvedTableDefinitionsCache } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { createDefaultRequestContext, createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { resetSharedDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/runtimeFactory.js';
import { getEntity } from '/_102034_/l1/mdm/layer_3_usecases/internal/entityPersistence.js';
import {
  getResolvedOrganizationCompanyId,
  initializeOrganizationForProcess,
  resetResolvedOrganizationCompanyId,
} from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';
import {
  buildHttpServer,
  resolveSessionInfoBody,
  type SessionOnboardingSource,
} from '/_102034_/l1/server/layer_1_external/transport/http/startServer.js';
import type { CollabAuthClaims } from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';

const previousCwd = process.cwd();
const workspace = mkdtempSync(join(tmpdir(), 'rt84-s2-'));
const clientId = '102084';
const entryPath = '/inicio/inicio_pessoa';

function onboarding(redirect?: boolean) {
  return {
    moduleId: 'inicio',
    entryPath,
    personType: 'inicio.Pessoa',
    companyType: 'inicio.Empresa',
    organizationSource: 'development-project',
    ...(redirect === undefined ? {} : { redirect }),
  };
}

function writeConfig(block: 'false' | 'true' | 'default' | 'absent'): void {
  const config: Record<string, unknown> = {
    defaultProjectId: clientId,
    shellTemplates: { spa: './shells/spa.html', pwa: './shells/pwa.html' },
    projects: {
      [clientId]: {
        root: './client',
        type: 'client',
        persistenceModules: [{
          moduleId: 'mdm',
          persistenceEntrypoint: './_102034_/l1/mdm/persistence.js',
        }],
        modules: [
          {
            moduleId: 'inicio',
            basePath: '/inicio',
            shellMode: 'spa',
            frontend: {
              pages: [{ pageId: 'pessoa', route: entryPath, source: 'pessoa.ts', componentTag: 'x-pessoa', title: 'Pessoa' }],
            },
          },
          {
            moduleId: 'painel',
            basePath: '/painel',
            shellMode: 'pwa',
            frontend: {
              pages: [{ pageId: 'painel', route: '/painel/home', source: 'painel.ts', componentTag: 'x-painel', title: 'Painel' }],
            },
          },
        ],
      },
      '102029': { root: './fe', type: 'master frontend' },
      '102034': { root: './be', type: 'master backend' },
    },
  };
  if (block === 'false') config.onboarding = onboarding(false);
  if (block === 'true') config.onboarding = onboarding(true);
  if (block === 'default') config.onboarding = onboarding(undefined);
  writeFileSync(join(workspace, 'config.json'), JSON.stringify(config));
  resetProjectsConfigCache();
}

function resetProcessCaches(): void {
  resetProjectsConfigCache();
  resetResolvedTableDefinitionsCache();
  resetSharedDataRuntime();
  resetResolvedOrganizationCompanyId();
}

mkdirSync(join(workspace, `mls-${clientId}`, 'l5'), { recursive: true });
writeFileSync(join(workspace, `mls-${clientId}`, 'l5', 'project.json'), JSON.stringify({
  orgName: 'Rt84 Sessao',
  appEnv: 'development',
}));
symlinkSync(fileURLToPath(new URL('../../../../../', import.meta.url)), join(workspace, 'mls-102034'));
process.chdir(workspace);
resetProcessCaches();
writeConfig('false');
const shellDir = resolveWebDistPath('./shells');
mkdirSync(shellDir, { recursive: true });
const shellHtml = '<!doctype html><html><head><title>rt84</title></head><body></body></html>';
writeFileSync(join(shellDir, 'spa.html'), shellHtml);
writeFileSync(join(shellDir, 'pwa.html'), shellHtml);

after(() => {
  process.chdir(previousCwd);
  resetProcessCaches();
  rmSync(workspace, { recursive: true, force: true });
});

function bootPayload(html: string): Record<string, unknown> {
  const start = html.indexOf('window.collabBoot=');
  const end = html.indexOf(';window.collabFecho=');
  assert.ok(start >= 0 && end > start);
  return JSON.parse(html.slice(start + 'window.collabBoot='.length, end)) as Record<string, unknown>;
}

const claims = {
  sub: 'rt84-user',
  email: 'pessoa@rt84.test',
  name: 'Pessoa',
  picture: 'https://idp.example/p.png',
  authorities: ['inicio:responsavel'],
} as CollabAuthClaims;

test('redirect false keeps one Company in the BFF and session and omits boot entry', async () => {
  await initializeOrganizationForProcess();
  const companyMdmId = getResolvedOrganizationCompanyId();
  assert.ok(companyMdmId);
  const again = await initializeOrganizationForProcess().then(() => getResolvedOrganizationCompanyId());
  assert.equal(again, companyMdmId);

  const ctx = createDefaultRequestContext();
  assert.equal(ctx.sessionContext.activeCompanyId, companyMdmId);
  const before = await getEntity(ctx, companyMdmId);
  assert.equal(before.details.subtype, 'Company');

  const session = await resolveSessionInfoBody(
    ctx,
    { claims, reject: false, reason: 'ok' },
    'development',
    null,
  );
  assert.deepEqual(session.company, { mdmId: companyMdmId });
  assert.equal(session.onboarding?.status, 'unregistered');
  assert.equal(session.onboarding?.entryPath, entryPath);
  assert.equal(session.userId, 'rt84-user');
  assert.deepEqual(session.allAuthorities, ['inicio:responsavel']);
  assert.equal(JSON.stringify(session).includes('development-org:'), false);

  const foreign: SessionOnboardingSource = {
    entry: { entryPath, moduleBasePath: '/inicio' },
    organizationKey: 'org:rt84',
    companyMdmId: 'gate-must-not-replace',
  };
  const gated = await resolveSessionInfoBody(ctx, { claims, reject: false, reason: 'ok' }, 'development', null, foreign);
  assert.deepEqual(gated.company, { mdmId: companyMdmId });

  const configuredOnly = createRequestContext(undefined, {
    sessionContext: { activeCompanyId: companyMdmId },
  });
  const withoutGate = await resolveSessionInfoBody(
    configuredOnly,
    { claims, reject: false, reason: 'ok' },
    'development',
    null,
    null,
  );
  assert.deepEqual(withoutGate.company, { mdmId: companyMdmId });
  assert.equal('onboarding' in withoutGate, false);

  const app = buildHttpServer();
  try {
    const anonymous = await app.inject({ method: 'GET', url: '/session/info' });
    assert.equal(anonymous.headers['cache-control'], 'no-store');
    const anonBody = anonymous.json();
    assert.equal(anonBody.authenticated, false);
    assert.equal(anonBody.userId, null);
    assert.equal('company' in anonBody, false);
    assert.equal('onboarding' in anonBody, false);

    const register = await app.inject({ method: 'POST', url: '/session/register', payload: {} });
    assert.notEqual(register.statusCode, 404);
    assert.match(String(register.headers['content-type'] ?? ''), /json/u);
    const list = await app.inject({ method: 'GET', url: '/session/registration/requests' });
    assert.notEqual(list.statusCode, 404);

    const shells = await Promise.all(['/inicio/index.html', '/painel/index.html'].map(async (url) => {
      const response = await app.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 200);
      return bootPayload(response.body);
    }));
    assert.equal('onboarding' in shells[0], false);
    assert.equal('onboarding' in shells[1], false);
    assert.equal(shells[0].shellMode, 'spa');
    assert.equal(shells[1].shellMode, 'pwa');
    assert.equal(JSON.stringify(shells).includes(companyMdmId), false);

    writeConfig('true');
    const armed = await Promise.all(['/inicio/index.html', '/painel/index.html'].map(async (url) => {
      const response = await app.inject({ method: 'GET', url });
      return bootPayload(response.body);
    }));
    assert.deepEqual(armed[0].onboarding, { entryPath, moduleBasePath: '/inicio' });
    assert.deepEqual(armed[1].onboarding, armed[0].onboarding);
    assert.equal(armed[0].shellMode, 'spa');
    assert.equal(armed[1].shellMode, 'pwa');

    writeConfig('default');
    const implicit = bootPayload((await app.inject({ method: 'GET', url: '/inicio/index.html' })).body);
    assert.deepEqual(implicit.onboarding, { entryPath, moduleBasePath: '/inicio' });
  } finally {
    await app.close();
  }

  const after = await getEntity(createDefaultRequestContext(), companyMdmId);
  assert.equal(after.document.version, before.document.version);

  writeConfig('absent');
  resetResolvedOrganizationCompanyId();
  await initializeOrganizationForProcess();
  assert.equal(getResolvedOrganizationCompanyId(), undefined);
  const bare = createDefaultRequestContext();
  assert.equal(bare.sessionContext.activeCompanyId, undefined);
  const legacy = await resolveSessionInfoBody(bare, { claims, reject: false, reason: 'ok' }, 'development', null);
  assert.equal('company' in legacy, false);
  assert.equal('onboarding' in legacy, false);

  const quiet = buildHttpServer();
  try {
    const html = bootPayload((await quiet.inject({ method: 'GET', url: '/inicio/index.html' })).body);
    assert.equal('onboarding' in html, false);
    const gone = await quiet.inject({ method: 'POST', url: '/session/register', payload: {} });
    assert.equal(gone.statusCode, 404);
  } finally {
    await quiet.close();
  }
});
