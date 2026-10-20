/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/workflowWake.test.ts" enhancement="_blank"/>
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { resetConfiguredModuleCompositionCache } from '/_102034_/l1/server/layer_2_controllers/moduleRegistry.js';
import { WORKFLOW_WAKE_BODY_LIMIT_BYTES, type WorkflowWakeInbox } from '/_102034_/l1/workflow/wakeContracts.js';
import { resetWorkflowWakeRegistryForTests } from '/_102034_/l1/workflow/wakeRegistry.js';
import type { ModuleWakeEvent } from '/_102036_/l2/shared/interfaces.js';
import { registerWorkflowWakeRoutes } from '/_102034_/l1/server/layer_1_external/transport/http/workflowWake.js';

const APP_ID = '910106';
const OTHER_APP = '910199';
const TOKEN_APP = 'sentinel-wake-app-rt106-s5';
const TOKEN_OTHER = 'sentinel-wake-other-rt106-s5';
const TOKEN_ENV = 'sentinel-wake-env-rt106-s5';
const SECRETS = [TOKEN_APP, TOKEN_OTHER, TOKEN_ENV, 'secret-note-rt106-s5'];

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: 'task-1:wait:1:1',
    scheduledAt: '2026-10-20T12:00:00.000Z',
    attempt: 1,
    ref: {
      project: APP_ID,
      module: 'modA',
      entity: 'order',
      recordId: 'rec-1',
      processId: 'procA',
      workflowVersion: null,
    },
    taskId: 'task-1',
    stepKey: 'wait',
    pass: 1,
    seq: 1,
    revision: 4,
    routine: 'onWait',
    source: 'message',
    secretNote: 'secret-note-rt106-s5',
    ...overrides,
  };
}

function projectFile(projectId: string, token: string): object {
  return {
    schema: 1,
    generatedAt: '2026-10-20T00:00:00.000Z',
    org: { orgId: 'org-rt106', slug: 'acme', name: 'Acme', createdAt: '2026-01-01T00:00:00.000Z' },
    project: {
      projectId,
      domain: null,
      appEnv: null,
      language: null,
      type: 'client',
      createdAt: '2026-02-01T00:00:00.000Z',
    },
    collabMessages: { token },
  };
}

function workspaceConfig(): string {
  return JSON.stringify({
    defaultProjectId: APP_ID,
    projects: {
      [APP_ID]: {
        type: 'client',
        role: 'client_project',
        modules: [{ moduleId: 'modA' }, { moduleId: 'modIdle' }],
        persistenceModules: [
          { moduleId: 'modA', tableDefsDir: `_${APP_ID}_/l1/modA/tables` },
        ],
      },
      [OTHER_APP]: {
        type: 'lib',
        modules: [{ moduleId: 'modA' }],
        persistenceModules: [{ moduleId: 'modA', tableDefsDir: `_${OTHER_APP}_/l1/modA/tables` }],
      },
      '102029': { type: 'master frontend', role: 'frontend_base', modules: [] },
      '102034': { type: 'master backend', role: 'server_core', modules: [] },
    },
  });
}

interface Harness {
  app: FastifyInstance;
  store: MemoryStore;
  constructions: () => number;
  calls: () => number;
  restore: () => Promise<void>;
}

class MemoryStore implements WorkflowWakeInbox {
  readonly seen: ModuleWakeEvent[] = [];
  gate: Promise<void> | null = null;
  failCommit = false;
  conflict = false;
  completed: ModuleWakeEvent | null = null;

  async enqueue(body: ModuleWakeEvent) {
    this.seen.push(body);
    if (this.gate) await this.gate;
    if (this.failCommit) {
      throw new AppError('WORKFLOW_WAKE_COMMIT_FAILED', 'commit failed', 503);
    }
    if (this.conflict) {
      throw new AppError('WORKFLOW_WAKE_IDENTITY_CONFLICT', 'different identity', 409);
    }
    if (this.completed && this.completed.eventId === body.eventId) {
      return { statusCode: 200 as const, receipt: { eventId: body.eventId, outcome: 'stale' as const } };
    }
    return { statusCode: 202 as const, receipt: { eventId: body.eventId, outcome: 'accepted' as const } };
  }

  async runNext(): Promise<'empty'> {
    throw new Error('runNext must not run on the HTTP route');
  }
}

