/// <mls fileReference="_102034_/l1/server/layer_1_external/config/alphaBenchMode.test.ts" enhancement="_blank" />
// The lima bench mode without the alpha (`noAlpha` in the bench manifest): alpha off and the screen's refusal on,
// only where the bench is switched on and its mode is declared.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { isAlphaAllAuthorities, resetAlphaAuthoritiesCache } from '/_102034_/l1/server/layer_1_external/config/alphaAuthorities.js';
import {
  isLocalTestNoAlpha,
  LocalTestConfigError,
  resetLocalTestConfigCache,
} from '/_102034_/l1/server/layer_1_external/config/localTestConfig.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { isActorEnforcementOn } from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';
import { execBff } from '/_102034_/l1/server/layer_2_controllers/execBff.js';

const PROJECT = '109984';
const PORT = 9984;
const KEY = '0123456789abcdef0123456789abcdef';
const ENV_KEYS = ['LOCAL_TEST_SESSION_ENABLED', 'LOCAL_TEST_SESSIONS_FILE', 'BFF_ACTORS_ENFORCED'] as const;

function persona(alias: string) {
  return {
    email: `${alias}.${PROJECT}@runtime.test`,
    name: alias,
    sub: `local-test:${PROJECT}:${alias}`,
    personMdmId: `mdm-${alias}`,
    cmUserId: `cm-${alias}`,
  };
}

function manifest(extra: Record<string, unknown>) {
  return {
    schema: 1,
    scope: 'lima',
    projectId: PROJECT,
    organizationKey: 'org-bench',
    companyMdmId: 'company-bench',
    cmTarget: 'http://127.0.0.1:8180',
    cmOrgId: `runtime-test:${PROJECT}`,
    storagePrefix: 'desenv_',
    allowedOrigins: [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`],
    cookieKey: KEY,
    personas: { responsavel: persona('responsavel'), membro: persona('membro') },
    ...extra,
  };
}

/** A workspace with a declared test mode and a private bench manifest; `flag` says whether the bench is switched on. */
async function withBench(extra: Record<string, unknown>, flag: boolean, run: () => Promise<void> | void): Promise<void> {
  const savedCwd = process.cwd();
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  const root = mkdtempSync(join(tmpdir(), 'rt227-'));
  try {
    mkdirSync(join(root, `mls-${PROJECT}`, 'l5'), { recursive: true });
    writeFileSync(join(root, `mls-${PROJECT}`, 'l5', 'project.json'), JSON.stringify({ appEnv: 'development' }));
    writeFileSync(join(root, 'config.json'), JSON.stringify({
      defaultProjectId: PROJECT,
      projects: {
        [PROJECT]: {
          root: './client',
          type: 'client',
          // A module with a controllers path: the screen refuses before the controllers are ever loaded.
          modules: [{ moduleId: 'modx', basePath: '/', shellMode: 'spa', backendControllers: '_109984_/l1/modx/layer_2_controllers' }],
        },
        '102029': { root: './fe', type: 'master frontend' },
        '102034': { root: './be', type: 'master backend' },
      },
    }));
    const file = join(root, 'bench.json');
    writeFileSync(file, JSON.stringify(manifest(extra)));
    chmodSync(file, 0o600);
    process.chdir(root);
    process.env.LOCAL_TEST_SESSIONS_FILE = file;
    delete process.env.BFF_ACTORS_ENFORCED;
    if (flag) process.env.LOCAL_TEST_SESSION_ENABLED = 'true';
    else delete process.env.LOCAL_TEST_SESSION_ENABLED;
    resetProjectsConfigCache();
    resetLocalTestConfigCache();
    resetAlphaAuthoritiesCache();
    await run();
  } finally {
    process.chdir(savedCwd);
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetProjectsConfigCache();
    resetLocalTestConfigCache();
    resetAlphaAuthoritiesCache();
    rmSync(root, { recursive: true, force: true });
  }
}

const ALPHA_ON = () => ({ alphaAllAuthorities: true });

function silenced<T>(work: () => T): { value: T; warns: string[] } {
  const warns: string[] = [];
  const original = console.warn;
  console.warn = (message?: unknown) => {
    warns.push(String(message));
  };
  try {
    return { value: work(), warns };
  } finally {
    console.warn = original;
  }
}

test('noAlpha: the alpha is off whatever the config says, the refusal is on, and the log says why', async () => {
  await withBench({ noAlpha: true }, true, () => {
    const { value, warns } = silenced(() => isAlphaAllAuthorities(undefined, ALPHA_ON));
    assert.equal(value, false);
    assert.deepEqual(warns, ['[alpha] OFF by local test manifest (noAlpha)']);
    assert.equal(isActorEnforcementOn(), true);
    assert.equal(isLocalTestNoAlpha(), true);
  });
});

test('noAlpha: a call with an empty scope is refused by the screen with FORBIDDEN_ACTOR', async () => {
  await withBench({ noAlpha: true }, true, async () => {
    const result = await execBff({
      routine: 'modx.tarefa.create',
      params: {},
      meta: { source: 'http', verifiedUserId: 'auth-sub', verifiedEmail: 'a@b.c' },
    });
    assert.equal(result.statusCode, 403);
    assert.equal(result.response.error?.code, 'FORBIDDEN_ACTOR');
  });
});

test('noAlpha absent or false: the alpha and the refusal are as before', async () => {
  for (const extra of [{}, { noAlpha: false }]) {
    await withBench(extra, true, () => {
      const { value, warns } = silenced(() => isAlphaAllAuthorities(undefined, ALPHA_ON));
      assert.equal(value, true);
      assert.equal(warns.length, 1);
      assert.match(warns[0], /^\[alpha\] alphaAllAuthorities ON/);
      assert.equal(isActorEnforcementOn(), false);
      assert.equal(isLocalTestNoAlpha(), false);
    });
  }
});

test('noAlpha that is not a boolean makes the manifest invalid, and nothing is decided in silence', async () => {
  for (const bad of ['true', 1, null, {}]) {
    await withBench({ noAlpha: bad }, true, () => {
      assert.throws(() => isLocalTestNoAlpha(), (error: unknown) => error instanceof LocalTestConfigError && error.message === 'local test session manifest is invalid');
      assert.throws(() => isActorEnforcementOn(), LocalTestConfigError);
      assert.throws(() => isAlphaAllAuthorities(undefined, ALPHA_ON), LocalTestConfigError);
    });
  }
});

test('with the bench switched off the manifest is ignored, even with noAlpha', async () => {
  await withBench({ noAlpha: true }, false, () => {
    assert.equal(isLocalTestNoAlpha(), false);
    assert.equal(silenced(() => isAlphaAllAuthorities(undefined, ALPHA_ON)).value, true);
    assert.equal(isActorEnforcementOn(), false);
  });
});

test('BFF_ACTORS_ENFORCED keeps turning the refusal on by itself', async () => {
  await withBench({}, true, () => {
    process.env.BFF_ACTORS_ENFORCED = 'true';
    assert.equal(isActorEnforcementOn(), true);
  });
});
