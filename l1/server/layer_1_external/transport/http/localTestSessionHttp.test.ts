/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/localTestSessionHttp.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import Fastify from 'fastify';
import { resetLocalTestConfigCache } from '/_102034_/l1/server/layer_1_external/config/localTestConfig.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { registerLocalTestSessionRoutes } from '/_102034_/l1/server/layer_1_external/transport/http/localTestSessionHttp.js';

const PROJECT = '109985';
const PORT = 9985;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://${HOST}`;
const KEY = '0123456789abcdef0123456789abcdef';

const ENV_KEYS = ['LOCAL_TEST_SESSION_ENABLED', 'LOCAL_TEST_SESSIONS_FILE'] as const;

function persona(alias: 'responsavel' | 'membro') {
  return {
    email: `${alias}.${PROJECT}@runtime.test`,
    name: alias,
    sub: `local-test:${PROJECT}:${alias}`,
    personMdmId: `mdm-${alias}`,
    cmUserId: `cm-${alias}`,
  };
}

function manifest() {
  return {
    schema: 1,
    scope: 'lima',
    projectId: PROJECT,
    organizationKey: 'org-bench',
    companyMdmId: 'company-bench',
    cmTarget: 'http://127.0.0.1:8180',
    cmOrgId: `runtime-test:${PROJECT}`,
    storagePrefix: 'desenv_',
    allowedOrigins: [ORIGIN, `http://localhost:${PORT}`],
    cookieKey: KEY,
    personas: { responsavel: persona('responsavel'), membro: persona('membro') },
  };
}

function installBench(root: string, mode: 'development' | 'production'): string {
  mkdirSync(join(root, `mls-${PROJECT}`, 'l5'), { recursive: true });
  writeFileSync(join(root, `mls-${PROJECT}`, 'l5', 'project.json'), JSON.stringify({ appEnv: mode }));
  writeFileSync(join(root, 'config.json'), JSON.stringify({
    defaultProjectId: PROJECT,
    projects: {
      [PROJECT]: { root: './client', type: 'client', modules: [] },
      '102029': { root: './fe', type: 'master frontend' },
      '102034': { root: './be', type: 'master backend' },
    },
  }));
  const file = join(root, 'bench.json');
  writeFileSync(file, JSON.stringify(manifest()));
  chmodSync(file, 0o600);
  return file;
}

async function app() {
  const server = Fastify({ logger: false });
  registerLocalTestSessionRoutes(server);
  return server;
}

test('selector routes hide themselves and refuse a mutation that is not same-origin', async () => {
  const savedCwd = process.cwd();
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  const root = mkdtempSync(join(tmpdir(), 'rt86-http-'));
  const server = await app();
  try {
    process.chdir(root);
    resetProjectsConfigCache();
    const file = installBench(root, 'development');
    delete process.env.LOCAL_TEST_SESSION_ENABLED;
    process.env.LOCAL_TEST_SESSIONS_FILE = file;
    resetLocalTestConfigCache();

    const hidden = await server.inject({ method: 'GET', url: '/__test/session', headers: { host: HOST } });
    assert.equal(hidden.statusCode, 404);

    process.env.LOCAL_TEST_SESSION_ENABLED = 'true';
    resetLocalTestConfigCache();
    const page = await server.inject({ method: 'GET', url: '/__test/session', headers: { host: HOST } });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /Local test session/);
    assert.match(page.body, /Close other tabs of this origin before switching/);

    const remote = await server.inject({
      method: 'GET',
      url: '/__test/session',
      headers: { host: 'app.example:443' },
    });
    assert.equal(remote.statusCode, 404);

    const noOrigin = await server.inject({
      method: 'POST',
      url: '/__test/session',
      headers: { host: HOST, 'content-type': 'application/json' },
      payload: { persona: 'responsavel' },
    });
    assert.equal(noOrigin.statusCode, 403);

    const otherOrigin = await server.inject({
      method: 'POST',
      url: '/__test/session',
      headers: { host: HOST, origin: 'http://127.0.0.1:1', 'content-type': 'application/json' },
      payload: { persona: 'responsavel' },
    });
    assert.equal(otherOrigin.statusCode, 403);

    const forged = await server.inject({
      method: 'POST',
      url: '/__test/session',
      headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json', email: 'other@runtime.test' },
      payload: { persona: 'responsavel' },
    });
    assert.equal(forged.statusCode, 400);

    const query = await server.inject({
      method: 'POST',
      url: '/__test/session?persona=membro',
      headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json' },
      payload: { persona: 'responsavel' },
    });
    assert.equal(query.statusCode, 400);

    const selected = await server.inject({
      method: 'POST',
      url: '/__test/session',
      headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json' },
      payload: { persona: 'responsavel' },
    });
    assert.equal(selected.statusCode, 204);
    const setCookie = String(selected.headers['set-cookie']);
    assert.match(setCookie, new RegExp(`^collab_local_test_${PROJECT}=`));
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Path=\//);
    assert.match(setCookie, /Max-Age=28800/);
    assert.doesNotMatch(setCookie, /Domain=/);
    assert.doesNotMatch(setCookie, /Secure/);
    assert.doesNotMatch(setCookie, new RegExp(KEY));

    const cleared = await server.inject({
      method: 'POST',
      url: '/__test/session',
      headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json' },
      payload: { persona: null },
    });
    assert.match(String(cleared.headers['set-cookie']), /Max-Age=0/);

    const productionProject = '109984';
    const productionPort = 9984;
    const productionHost = `127.0.0.1:${productionPort}`;
    mkdirSync(join(root, `mls-${productionProject}`, 'l5'), { recursive: true });
    writeFileSync(join(root, `mls-${productionProject}`, 'l5', 'project.json'), JSON.stringify({ appEnv: 'production' }));
    writeFileSync(join(root, 'config.json'), JSON.stringify({
      defaultProjectId: productionProject,
      projects: {
        [productionProject]: { root: './client', type: 'client', modules: [] },
        '102029': { root: './fe', type: 'master frontend' },
        '102034': { root: './be', type: 'master backend' },
      },
    }));
    const productionManifest = manifest();
    productionManifest.projectId = productionProject;
    productionManifest.cmOrgId = `runtime-test:${productionProject}`;
    productionManifest.allowedOrigins = [`http://${productionHost}`, `http://localhost:${productionPort}`];
    productionManifest.personas = {
      responsavel: { ...persona('responsavel'), email: `responsavel.${productionProject}@runtime.test`, sub: `local-test:${productionProject}:responsavel` },
      membro: { ...persona('membro'), email: `membro.${productionProject}@runtime.test`, sub: `local-test:${productionProject}:membro` },
    };
    writeFileSync(file, JSON.stringify(productionManifest));
    chmodSync(file, 0o600);
    resetProjectsConfigCache();
    resetLocalTestConfigCache();
    const production = await server.inject({
      method: 'GET',
      url: '/__test/session',
      headers: { host: productionHost },
    });
    assert.equal(production.statusCode, 404);
  } finally {
    await server.close();
    process.chdir(savedCwd);
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetProjectsConfigCache();
    resetLocalTestConfigCache();
    rmSync(root, { recursive: true, force: true });
  }
});

