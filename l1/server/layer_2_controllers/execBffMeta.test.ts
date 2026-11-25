/// <mls fileReference="_102034_/l1/server/layer_2_controllers/execBffMeta.test.ts" enhancement="_blank" />
import { callerModuleOf } from '/_102034_/l1/server/layer_1_external/connections/callerModule.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleHttpRequest } from '/_102034_/l1/server/layer_1_external/transport/http/startServer.js';
import { execMessage } from '/_102034_/l1/server/layer_1_external/transport/message/execMessage.js';
import { createRequestContext, normalizeRequest } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { resetAlphaAuthoritiesCache } from '/_102034_/l1/server/layer_1_external/config/alphaAuthorities.js';
import { resetModuleRouterCache } from '/_102034_/l1/server/layer_2_controllers/moduleRegistry.js';
import { resetSharedBffExecutionSeriesStore } from '/_102034_/l1/monitor/layer_1_external/cache/BffExecutionSeriesStore.js';
import { createConnectionServer } from '/_102034_/l1/workflow/connectionServe.js';
import cmCatalog from '/_102034_/l2/shared/contracts/connections/cm.js';
import type { BffRequest, RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

/**
 * What a server-side caller says in `meta` must reach the route through the REAL entry, and the same words over http must not.
 * A route of a module is loaded the way the runtime loads it (a controllers folder in a temporary project), and it hands back
 * what it received.
 */
const CLIENT_ID = '990677';
const ENV_KEYS = ['APP_ENV', 'RUNTIME_MODE', 'WRITE_BEHIND_ENABLED', 'BFF_JWT_ENABLED', 'BFF_ACTORS_ENFORCED', 'ACTIVE_COMPANY_ID', 'ACTIVE_UNIT_ID', 'CURRENT_WORKSPACE_ID', 'WORKSPACE_ID', 'ACTOR_ID', 'ACTOR_SCOPE', 'REDIS_URL', 'PROJECT_ID', 'PROJECT_DOMAIN', 'COLLAB_PROJECT_ID', 'STUDIO_ENABLED'] as const;

type Seen = { ok?: boolean; data?: { requestMeta?: Record<string, unknown>; sessionContext?: Record<string, unknown> } };

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

test.before(() => {
  savedCwd = process.cwd();
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  tempRoot = mkdtempSync(join(tmpdir(), 'rt242-meta-'));
  const controllers = join(tempRoot, 'dist', 'local', `_${CLIENT_ID}_`, 'l1', 'controllers');
  mkdirSync(controllers, { recursive: true });
  writeFileSync(join(tempRoot, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(tempRoot, 'config.json'), JSON.stringify({
    defaultProjectId: CLIENT_ID,
    alphaAllAuthorities: false,
    shellTemplates: { spa: './spa.html', pwa: './pwa.html' },
    projects: {
      [CLIENT_ID]: { root: './client', type: 'client', modules: [{ moduleId: 'rt242', basePath: '/rt242', shellMode: 'spa', backendControllers: `./_${CLIENT_ID}_/l1/controllers` }] },
      '990671': { root: './master-fe', type: 'master frontend' },
      '990672': { root: './master-be', type: 'master backend' },
    },
  }));
  writeFileSync(join(controllers, 'observe.js'), [
    'export const routes = [{',
    "  key: 'rt242.observe',",
    '  handler: async ({ ctx }) => ({ ok: true, data: { requestMeta: ctx.requestMeta, sessionContext: ctx.sessionContext }, error: null }),',
    '}];',
    '',
  ].join('\n'));
  // rt315: a route that reports which module the platform says is running (read through the same module the connector reads).
  writeFileSync(join(controllers, 'whoRuns.js'), [
    'export const routes = [{',
    "  key: 'rt242.whoRuns',",
    '  handler: async () => ({ ok: true, data: { callerModule: globalThis.__rt315CallerModuleOf() ?? null }, error: null }),',
    '}];',
    '',
  ].join('\n'));
  (globalThis as { __rt315CallerModuleOf?: () => string | undefined }).__rt315CallerModuleOf = callerModuleOf;
  process.chdir(tempRoot);
  process.env.APP_ENV = 'development';
  process.env.RUNTIME_MODE = 'memory';
  process.env.WRITE_BEHIND_ENABLED = 'false';
  for (const key of ENV_KEYS) {
    if (key === 'APP_ENV' || key === 'RUNTIME_MODE' || key === 'WRITE_BEHIND_ENABLED') continue;
    delete process.env[key];
  }
  resetPublicCaches();
  ctx = createRequestContext();
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

const CONNECTION = { connectionId: 'cm', operationId: 'describe', context: { organizationId: 'org-1', agentId: 'agent-1' }, idempotencyKey: 'k-1' };
const SAID = { requestId: 'r-1', userId: 'someone', via: 'nora', connection: CONNECTION } as const;
const AGENT_SAID = { requestId: 'r-2', userId: 'agent-1', actorType: 'agent', agentMdmId: 'member-1', agentName: 'Ana Robo' } as const;

async function viaMessage(meta: Record<string, unknown>): Promise<Seen> {
  const answer = await execMessage({ routine: 'rt242.observe', params: {}, meta: meta as BffRequest['meta'] }, ctx);
  assert.equal(answer.statusCode, 200, JSON.stringify(answer.response));
  return answer.response as Seen;
}

async function viaHttp(meta: Record<string, unknown>): Promise<Seen> {
  const answer = await handleHttpRequest('POST', '/execBff', { routine: 'rt242.observe', params: {}, meta }, ctx, {});
  assert.equal(answer.statusCode, 200, JSON.stringify(answer.body));
  return answer.body as Seen;
}

test('a message call reaches the route with the connection and the way it was said (via)', async () => {
  const seen = await viaMessage(SAID);
  assert.deepEqual(seen.data?.requestMeta?.connection, CONNECTION);
  assert.equal(seen.data?.sessionContext?.via, 'nora');
});

test('a message call of an agent reaches the route with the agent type and its member as the person of the session', async () => {
  const seen = await viaMessage(AGENT_SAID);
  assert.equal(seen.data?.requestMeta?.actorType, 'agent');
  assert.equal(seen.data?.requestMeta?.userId, 'agent-1');
  assert.deepEqual(seen.data?.sessionContext?.person, { mdmId: 'member-1', email: '', name: 'Ana Robo' });
});

test('the same words over http reach nothing: no connection, no via, no agent type, no member', async () => {
  const seen = await viaHttp({ ...SAID, ...AGENT_SAID, source: 'message' });
  assert.equal(seen.data?.requestMeta?.source, 'http');
  assert.equal('connection' in (seen.data?.requestMeta ?? {}), false);
  assert.equal('actorType' in (seen.data?.requestMeta ?? {}), false);
  assert.equal(seen.data?.sessionContext?.via, undefined);
  assert.equal(seen.data?.sessionContext?.person, undefined);
});

test('a message call that says nothing of the kind carries none of it', async () => {
  const seen = await viaMessage({ requestId: 'r-3' });
  assert.equal('connection' in (seen.data?.requestMeta ?? {}), false);
  assert.equal('actorType' in (seen.data?.requestMeta ?? {}), false);
  assert.equal(seen.data?.sessionContext?.via, undefined);
  assert.equal(seen.data?.sessionContext?.person, undefined);
});

test('connectionServe through the real entry: the route marked `serves` reads who called and about whom in requestMeta.connection', async () => {
  const serve = createConnectionServer({
    catalogOf: async (id) => (id === 'cm' ? cmCatalog : undefined),
    index: async () => ({ byOperation: new Map([['cm.describe', [{ moduleId: 'rt242', route: 'rt242.observe' }]]]), issues: [] }),
    execMessage: (request, callerCtx) => execMessage(request, callerCtx),
    newContext: () => ctx,
    log: () => undefined,
  });
  const answer = await serve({ connectionId: 'cm', operationId: 'describe', input: { agentId: 'agent-1' }, context: { organizationId: 'org-1', agentId: 'agent-1', requestedBy: 'cm-9' }, idempotencyKey: 'k-serve' });
  assert.equal(answer.ok, true);
  const seen = (answer as { output: { requestMeta: { userId?: string; connection?: { connectionId: string; operationId: string; context: Record<string, unknown>; idempotencyKey?: string } } } }).output;
  assert.equal(seen.requestMeta.connection?.connectionId, 'cm');
  assert.equal(seen.requestMeta.connection?.operationId, 'describe');
  assert.equal(seen.requestMeta.connection?.context.agentId, 'agent-1');
  assert.equal(seen.requestMeta.connection?.context.requestedBy, 'cm-9');
  assert.equal(seen.requestMeta.connection?.idempotencyKey, 'k-serve');
  assert.equal(seen.requestMeta.userId, 'connection:cm');
});

/**
 * The class: every key of the `meta` of a request is either copied by `normalizeRequest` or listed here as left out on purpose, with
 * the reason. The record type makes a new key fail the compile until it is put in one of the two; the test checks the claim.
 */
type MetaKey = keyof NonNullable<BffRequest['meta']>;
const COPIED: Record<MetaKey, 'copied' | { leftOut: string }> = {
  requestId: 'copied',
  userId: 'copied',
  authToken: 'copied',
  verifiedUserId: 'copied',
  verifiedEmail: 'copied',
  verifiedAuthorities: 'copied',
  traceId: 'copied',
  source: 'copied',
  via: 'copied',
  actorType: 'copied',
  agentMdmId: 'copied',
  agentName: 'copied',
  connection: 'copied',
  actorId: 'copied',
  actorScope: 'copied',
  activeCompanyId: 'copied',
  activeUnitId: 'copied',
  workspaceId: 'copied',
  telemetry: { leftOut: 'the monitor reads it from the raw request, validated event by event, after the routine ran' },
};

test('every key of the meta of a request is copied by normalizeRequest or left out on purpose, with the reason', () => {
  const sample: Record<MetaKey, unknown> = {
    requestId: 'r', userId: 'u', authToken: 't', verifiedUserId: 'vu', verifiedEmail: 've@example.test', verifiedAuthorities: ['m:a'], traceId: 'tr',
    source: 'message', via: 'nora', actorType: 'agent', agentMdmId: 'm1', agentName: 'n', connection: CONNECTION, actorId: 'a', actorScope: ['m:a'],
    activeCompanyId: 'c', activeUnitId: 'un', workspaceId: 'w', telemetry: [],
  };
  const normalized = normalizeRequest({ routine: 'm.p.c', params: {}, meta: sample as BffRequest['meta'] }).meta as Record<string, unknown>;
  for (const key of Object.keys(COPIED) as MetaKey[]) {
    const verdict = COPIED[key];
    if (verdict === 'copied') assert.deepEqual(normalized[key], sample[key], `${key} is lost by normalizeRequest`);
    else {
      assert.ok(verdict.leftOut.length > 0, `${key} needs a reason`);
      assert.equal(normalized[key], undefined, `${key} is listed as left out but is copied`);
    }
  }
});

test('while a route of a module runs, the platform knows which module it is (the stamp of the calls it makes); after it, none', async () => {
  const answer = await execMessage({ routine: 'rt242.whoRuns', params: {}, meta: { requestId: 'r-4' } as BffRequest['meta'] }, ctx);
  assert.equal(answer.statusCode, 200, JSON.stringify(answer.response));
  assert.equal((answer.response as { data?: { callerModule?: string } }).data?.callerModule, 'rt242');
  assert.equal(callerModuleOf(), undefined);
});
