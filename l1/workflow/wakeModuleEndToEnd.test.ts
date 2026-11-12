/// <mls fileReference="_102034_/l1/workflow/wakeModuleEndToEnd.test.ts" enhancement="_blank"/>
// rt207: o agendamento (onTick) e o despertar (/exec/workflow-event) de um módulo, de ponta a ponta no motor, com um módulo de fixture
// declarado como o `wfteste` do projeto workflow-estatico: `persistenceEntrypoint` -> moduleTick (tick) e
// `tableDefsDir`/registerRepositories (handler do despertar). Registro, raiz de composição, rota e despachante são os REAIS;
// só o inbox (memória), a porta de Task e o contexto são dublês.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { loadModuleTickHandlers } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { registerWorkflowWakeRoutes } from '/_102034_/l1/server/layer_1_external/transport/http/workflowWake.js';
import { ModuleTickLoop, type TickContextFactory } from '/_102034_/l1/server/layer_2_application/tick/moduleTick.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { resetConfiguredModuleCompositionCache } from '/_102034_/l1/server/layer_2_controllers/moduleRegistry.js';
import type { OccurrenceKey, TaskOccurrencePort, TaskOccurrenceSnapshot } from '/_102034_/l1/workflow/contracts.js';
import type { WorkflowPlan } from '/_102034_/l1/workflow/plan.js';
import type { WorkflowWakeInbox } from '/_102034_/l1/workflow/wakeContracts.js';
import { createWorkflowWakeDispatcher } from '/_102034_/l1/workflow/wakeDispatch.js';
import { resetWorkflowWakeRegistryForTests } from '/_102034_/l1/workflow/wakeRegistry.js';
import type { ModuleWakeEvent } from '/_102036_/l2/shared/interfaces.js';

const APP_ID = '920207';
const TOKEN = 'sentinel-wake-token-rt207';
const MODULE = 'wfteste';

interface Marks {
  ticks: string[];
  wakes: string[];
}

function marks(): Marks {
  const holder = globalThis as { __rt207?: Marks };
  holder.__rt207 ??= { ticks: [], wakes: [] };
  return holder.__rt207;
}

const registerSource = (moduleId: string, routine: string) => `import { registerWorkflowWakeHandler } from '/_102034_/l1/workflow/index.js';
registerWorkflowWakeHandler(${JSON.stringify({ projectId: APP_ID, moduleId, processId: 'procA', routine })}, async (ctx, event, occurrence) => {
  globalThis.__rt207.wakes.push(ctx.moduleId + ':' + event.eventId + ':' + occurrence.taskId);
});
`;

const tickSource = (moduleId: string) => `export async function onTick(ctx, now) {
  globalThis.__rt207.ticks.push(${JSON.stringify(moduleId)} + '@' + ctx.moduleId + '@' + now.toISOString());
}
`;

function workspaceConfig(): string {
  return JSON.stringify({
    defaultProjectId: APP_ID,
    projects: {
      [APP_ID]: {
        type: 'client',
        role: 'client_project',
        modules: [{ moduleId: MODULE }, { moduleId: 'semtick' }, { moduleId: 'semraiz' }, { moduleId: 'tardio' }],
        persistenceModules: [
          // como o wfteste: raiz de composição (despertar) + persistenceEntrypoint (tick)
          { moduleId: MODULE, tableDefsDir: `_${APP_ID}_/l1/${MODULE}/tables`, persistenceEntrypoint: `_${APP_ID}_/l1/${MODULE}/tables/moduleTick.js` },
          // módulo gerado hoje: só a raiz de composição; o onTick que ela exportar NÃO é lido (decisão A da rt207)
          { moduleId: 'semtick', tableDefsDir: `_${APP_ID}_/l1/semtick/tables` },
          { moduleId: 'semraiz', tableDefsDir: `_${APP_ID}_/l1/semraiz/tables` },
          { moduleId: 'tardio', tableDefsDir: `_${APP_ID}_/l1/tardio/tables` },
        ],
      },
      '102029': { type: 'master frontend', role: 'frontend_base', modules: [] },
      '102034': { type: 'master backend', role: 'server_core', modules: [] },
    },
  });
}

class MemoryInbox implements WorkflowWakeInbox {
  readonly stored = new Map<string, ModuleWakeEvent>();

  async enqueue(event: ModuleWakeEvent) {
    const known = this.stored.has(event.eventId);
    this.stored.set(event.eventId, event);
    return {
      statusCode: known ? (200 as const) : (202 as const),
      receipt: { eventId: event.eventId, outcome: known ? ('stale' as const) : ('accepted' as const) },
    };
  }

  async runNext(): Promise<'empty'> {
    throw new Error('runNext must not run on the HTTP route');
  }
}