async function harness(): Promise<Harness> {
  const previousCwd = process.cwd();
  const previousFiles = process.env.CBE_PROJECT_FILES_DIR;
  const previousEnvToken = process.env.MSG_PROXY_TOKEN;
  const workspace = mkdtempSync(join(tmpdir(), 'rt106-s5-'));
  const projects = join(workspace, 'projects');
  const files = join(workspace, 'project-files');
  const rootDir = join(projects, `mls-${APP_ID}/l1/modA/tables`);
  mkdirSync(projects);
  mkdirSync(files);
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(join(projects, 'config.json'), workspaceConfig());
  writeFileSync(join(files, `${APP_ID}.json`), JSON.stringify(projectFile(APP_ID, TOKEN_APP)));
  writeFileSync(join(files, `${OTHER_APP}.json`), JSON.stringify(projectFile(OTHER_APP, TOKEN_OTHER)));
  writeFileSync(join(rootDir, 'registerRepositories.ts'), `import { registerWorkflowWakeHandler } from '/_102034_/l1/workflow/wakeRegistry.js';
registerWorkflowWakeHandler(${JSON.stringify({
    projectId: APP_ID,
    moduleId: 'modA',
    processId: 'procA',
    routine: 'onWait',
  })}, async () => { globalThis.__rt106s5Calls = (globalThis.__rt106s5Calls ?? 0) + 1; });
`);
  process.chdir(workspace);
  process.env.CBE_PROJECT_FILES_DIR = files;
  process.env.MSG_PROXY_TOKEN = TOKEN_ENV;
  resetProjectsConfigCache();
  resetConfiguredModuleCompositionCache();
  resetWorkflowWakeRegistryForTests();
  (globalThis as { __rt106s5Calls?: number }).__rt106s5Calls = 0;
  const store = new MemoryStore();
  let constructions = 0;
  const app = Fastify({ logger: false });
  registerWorkflowWakeRoutes(app, {
    createInbox: () => {
      constructions += 1;
      return store;
    },
  });
  await app.ready();
  return {
    app,
    store,
    constructions: () => constructions,
    calls: () => (globalThis as { __rt106s5Calls?: number }).__rt106s5Calls ?? 0,
    restore: async () => {
      await app.close();
      process.chdir(previousCwd);
      if (previousFiles === undefined) delete process.env.CBE_PROJECT_FILES_DIR;
      else process.env.CBE_PROJECT_FILES_DIR = previousFiles;
      if (previousEnvToken === undefined) delete process.env.MSG_PROXY_TOKEN;
      else process.env.MSG_PROXY_TOKEN = previousEnvToken;
      resetProjectsConfigCache();
      resetConfiguredModuleCompositionCache();
      resetWorkflowWakeRegistryForTests();
      rmSync(workspace, { recursive: true, force: true });
    },
  };
}

function authHeaders(token = TOKEN_APP, appId = APP_ID): Record<string, string> {
  return {
    'x-app-id': appId,
    authorization: `Bearer ${token}`,
    cookie: 'cauth=eyJhbGciOiJub25lIn0.e30.sig',
  };
}

async function post(app: FastifyInstance, payload: unknown, headers: Record<string, string | string[]> = authHeaders()): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/exec/workflow-event',
    headers: { 'content-type': 'application/json', ...headers },
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

function assertNoSecrets(response: LightMyRequestResponse): void {
  const dumped = `${response.statusCode} ${response.body} ${JSON.stringify(response.headers)}`;
  for (const secret of SECRETS) assert.equal(dumped.includes(secret), false);
}

function assertNoReceipt(response: LightMyRequestResponse): void {
  const body = response.json() as { outcome?: unknown; eventId?: unknown };
  assert.equal(body.outcome, undefined);
  assert.equal(body.eventId, undefined);
}

test('the route confirms only after the commit and never runs the handler', async () => {
  const env = await harness();
  try {
    let release: () => void = () => {};
    env.store.gate = new Promise((resolve) => {
      release = resolve;
    });
    let settled = false;
    const pending = post(env.app, event()).then((response) => {
      settled = true;
      return response;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(settled, false);
    assert.equal(env.store.seen.length, 1);
    assert.equal(env.calls(), 0);
    release();
    const response = await pending;
    assert.equal(response.statusCode, 202);
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.json(), { eventId: 'task-1:wait:1:1', outcome: 'accepted' });
    assert.equal(env.calls(), 0);
    assert.equal(env.constructions(), 1);
    assert.equal('secretNote' in (env.store.seen[0] as object), false);
    assertNoSecrets(response);

    env.store.gate = null;
    env.store.completed = env.store.seen[0] ?? null;
    const replay = await post(env.app, event({ attempt: 2, revision: 9 }));
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.json(), { eventId: 'task-1:wait:1:1', outcome: 'stale' });
    assert.equal(env.store.seen.length, 2);
    assert.equal(env.store.seen[1]?.attempt, 2);
    assert.equal(env.store.seen[1]?.revision, 9);
    assert.equal(env.calls(), 0);
    assert.equal(env.constructions(), 1);
    assertNoSecrets(replay);
  } finally {
    await env.restore();
  }
});

