/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/workflowWakeLifecycle.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModuleWakeEvent, ModuleWakeReceipt } from '/_102036_/l2/shared/interfaces.js';
import {
  buildHttpServer,
  bootSteps,
  createServerWorkflowWakeLifecycle,
  type ServerWorkflowWakeLoop,
} from '/_102034_/l1/server/layer_1_external/transport/http/startServer.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { resetWorkflowWakeRegistryForTests } from '/_102034_/l1/workflow/wakeRegistry.js';
import { WorkflowWakeInboxLoop, type WorkflowWakeTimer } from '/_102034_/l1/workflow/wakeLoop.js';
import {
  registerWorkflowWakeHandler,
  workflowWakeCommandId,
  type ModuleWakeEvent as PublicModuleWakeEvent,
  type ModuleWakeReceipt as PublicModuleWakeReceipt,
  type WorkflowWakeHandler,
  type WorkflowWakeScope,
} from '/_102034_/l1/workflow/index.js';

const PROJECT = '900001';

test('boot starts inbox recovery after migrations and organization and before listen', async () => {
  const order: string[] = [];
  let created = 0;
  const lifecycle = createServerWorkflowWakeLifecycle({
    readEnv: () => ({ runtimeMode: 'postgres', tickEnabled: false }),
    createLoop: () => {
      created += 1;
      return {
        async start() { order.push('wake-start'); },
        async stop() { order.push('wake-stop'); },
      };
    },
  });
  await bootSteps({
    draft: true,
    runMigrations: async () => { order.push('migrate'); },
    initializeOrganization: async () => { order.push('organization'); },
    beforeListen: () => lifecycle.start(),
    listen: async () => { order.push('listen'); },
  });
  assert.deepEqual(order, ['migrate', 'organization', 'wake-start', 'listen']);
  assert.equal(created, 1);
  await lifecycle.stop();
  assert.deepEqual(order.at(-1), 'wake-stop');
});

test('a first inbox round that never finishes does not hold listen', async () => {
  const order: string[] = [];
  const lifecycle = createServerWorkflowWakeLifecycle({
    readEnv: () => ({ runtimeMode: 'postgres', tickEnabled: true }),
    createLoop: () => ({
      start: () => {
        order.push('wake-start');
        return new Promise<void>(() => {});
      },
      async stop() { order.push('wake-stop'); },
    }),
  });
  await bootSteps({
    draft: false,
    runMigrations: async () => {},
    initializeOrganization: async () => { order.push('organization'); },
    beforeListen: () => lifecycle.start(),
    listen: async () => { order.push('listen'); },
  });
  assert.deepEqual(order, ['organization', 'wake-start', 'listen']);
});

test('memory runtime does not start inbox recovery', async () => {
  let created = 0;
  const lifecycle = createServerWorkflowWakeLifecycle({
    readEnv: () => ({ runtimeMode: 'memory', tickEnabled: true }),
    createLoop: () => {
      created += 1;
      return { async start() {}, async stop() {} };
    },
  });
  await lifecycle.start();
  assert.equal(created, 0);
  await lifecycle.stop();
});

test('close waits for the inbox round that is still running', async () => {
  let release = (): void => {};
  const gate = new Promise<void>((done) => { release = done; });
  let stopEntered = false;
  const lifecycle = createServerWorkflowWakeLifecycle({
    readEnv: () => ({ runtimeMode: 'postgres', tickEnabled: false }),
    createLoop: () => ({
      async start() {},
      async stop() {
        stopEntered = true;
        await gate;
      },
    }),
  });
  await lifecycle.start();
  let closed = false;
  const closing = lifecycle.stop().then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(stopEntered, true);
  assert.equal(closed, false);
  release();
  await closing;
  assert.equal(closed, true);
});

function timeoutCount(): number {
  const handles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? [];
  return handles.filter((handle) => (handle as { constructor?: { name?: string } }).constructor?.name === 'Timeout').length;
}