function plan(): WorkflowPlan {
  return {
    processId: 'procA',
    title: 'Plan',
    moduleTitle: 'Module',
    steps: [{ stepId: 'wait', kind: 'wait', title: 'Wait', next: [], ownerKind: 'clock' }],
  };
}

function snapshot(moduleId: string): TaskOccurrenceSnapshot {
  return {
    ref: { project: APP_ID, module: moduleId, entity: 'order', recordId: 'rec-1', processId: 'procA', workflowVersion: null },
    step: 'wait',
    actorNow: null,
    done: false,
    plan: plan(),
    title: 'Occurrence',
    taskId: 'task-1',
    revision: 4,
    status: 'in progress',
    owner: 'owner-1',
    origin: { kind: 'event' },
    room: { mode: 'exclusive' },
    roomId: 'room-1',
    pass: 1,
    wake: { everyMinutes: 5, routine: 'onWait', nextAt: '2026-10-20T12:00:00Z', seq: 1, until: '2026-10-21T00:00:00Z' },
    history: [],
  };
}

function wakeEvent(overrides: Record<string, unknown> = {}, moduleId = MODULE): Record<string, unknown> {
  return {
    eventId: 'task-1:wait:1:1',
    scheduledAt: '2026-10-20T12:00:00.000Z',
    attempt: 1,
    ref: { project: APP_ID, module: moduleId, entity: 'order', recordId: 'rec-1', processId: 'procA', workflowVersion: null },
    taskId: 'task-1',
    stepKey: 'wait',
    pass: 1,
    seq: 1,
    revision: 4,
    routine: 'onWait',
    source: 'message',
    ...overrides,
  };
}

function dispatcherFor(moduleId: string) {
  const port: TaskOccurrencePort = {
    kind: 'task',
    async open() { throw new Error('dispatcher must not open'); },
    async find(_ctx: RequestContext, _key: OccurrenceKey) { return snapshot(moduleId); },
    async advance() { throw new Error('dispatcher must not advance'); },
  };
  // Sem `resolve`: o despachante usa o registro REAL (resolveWorkflowWakeHandler), que carrega a raiz de composição do módulo.
  return createWorkflowWakeDispatcher(APP_ID, moduleId, {
    port,
    now: () => new Date('2026-10-20T12:00:01Z'),
    companyId: () => 'company-canonical',
    readIntegration: () => ({ organizationId: 'org-1' }),
    createContext: () => createRequestContext(createMemoryDataRuntime(), { sandbox: true }),
  });
}

interface Env {
  app: FastifyInstance;
  inbox: MemoryInbox;
  projects: string;
  restore: () => Promise<void>;
}

async function setup(): Promise<Env> {
  const previousCwd = process.cwd();
  const previousFiles = process.env.CBE_PROJECT_FILES_DIR;
  const workspace = mkdtempSync(join(tmpdir(), 'rt207-'));
  const projects = join(workspace, 'projects');
  const files = join(workspace, 'project-files');
  mkdirSync(projects);
  mkdirSync(files);
  writeFileSync(join(projects, 'config.json'), workspaceConfig());
  writeFileSync(join(files, `${APP_ID}.json`), JSON.stringify({
    schema: 1,
    generatedAt: '2026-10-20T00:00:00.000Z',
    org: { orgId: 'org-rt207', slug: 'acme', name: 'Acme', createdAt: '2026-01-01T00:00:00.000Z' },
    project: { projectId: APP_ID, domain: null, appEnv: null, language: null, type: 'client', createdAt: '2026-02-01T00:00:00.000Z' },
    collabMessages: { token: TOKEN },
  }));
  const write = (moduleId: string, name: string, source: string) => {
    const dir = join(projects, `mls-${APP_ID}/l1/${moduleId}/tables`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), source);
  };
  write(MODULE, 'registerRepositories.ts', registerSource(MODULE, 'onWait'));
  write(MODULE, 'moduleTick.ts', tickSource(MODULE));
  // só a raiz, exportando onTick: o motor não o lê (o tick vem do persistenceEntrypoint)
  write('semtick', 'registerRepositories.ts', `${registerSource('semtick', 'onWait')}\n${tickSource('semtick')}`);
  write('semraiz', 'registerRepositories.ts', 'export {};\n');
  // 'tardio' nasce sem raiz de composição: o arquivo aparece depois (cenário c)

  marks().ticks.length = 0;
  marks().wakes.length = 0;
  process.chdir(workspace);
  process.env.CBE_PROJECT_FILES_DIR = files;
  resetProjectsConfigCache();
  resetConfiguredModuleCompositionCache();
  resetWorkflowWakeRegistryForTests();
  const inbox = new MemoryInbox();
  const app = Fastify({ logger: false });
  registerWorkflowWakeRoutes(app, { createInbox: () => inbox });
  await app.ready();
  return {
    app,
    inbox,
    projects,
    restore: async () => {
      await app.close();
      process.chdir(previousCwd);
      if (previousFiles === undefined) delete process.env.CBE_PROJECT_FILES_DIR;
      else process.env.CBE_PROJECT_FILES_DIR = previousFiles;
      resetProjectsConfigCache();
      resetConfiguredModuleCompositionCache();
      resetWorkflowWakeRegistryForTests();
      rmSync(workspace, { recursive: true, force: true });
    },
  };
}

