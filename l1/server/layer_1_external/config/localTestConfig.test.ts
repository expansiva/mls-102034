/// <mls fileReference="_102034_/l1/server/layer_1_external/config/localTestConfig.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  LocalTestConfigError,
  assertLocalTestProxyTarget,
  getLocalTestConfig,
  loadLocalTestConfig,
  lookupLocalTestPersona,
  resetLocalTestConfigCache,
  type LocalTestConfigDeps,
} from '/_102034_/l1/server/layer_1_external/config/localTestConfig.js';

const PROJECT = '102047';
const PORT = 2047;
const KEY = 'k'.repeat(32);

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    scope: 'lima',
    projectId: PROJECT,
    organizationKey: 'org-bench',
    companyMdmId: 'company-1',
    cmTarget: 'http://127.0.0.1:8180',
    cmOrgId: `runtime-test:${PROJECT}`,
    storagePrefix: 'desenv_',
    allowedOrigins: [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`],
    cookieKey: KEY,
    personas: {
      responsavel: {
        email: `responsavel.${PROJECT}@runtime.test`,
        name: 'Responsavel',
        sub: `local-test:${PROJECT}:responsavel`,
        personMdmId: 'person-responsavel',
        cmUserId: 'cm-responsavel',
      },
      membro: {
        email: `membro.${PROJECT}@runtime.test`,
        name: 'Membro',
        sub: `local-test:${PROJECT}:membro`,
        personMdmId: 'person-membro',
        cmUserId: 'cm-membro',
      },
    },
    ...overrides,
  };
}

function deps(text: string, mode: { declared: boolean; mode: string } = { declared: true, mode: 'development' }): LocalTestConfigDeps & { reads: number } {
  const bag = {
    reads: 0,
    readText() {
      bag.reads += 1;
      return text;
    },
    fileMode: () => 0o600,
    defaultProjectId: () => PROJECT,
    projectMode: () => mode,
  };
  return bag;
}

function enabledEnv(file = '/etc/collab/local-tests/102047.json'): NodeJS.ProcessEnv {
  return { LOCAL_TEST_SESSION_ENABLED: 'true', LOCAL_TEST_SESSIONS_FILE: file };
}

test('flag off does not read the manifest', () => {
  const sources = deps('{');
  const state = loadLocalTestConfig({ LOCAL_TEST_SESSIONS_FILE: '/etc/collab/local-tests/102047.json' }, sources);
  assert.deepEqual(state, { enabled: false });
  assert.equal(sources.reads, 0);
  assert.equal(lookupLocalTestPersona({ alias: 'responsavel' }, state), null);
  assert.throws(() => assertLocalTestProxyTarget('http://127.0.0.1:8180', state), /disabled/u);
});

test('two profiles resolve by alias, email and sub, not by id', () => {
  const state = loadLocalTestConfig(enabledEnv(), deps(JSON.stringify(manifest())));
  assert.equal(state.enabled, true);
  if (!state.enabled) return;
  const byAlias = lookupLocalTestPersona({ alias: 'membro' }, state);
  const byEmail = lookupLocalTestPersona({ email: `responsavel.${PROJECT}@runtime.test` }, state);
  const bySub = lookupLocalTestPersona({ sub: `local-test:${PROJECT}:membro` }, state);
  assert.equal(byAlias?.cmUserId, 'cm-membro');
  assert.equal(byEmail?.sub, `local-test:${PROJECT}:responsavel`);
  assert.equal(bySub?.email, `membro.${PROJECT}@runtime.test`);
  assert.equal(lookupLocalTestPersona({ email: byAlias!.email, sub: 'other-sub' }, state), null);
  assert.equal(lookupLocalTestPersona({}, state), null);
  assertLocalTestProxyTarget('http://127.0.0.1:8180/', state);
  assert.throws(() => assertLocalTestProxyTarget('http://127.0.0.1:8181', state), /refused/u);
  assert.throws(() => assertLocalTestProxyTarget('http://10.0.0.8:8180', state), /refused/u);
});

test('missing file, relative path, bad mode, project and origin fail closed without secrets', () => {
  assert.throws(
    () => loadLocalTestConfig({ LOCAL_TEST_SESSION_ENABLED: 'true' }, deps('{}')),
    (error: LocalTestConfigError) => error.message.includes('absolute') && !error.message.includes(KEY),
  );

  const relative = deps(JSON.stringify(manifest()));
  assert.throws(() => loadLocalTestConfig(enabledEnv('local-tests/102047.json'), relative), /absolute/u);
  assert.equal(relative.reads, 0);

  const missing = deps(JSON.stringify(manifest()), { declared: true, mode: 'development' });
  missing.fileMode = () => {
    throw new Error('ENOENT secret-body');
  };
  assert.throws(
    () => loadLocalTestConfig(enabledEnv(), missing),
    (error: LocalTestConfigError) => !error.message.includes('secret-body') && !error.message.includes(KEY),
  );
  assert.equal(missing.reads, 0);

  for (const mode of [
    { declared: true, mode: 'production' },
    { declared: true, mode: 'homologation' },
    { declared: false, mode: 'presentation' },
  ]) {
    const sources = deps(JSON.stringify(manifest()), mode);
    assert.throws(() => loadLocalTestConfig(enabledEnv(), sources), /declared development or presentation/u);
    assert.equal(sources.reads, 0);
  }

  const cases: Record<string, unknown>[] = [
    { projectId: '102099' },
    { scope: 'remote' },
    { schema: 2 },
    { cmTarget: 'http://example.com:8180' },
    { storagePrefix: 'prod_' },
    { cookieKey: 'short' },
    { allowedOrigins: ['http://localhost:80'] },
    { allowedOrigins: [`http://localhost:${PORT}/app`] },
    { allowedOrigins: [`http://user:pw@localhost:${PORT}`] },
    { allowedOrigins: ['http://*.localhost:2047'] },
    { allowedOrigins: [`https://localhost:${PORT}`] },
    { personas: { ...manifest().personas as object, extra: {} } },
  ];
  for (const override of cases) {
    assert.throws(
      () => loadLocalTestConfig(enabledEnv(), deps(JSON.stringify(manifest(override)))),
      (error: LocalTestConfigError) => !error.message.includes(KEY) && !error.message.includes('user:pw'),
    );
  }

  const shared = manifest();
  const personas = shared.personas as { membro: { sub: string } };
  personas.membro.sub = `local-test:${PROJECT}:responsavel`;
  assert.throws(() => loadLocalTestConfig(enabledEnv(), deps(JSON.stringify(shared))), /invalid|match/u);
});

test('presentation is accepted only when declared, and the cache ignores a later file edit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rt86-s1-'));
  const file = join(dir, '102047.json');
  writeFileSync(file, JSON.stringify(manifest()));
  chmodSync(file, 0o600);
  const sources = deps('', { declared: true, mode: 'presentation' });
  delete sources.readText;
  delete sources.fileMode;
  const env = enabledEnv(file);
  const first = loadLocalTestConfig(env, sources);
  assert.equal(first.enabled, true);

  resetLocalTestConfigCache();
  const cached = deps('', { declared: true, mode: 'presentation' });
  delete cached.readText;
  delete cached.fileMode;
  assert.equal(getLocalTestConfig(env, cached).enabled, true);
  writeFileSync(file, '{');
  chmodSync(file, 0o600);
  assert.equal(getLocalTestConfig(env, cached).enabled, true);
  resetLocalTestConfigCache();
  assert.throws(() => getLocalTestConfig(env, cached), LocalTestConfigError);
  resetLocalTestConfigCache();
});