test('buildHttpServer exposes the wake route and does not start a loop', async () => {
  const previousCwd = process.cwd();
  const workspace = mkdtempSync(join(tmpdir(), 'rt106-s7-'));
  const config = {
    defaultProjectId: '900001',
    shellTemplates: { spa: './shells/spa.html', pwa: './shells/pwa.html' },
    projects: {
      '900001': {
        root: './client',
        type: 'client',
        persistenceModules: [{ moduleId: 'mdm', persistenceEntrypoint: './_102034_/l1/mdm/persistence.js' }],
        modules: [],
      },
      '102029': { root: './fe', type: 'master frontend' },
      '102034': { root: './be', type: 'master backend' },
    },
  };
  writeFileSync(join(workspace, 'config.json'), JSON.stringify(config));
  mkdirSync(join(workspace, 'shells'), { recursive: true });
  writeFileSync(join(workspace, 'shells', 'spa.html'), '<!doctype html><html></html>');
  writeFileSync(join(workspace, 'shells', 'pwa.html'), '<!doctype html><html></html>');
  process.chdir(workspace);
  resetProjectsConfigCache();
  const timersBefore = timeoutCount();
  try {
    const app = buildHttpServer();
    await app.ready();
    const routes = app.printRoutes();
    assert.match(routes, /workflow-event \(POST\)/);
    assert.match(routes, /Bff \(POST\)/);
    const health = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);
    const wake = await app.inject({
      method: 'POST',
      url: '/exec/workflow-event',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    assert.equal(wake.statusCode, 401);
    assert.equal(wake.headers['cache-control'], 'no-store');
    assert.equal('eventId' in (wake.json() as object), false);
    assert.equal(timeoutCount(), timersBefore);
    await app.close();
    assert.equal(timeoutCount(), timersBefore);
  } finally {
    process.chdir(previousCwd);
    resetProjectsConfigCache();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('boot keeps the tick gate, alpha check and wake stop on close', () => {
  const source = readFileSync(new URL('./startServer.ts', import.meta.url), 'utf8');
  const buildBody = source.slice(
    source.indexOf('export function buildHttpServer'),
    source.indexOf('export interface BootStepsInput'),
  );
  assert.match(buildBody, /registerWorkflowWakeRoutes\(app\)/);
  assert.doesNotMatch(buildBody, /WorkflowWakeInboxLoop/);
  assert.match(source, /env\.runtimeMode === 'postgres' && env\.tickEnabled \? new ModuleTickLoop\(\)/);
  assert.match(source, /isAlphaAllAuthorities\(\)/);
  assert.match(source, /beforeListen: \(\) => workflowWakeLifecycle\.start\(\)/);
  assert.match(source, /await workflowWakeLifecycle\.stop\(\)/);
});

test('public registration is drained without a prior execBff call', async () => {
  resetWorkflowWakeRegistryForTests();
  const scope: WorkflowWakeScope = {
    projectId: PROJECT,
    moduleId: 'module-a',
    processId: 'process-a',
    routine: 'routine-a',
  };
  let ran = 0;
  const handler: WorkflowWakeHandler = async () => { ran += 1; };
  registerWorkflowWakeHandler(scope, handler);
  registerWorkflowWakeHandler(scope, handler);
  const event = {
    eventId: `${PROJECT}:step:1:1`,
    ref: { project: PROJECT, module: scope.moduleId, processId: scope.processId },
  } as ModuleWakeEvent;
  const receipt: ModuleWakeReceipt = { eventId: event.eventId, outcome: 'accepted' };
  const publicEvent: PublicModuleWakeEvent = event;
  const publicReceipt: PublicModuleWakeReceipt = receipt;
  assert.equal(workflowWakeCommandId(publicEvent.eventId), `wake:${publicReceipt.eventId}`);
  let scheduled = 0;
  const loop: ServerWorkflowWakeLoop = new WorkflowWakeInboxLoop({
    resolveProjectId: () => PROJECT,
    readEnv: () => ({ runtimeMode: 'postgres', tickEnabled: false }),
    createStore: () => ({
      async enqueue() {
        throw new Error('enqueue is not used by recovery');
      },
      async runNext(_projectId, dispatch) {
        const result = await dispatch(event);
        assert.equal(result, 'accepted');
        return 'empty';
      },
    }),
    createDispatcher: () => ({
      async dispatch(incoming) {
        await handler({} as never, incoming, {} as never);
        return 'accepted';
      },
    }),
    schedule: () => {
      scheduled += 1;
      return { unref() {} } satisfies WorkflowWakeTimer;
    },
    clearTimer: () => {},
  });
  try {
    await loop.start();
    assert.equal(ran, 1);
    assert.equal(scheduled, 1);
    await loop.stop();
  } finally {
    resetWorkflowWakeRegistryForTests();
  }
});