async function post(app: FastifyInstance, payload: unknown): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/exec/workflow-event',
    headers: {
      'content-type': 'application/json',
      'x-app-id': APP_ID,
      authorization: `Bearer ${TOKEN}`,
    },
    payload: JSON.stringify(payload),
  });
}

test('(a) o onTick do módulo declarado por persistenceEntrypoint roda numa passada do moduleTick', async () => {
  const env = await setup();
  try {
    const handlers = await loadModuleTickHandlers();
    // só quem declara persistenceEntrypoint entra; 'semtick' exporta onTick na raiz e continua de fora
    assert.deepEqual(handlers.map((entry) => entry.moduleId), [MODULE]);

    const contextFor: TickContextFactory = (moduleId) => ({ moduleId } as unknown as RequestContext);
    const loop = new ModuleTickLoop(contextFor, 60_000, loadModuleTickHandlers);
    assert.equal(await loop.start(), 1);
    try {
      await loop.runOnce(new Date('2026-10-20T08:00:00.000Z'));
    } finally {
      loop.stop();
    }
    assert.deepEqual(marks().ticks, [`${MODULE}@${MODULE}@2026-10-20T08:00:00.000Z`]);
  } finally {
    await env.restore();
  }
});

test('(b) o despertar válido é gravado (accepted) e o despachante chama o handler que a raiz do módulo registrou', async () => {
  const env = await setup();
  try {
    const response = await post(env.app, wakeEvent());
    assert.equal(response.statusCode, 202);
    assert.deepEqual(response.json(), { eventId: 'task-1:wait:1:1', outcome: 'accepted' });
    assert.equal(env.inbox.stored.size, 1);
    assert.equal(marks().wakes.length, 0, 'a rota resolve o handler e não o chama');

    const stored = env.inbox.stored.get('task-1:wait:1:1');
    assert.ok(stored);
    assert.equal(await dispatcherFor(MODULE).dispatch(stored), 'accepted');
    assert.deepEqual(marks().wakes, [`${MODULE}:task-1:wait:1:1:task-1`]);
  } finally {
    await env.restore();
  }
});

test('(c) sem handler a rota dá 503 ANTES de gravar e o mesmo evento é aceito quando o módulo passa a ter a raiz', async () => {
  const env = await setup();
  try {
    // módulo configurado, raiz carrega, mas ninguém registrou a rotina pedida
    const noHandler = await post(env.app, wakeEvent({ routine: 'naoRegistrada' }, 'semraiz'));
    assert.equal(noHandler.statusCode, 503);
    assert.equal(env.inbox.stored.size, 0, 'nada fica no inbox: quem guarda o despertar é o cm, que reenvia');
    assert.equal(JSON.stringify(noHandler.json()).includes('naoRegistrada'), false);
    assert.equal((noHandler.json() as { outcome?: unknown }).outcome, undefined);

    // módulo configurado sem raiz de composição: 503 e nada gravado; o arquivo chega e o reenvio do cm passa
    const early = await post(env.app, wakeEvent({}, 'tardio'));
    assert.equal(early.statusCode, 503);
    assert.equal(env.inbox.stored.size, 0);
    const dir = join(env.projects, `mls-${APP_ID}/l1/tardio/tables`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'registerRepositories.ts'), registerSource('tardio', 'onWait'));
    const retried = await post(env.app, wakeEvent({}, 'tardio'));
    assert.equal(retried.statusCode, 202);
    assert.deepEqual(retried.json(), { eventId: 'task-1:wait:1:1', outcome: 'accepted' });
    assert.equal(env.inbox.stored.size, 1);

    // evento já gravado cujo handler sumiu: o despachante devolve retry (não perde, não aceita)
    resetWorkflowWakeRegistryForTests();
    const stored = env.inbox.stored.get('task-1:wait:1:1');
    assert.ok(stored);
    assert.deepEqual(await dispatcherFor('tardio').dispatch(stored), { retry: { code: 'WORKFLOW_WAKE_HANDLER_UNAVAILABLE' } });
    assert.equal(marks().wakes.length, 0);
  } finally {
    await env.restore();
  }
});
