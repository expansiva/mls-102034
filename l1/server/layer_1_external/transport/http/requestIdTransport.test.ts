/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/requestIdTransport.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleHttpRequest } from '/_102034_/l1/server/layer_1_external/transport/http/startServer.js';
import { createRequestContext, execBff } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { resetAlphaAuthoritiesCache } from '/_102034_/l1/server/layer_1_external/config/alphaAuthorities.js';
import { resetModuleRouterCache } from '/_102034_/l1/server/layer_2_controllers/moduleRegistry.js';
import { resetSharedBffExecutionSeriesStore } from '/_102034_/l1/monitor/layer_1_external/cache/BffExecutionSeriesStore.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

const CLIENT_ID = '990675';
const KEY_A = 'Rt75.submit/chave-01';
const KEY_B = 'rt75-nova-submissao';
const SERVER_ACTOR = 'server-actor-rt75';
const SERVER_SCOPE = ['rt75:observer'];
const SERVER_COMPANY = 'company-rt75';
const ENV_KEYS = [
  'APP_ENV',
  'RUNTIME_MODE',
  'WRITE_BEHIND_ENABLED',
  'BFF_JWT_ENABLED',
  'BFF_ACTORS_ENFORCED',
  'ACTIVE_COMPANY_ID',
  'ACTIVE_UNIT_ID',
  'CURRENT_WORKSPACE_ID',
  'WORKSPACE_ID',
  'ACTOR_ID',
  'ACTOR_SCOPE',
  'REDIS_URL',
  'PROJECT_ID',
  'PROJECT_DOMAIN',
  'COLLAB_PROJECT_ID',
  'STUDIO_ENABLED',
] as const;

type Seen = {
  ok?: boolean;
  data?: {
    requestMeta?: { requestId?: string; source?: string; userId?: string };
    sessionContext?: {
      actorId?: string;
      actorScope?: string[];
      activeCompanyId?: string;
      actorSession?: { actorId?: string; scope?: string[] };
      businessContext?: { activeCompanyId?: string };
    };
  };
  error?: { code?: string; message?: string } | null;
};

let savedCwd = '';
let savedEnv: Record<string, string | undefined> = {};
let tempRoot = '';
let ctx: RequestContext;

function resetPublicCaches(): void {
  resetProjectsConfigCache();
  resetModuleRouterCache();
  resetAlphaAuthoritiesCache();
  resetSharedBffExecutionSeriesStore();
}

function writeFixture(root: string): void {
  const controllers = join(root, 'dist', 'local', `_${CLIENT_ID}_`, 'l1', 'controllers');
  mkdirSync(controllers, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(root, 'config.json'), JSON.stringify({
    defaultProjectId: CLIENT_ID,
    alphaAllAuthorities: false,
    shellTemplates: { spa: './spa.html', pwa: './pwa.html' },
    projects: {
      [CLIENT_ID]: {
        root: './client',
        type: 'client',
        modules: [{
          moduleId: 'rt75',
          basePath: '/rt75',
          shellMode: 'spa',
          backendControllers: `./_${CLIENT_ID}_/l1/controllers`,
        }],
      },
      '990671': { root: './master-fe', type: 'master frontend' },
      '990672': { root: './master-be', type: 'master backend' },
    },
  }));
  writeFileSync(join(controllers, 'observe.js'), [
    'export const routes = [{',
    "  key: 'rt75.observe',",
    '  handler: async ({ ctx }) => ({',
    '    ok: true,',
    '    data: { requestMeta: ctx.requestMeta, sessionContext: ctx.sessionContext },',
    '    error: null,',
    '  }),',
    '}];',
    '',
  ].join('\n'));
}

test.before(() => {
  savedCwd = process.cwd();
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  tempRoot = mkdtempSync(join(tmpdir(), 'rt75-transport-'));
  writeFixture(tempRoot);
  process.chdir(tempRoot);
  process.env.APP_ENV = 'development';
  process.env.RUNTIME_MODE = 'memory';
  process.env.WRITE_BEHIND_ENABLED = 'false';
  for (const key of ENV_KEYS) {
    if (key === 'APP_ENV' || key === 'RUNTIME_MODE' || key === 'WRITE_BEHIND_ENABLED') continue;
    delete process.env[key];
  }
  resetPublicCaches();
  ctx = createRequestContext(undefined, {
    sessionContext: {
      actorId: SERVER_ACTOR,
      actorScope: SERVER_SCOPE,
      activeCompanyId: SERVER_COMPANY,
    },
  });
});