test('the selector clears only the cm cache and does not post when that clear fails', async () => {
  const savedCwd = process.cwd();
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  const root = mkdtempSync(join(tmpdir(), 'rt86-selector-'));
  const server = await app();
  try {
    process.chdir(root);
    resetProjectsConfigCache();
    process.env.LOCAL_TEST_SESSION_ENABLED = 'true';
    process.env.LOCAL_TEST_SESSIONS_FILE = installBench(root, 'development');
    resetLocalTestConfigCache();
    const page = await server.inject({ method: 'GET', url: '/__test/session', headers: { host: HOST } });
    const source = page.body.match(/<script>([\s\S]*)<\/script>/u)?.[1];
    assert.ok(source);

    async function run(kind: 'ok' | 'blocked' | 'error') {
      const posts: string[] = [];
      const removed: string[] = [];
      const storage = new Map<string, string>([
        ['serviceCollabMessages', 'stale'],
        ['collabMessages_userId', 'stale'],
        ['unrelated', 'keep'],
      ]);
      const assigned: string[] = [];
      const elements = new Map<string, { textContent: string; click?: () => Promise<void> }>();
      const document = {
        getElementById(id: string) {
          let element = elements.get(id);
          if (!element) {
            element = { textContent: '' };
            elements.set(id, element);
          }
          return {
            set textContent(value: string) { element!.textContent = value; },
            get textContent() { return element!.textContent; },
            addEventListener(_type: string, fn: () => Promise<void>) { element!.click = fn; },
          };
        },
      };
      const indexedDB = {
        deleteDatabase(name: string) {
          assert.equal(name, 'msgDB');
          const request: { onblocked?: () => void; onerror?: () => void; onsuccess?: () => void } = {};
          queueMicrotask(() => {
            if (kind === 'blocked') request.onblocked?.();
            else if (kind === 'error') request.onerror?.();
            else request.onsuccess?.();
          });
          return request;
        },
      };
      const localStorage = {
        removeItem(name: string) {
          removed.push(name);
          storage.delete(name);
        },
      };
      const context = vm.createContext({
        document,
        indexedDB,
        localStorage,
        fetch: async (_url: string, init: { body: string }) => {
          posts.push(init.body);
          return { ok: true };
        },
        location: { assign(url: string) { assigned.push(url); } },
        JSON,
        Promise,
        setTimeout,
        clearTimeout,
        Error,
      });
      vm.runInContext(source!, context);
      await elements.get(kind === 'ok' ? 'pick-membro' : 'pick-responsavel')?.click?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { posts, removed, storage, assigned, error: elements.get('error')?.textContent ?? '' };
    }

    const blocked = await run('blocked');
    assert.deepEqual(blocked.posts, []);
    assert.deepEqual(blocked.removed, []);
    assert.equal(blocked.assigned.length, 0);
    assert.match(blocked.error, /Close the other tabs/);

    const failed = await run('error');
    assert.deepEqual(failed.posts, []);
    assert.match(failed.error, /session was not changed/);

    const ok = await run('ok');
    assert.deepEqual(ok.removed, ['serviceCollabMessages', 'collabMessages_userId']);
    assert.equal(ok.storage.get('unrelated'), 'keep');
    assert.deepEqual(ok.posts, [JSON.stringify({ persona: 'membro' })]);
    assert.deepEqual(ok.assigned, ['/']);
  } finally {
    await server.close();
    process.chdir(savedCwd);
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetProjectsConfigCache();
    resetLocalTestConfigCache();
    rmSync(root, { recursive: true, force: true });
  }
});