test('auth refuses the global token, a cookie, another app and a duplicated header without a receipt', async () => {
  const env = await harness();
  try {
    const cases: Array<{ headers: Record<string, string | string[]>; status: number }> = [
      { headers: { 'x-app-id': APP_ID }, status: 401 },
      { headers: { 'x-app-id': APP_ID, authorization: 'Bearer' }, status: 401 },
      { headers: { 'x-app-id': APP_ID, authorization: 'Basic abc' }, status: 401 },
      { headers: { authorization: `Bearer ${TOKEN_APP}` }, status: 401 },
      { headers: { 'x-app-id': ['910106', '910106'], authorization: `Bearer ${TOKEN_APP}` }, status: 401 },
      { headers: { 'x-app-id': APP_ID, authorization: [`Bearer ${TOKEN_APP}`, `Bearer ${TOKEN_APP}`] }, status: 401 },
      { headers: authHeaders(TOKEN_OTHER), status: 403 },
      { headers: authHeaders(TOKEN_ENV), status: 403 },
      { headers: authHeaders(TOKEN_APP, OTHER_APP), status: 403 },
      { headers: authHeaders(''), status: 401 },
    ];
    for (const item of cases) {
      const response = await post(env.app, event(), item.headers);
      assert.equal(response.statusCode, item.status);
      assertNoReceipt(response);
      assertNoSecrets(response);
    }
    assert.equal(env.store.seen.length, 0);
    assert.equal(env.calls(), 0);
    assert.equal(env.constructions(), 0);
  } finally {
    await env.restore();
  }
});

test('invalid body, size limit, scope and commit failure return no receipt', async () => {
  const env = await harness();
  try {
    const bad = await post(env.app, '{');
    assert.equal(bad.statusCode, 400);
    assertNoReceipt(bad);

    const missing = await post(env.app, { hello: 'x' });
    assert.equal(missing.statusCode, 400);
    assertNoReceipt(missing);

    const padded = `${JSON.stringify(event())}${' '.repeat(WORKFLOW_WAKE_BODY_LIMIT_BYTES)}`;
    const tooBig = await post(env.app, padded);
    assert.equal(tooBig.statusCode, 413);
    assertNoReceipt(tooBig);

    const otherProject = await post(env.app, event({
      ref: {
        project: OTHER_APP,
        module: 'modA',
        entity: 'order',
        recordId: 'rec-1',
        processId: 'procA',
        workflowVersion: null,
      },
    }));
    assert.equal(otherProject.statusCode, 403);
    assertNoReceipt(otherProject);

    const unknownModule = await post(env.app, event({
      ref: {
        project: APP_ID,
        module: 'modIdle',
        entity: 'order',
        recordId: 'rec-1',
        processId: 'procA',
        workflowVersion: null,
      },
    }));
    assert.equal(unknownModule.statusCode, 403);
    assertNoReceipt(unknownModule);

    const unregistered = await post(env.app, event({ routine: 'otherRoutine' }));
    assert.equal(unregistered.statusCode, 503);
    assertNoReceipt(unregistered);
    assert.equal(JSON.stringify(unregistered.json()).includes('otherRoutine'), false);

    env.store.failCommit = true;
    const commit = await post(env.app, event());
    assert.equal(commit.statusCode, 503);
    assertNoReceipt(commit);
    assert.equal(env.calls(), 0);

    env.store.failCommit = false;
    env.store.conflict = true;
    const conflict = await post(env.app, event());
    assert.equal(conflict.statusCode, 409);
    assertNoReceipt(conflict);
    for (const response of [bad, missing, tooBig, otherProject, unknownModule, unregistered, commit, conflict]) {
      assertNoSecrets(response);
    }
  } finally {
    await env.restore();
  }
});