test.after(() => {
  try {
    if (savedCwd) process.chdir(savedCwd);
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    resetPublicCaches();
  } finally {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  }
});

function assertServerSession(seen: Seen): void {
  const session = seen.data?.sessionContext;
  assert.equal(session?.actorId, SERVER_ACTOR);
  assert.deepEqual(session?.actorScope, SERVER_SCOPE);
  assert.equal(session?.activeCompanyId, SERVER_COMPANY);
  assert.equal(session?.actorSession?.actorId, SERVER_ACTOR);
  assert.deepEqual(session?.actorSession?.scope, SERVER_SCOPE);
  assert.equal(session?.businessContext?.activeCompanyId, SERVER_COMPANY);
  assert.notEqual(session?.actorId, 'forged-actor');
  assert.notEqual(session?.activeCompanyId, 'forged-company');
}

async function viaHttp(requestId?: string): Promise<Seen> {
  const meta: Record<string, unknown> = {
    source: 'message',
    actorId: 'forged-actor',
    actorScope: ['rt75:forged'],
    activeCompanyId: 'forged-company',
    userId: 'forged-user',
  };
  if (requestId !== undefined) meta.requestId = requestId;
  const result = await handleHttpRequest('POST', '/execBff', {
    routine: 'rt75.observe',
    params: {},
    meta,
  }, ctx, {});
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  return result.body as Seen;
}

async function viaDirect(requestId?: string): Promise<Seen> {
  const meta: Record<string, unknown> = {};
  if (requestId !== undefined) meta.requestId = requestId;
  const result = await execBff({
    routine: 'rt75.observe',
    params: {},
    meta,
  }, ctx);
  assert.equal(result.statusCode, 200, JSON.stringify(result.response));
  return result.response as Seen;
}

function requestIdOf(seen: Seen): string {
  const requestId = seen.data?.requestMeta?.requestId;
  assert.equal(typeof requestId, 'string');
  assert.notEqual(requestId, '');
  return requestId as string;
}

test('requestId chega intacto ao handlerCtx no HTTP e no execBff direto', async () => {
  const httpA1 = await viaHttp(KEY_A);
  const httpA2 = await viaHttp(KEY_A);
  const httpB = await viaHttp(KEY_B);
  const httpOmit1 = await viaHttp();
  const httpOmit2 = await viaHttp();

  assert.equal(httpA1.ok, true);
  assert.equal(requestIdOf(httpA1), KEY_A);
  assert.equal(requestIdOf(httpA2), KEY_A);
  assert.equal(requestIdOf(httpB), KEY_B);
  assert.equal(httpA1.data?.requestMeta?.source, 'http');
  assert.equal(httpOmit1.data?.requestMeta?.source, 'http');
  assertServerSession(httpA1);
  assertServerSession(httpOmit1);
  const omitHttp1 = requestIdOf(httpOmit1);
  const omitHttp2 = requestIdOf(httpOmit2);
  assert.notEqual(omitHttp1, omitHttp2);
  assert.notEqual(omitHttp1, KEY_A);
  assert.notEqual(omitHttp2, KEY_B);

  const directA1 = await viaDirect(KEY_A);
  const directA2 = await viaDirect(KEY_A);
  const directB = await viaDirect(KEY_B);
  const directOmit1 = await viaDirect();
  const directOmit2 = await viaDirect();

  assert.equal(requestIdOf(directA1), KEY_A);
  assert.equal(requestIdOf(directA2), KEY_A);
  assert.equal(requestIdOf(directB), KEY_B);
  const omitDirect1 = requestIdOf(directOmit1);
  const omitDirect2 = requestIdOf(directOmit2);
  assert.notEqual(omitDirect1, omitDirect2);
  assert.notEqual(omitDirect1, KEY_A);
});
