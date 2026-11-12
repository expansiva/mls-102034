/// <mls fileReference="_102034_/l1/workflow/wakeWftestePostgres.test.ts" enhancement="_blank"/>
// rt212 s3: o aviso de fim de LLM do `wfteste` REAL, de ponta a ponta em Postgres real (schema isolado):
// rota /exec/workflow-event -> fila PG -> laço (runNext) -> despachante -> `entregarPesquisar` real (registrado pelo
// `registerRepositories` real do módulo) -> repositório real do pedido em PG -> avanço na etapa seguinte.
// Só a porta de Task (o cm) é dublê. Pula sem RUN_INTEGRATION_TESTS=true + WORKFLOW_TEST_PG_URL (collab_app_test local) e
// quando o projeto 102047 não está ao lado.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { createPostgresModuleDataRuntime } from '/_102034_/l1/server/layer_1_external/data/moduleDataRuntime.js';
import type { ResolvedTableDefinition, TableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import {
  findResolvedTableDefinition,
  resetResolvedTableDefinitionsCache,
} from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { buildCreateIndexSql, buildCreateTableSql } from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';
import { registerWorkflowWakeRoutes } from '/_102034_/l1/server/layer_1_external/transport/http/workflowWake.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { resetConfiguredModuleCompositionCache } from '/_102034_/l1/server/layer_2_controllers/moduleRegistry.js';
import { clearRepositories } from '/_102034_/l1/server/layer_2_application/repositoryRegistry.js';
import { tableDefinitions } from '/_102034_/l1/server/persistence.js';
import type {
  OccurrenceKey,
  TaskOccurrenceAdvanceCommand,
  TaskOccurrenceLlmCommand,
  TaskOccurrenceLlmPort,
  TaskOccurrenceLlmResult,
  TaskOccurrenceSnapshot,
} from '/_102034_/l1/workflow/contracts.js';
import { workflowWakeCommandId } from '/_102034_/l1/workflow/wakeContracts.js';
import { createWorkflowWakeDispatcher } from '/_102034_/l1/workflow/wakeDispatch.js';
import { createPostgresWorkflowWakeInbox } from '/_102034_/l1/workflow/wakeInboxPostgres.js';
import { resetWorkflowWakeRegistryForTests } from '/_102034_/l1/workflow/wakeRegistry.js';

const APP_ID = '102047';
const MODULE = 'wfteste';
const TOKEN = 'sentinel-wake-token-rt212';
const mlsBase = resolvePath(dirname(fileURLToPath(import.meta.url)), '../../..');
const wftesteRoot = join(mlsBase, `mls-${APP_ID}`, 'l1', MODULE);
const integration = process.env.RUN_INTEGRATION_TESTS === 'true'
  && process.env.WORKFLOW_TEST_PG_URL !== undefined
  && process.env.WORKFLOW_TEST_PG_URL !== ''
  && existsSync(wftesteRoot);

const ENV = { runtimeMode: 'postgres', appEnv: 'development' } as AppEnv;
const PERSISTENCE_DIR = '_102047_/l1/wfteste/layer_1_external/adapters/persistence';

function localTestUrl(): string {
  const raw = process.env.WORKFLOW_TEST_PG_URL ?? '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('WORKFLOW_TEST_PG_URL must be a local collab_app_test URL');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || database !== 'collab_app_test') {
    throw new Error('WORKFLOW_TEST_PG_URL must be a local collab_app_test URL');
  }
  return raw;
}

function workspaceConfig(): string {
  return JSON.stringify({
    defaultProjectId: APP_ID,
    projects: {
      [APP_ID]: {
        type: 'client',
        role: 'client_project',
        modules: [{ moduleId: MODULE }],
        persistenceModules: [{
          moduleId: MODULE,
          tableDefsDir: `./${PERSISTENCE_DIR}`,
          persistenceEntrypoint: `./${PERSISTENCE_DIR}/moduleTick.js`,
        }],
      },
      '102029': { type: 'master frontend', role: 'frontend_base', modules: [] },
      '102034': { type: 'master backend', role: 'server_core', modules: [] },
    },
  });
}

function resolveDefinition(definition: TableDefinition, projectId: string): ResolvedTableDefinition {
  return {
    ...definition,
    projectId,
    repositoryName: definition.repositoryName ?? definition.tableName,
    logicalTableName: definition.tableName,
    dynamoResolvedTableName: null,
  };
}

interface Bench {
  pool: Pool;
  schema: string;
  app: FastifyInstance;
  workspace: string;
  restore: () => Promise<void>;
  inbox: ReturnType<typeof createPostgresWorkflowWakeInbox>;
  ctx: () => RequestContext;
}

let bench: Promise<Bench> | undefined;
let tail: Promise<void> = Promise.resolve();

async function setup(): Promise<Bench> {
  const previousCwd = process.cwd();
  const previousFiles = process.env.CBE_PROJECT_FILES_DIR;
  const workspace = mkdtempSync(join(tmpdir(), 'rt212-'));
  const projects = join(workspace, 'projects');
  const files = join(workspace, 'project-files');
  mkdirSync(projects);
  mkdirSync(files);
  writeFileSync(join(projects, 'config.json'), workspaceConfig());
  symlinkSync(join(mlsBase, `mls-${APP_ID}`), join(projects, `mls-${APP_ID}`));
  writeFileSync(join(files, `${APP_ID}.json`), JSON.stringify({
    schema: 1,
    generatedAt: '2026-11-12T00:00:00.000Z',
    org: { orgId: 'org-rt212', slug: 'acme', name: 'Acme', createdAt: '2026-01-01T00:00:00.000Z' },
    project: { projectId: APP_ID, domain: null, appEnv: null, language: null, type: 'client', createdAt: '2026-02-01T00:00:00.000Z' },
    collabMessages: { token: TOKEN },
  }));
  process.chdir(workspace);
  process.env.CBE_PROJECT_FILES_DIR = files;
  resetProjectsConfigCache();
  resetResolvedTableDefinitionsCache();
  resetConfiguredModuleCompositionCache();
  resetWorkflowWakeRegistryForTests();
  clearRepositories();

  const schema = `workflow_wfteste_${randomBytes(8).toString('hex')}`;
  const url = new URL(localTestUrl());
  url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new Pool({ connectionString: url.toString(), max: 4 });
  const client = await pool.connect();
  let inboxDefinition: ResolvedTableDefinition;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    const found = tableDefinitions.find((definition) => definition.repositoryName === 'workflowWakeInbox');
    if (!found) throw new Error('workflow wake inbox definition is missing');
    inboxDefinition = resolveDefinition(found, APP_ID);
    const pedido = await findResolvedTableDefinition('pedido', ENV);
    for (const definition of [inboxDefinition, pedido]) {
      await client.query(buildCreateTableSql(definition));
      for (const sql of buildCreateIndexSql(definition)) await client.query(sql);
    }
  } finally {
    client.release();
  }

  const inbox = createPostgresWorkflowWakeInbox({ projectId: APP_ID, pool, definition: inboxDefinition });
  const app = Fastify({ logger: false });
  registerWorkflowWakeRoutes(app, { createInbox: () => inbox });
  await app.ready();

  const moduleData = createPostgresModuleDataRuntime(ENV, pool);
  const ctx = (): RequestContext => {
    const runtime = createMemoryDataRuntime();
    Object.defineProperty(runtime, 'moduleData', { value: moduleData });
    const created = createRequestContext(runtime, { sandbox: true });
    created.moduleId = MODULE;
    return created;
  };

  return {
    pool,
    schema,
    app,
    workspace,
    inbox,
    ctx,
    restore: async () => {
      await app.close();
      try {
        await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await pool.end();
      }
      process.chdir(previousCwd);
      if (previousFiles === undefined) delete process.env.CBE_PROJECT_FILES_DIR;
      else process.env.CBE_PROJECT_FILES_DIR = previousFiles;
      resetProjectsConfigCache();
      resetResolvedTableDefinitionsCache();
      resetConfiguredModuleCompositionCache();
      resetWorkflowWakeRegistryForTests();
      clearRepositories();
      rmSync(workspace, { recursive: true, force: true });
    },
  };
}

function benchOnce(): Promise<Bench> {
  bench ??= setup();
  return bench;
}

after(async () => {
  if (bench) await (await bench).restore();
});

function serial<T>(run: () => Promise<T>): Promise<T> {
  const next = tail.then(run, run);
  tail = next.then(() => undefined, () => undefined);
  return next;
}

/** A porta do cm de mentira: guarda o estado da ocorrência e as chamadas que o módulo faz. */
function fakePort(initial: TaskOccurrenceSnapshot, llm: TaskOccurrenceLlmResult) {
  let snapshot = structuredClone(initial);
  const advances: TaskOccurrenceAdvanceCommand[] = [];
  const reads: TaskOccurrenceLlmCommand[] = [];
  const port: TaskOccurrenceLlmPort = {
    kind: 'task',
    async open() { throw new Error('the research end must not open a Task'); },
    async find() { return structuredClone(snapshot); },
    async advance(_ctx, _key, command) {
      advances.push(command);
      snapshot = {
        ...snapshot,
        step: command.to,
        actorNow: command.actorNow,
        revision: snapshot.revision + 1,
        pass: snapshot.pass,
      };
      return { outcome: 'advanced', occurrence: structuredClone(snapshot), moduleMessage: { state: 'sent', threadId: 'th-1' } };
    },
    async requestLlmStep(_ctx, _key, command) {
      reads.push(command);
      return llm;
    },
  };
  return { port, advances, reads, current: () => snapshot };
}

function occurrenceAtResearch(pedidoId: string, plan: unknown): TaskOccurrenceSnapshot {
  return {
    ref: { project: APP_ID, module: MODULE, entity: 'Pedido', recordId: pedidoId, processId: 'processoPedido', workflowVersion: null },
    step: 'pesquisar',
    actorNow: null,
    done: false,
    plan: plan as TaskOccurrenceSnapshot['plan'],
    title: 'Pedido',
    taskId: `task-${pedidoId}`,
    revision: 3,
    status: 'in progress',
    owner: 'u-solicitante',
    origin: { kind: 'event' },
    room: { mode: 'exclusive' },
    roomId: 'room-1',
    pass: 1,
    history: [],
  } as TaskOccurrenceSnapshot;
}

function llmEndBody(pedidoId: string, state: 'completed' | 'failed'): Record<string, unknown> {
  const taskId = `task-${pedidoId}`;
  const commandId = `${pedidoId}:pesquisar:1`;
  return {
    eventId: `${taskId}:pesquisar:llm:${commandId}`,
    scheduledAt: '2026-11-12T07:01:02.000Z',
    attempt: 1,
    ref: { project: APP_ID, module: MODULE, entity: 'Pedido', recordId: pedidoId, processId: 'processoPedido', workflowVersion: null },
    taskId,
    stepKey: 'pesquisar',
    pass: 1,
    seq: 1,
    revision: 3,
    routine: 'pesquisar',
    kind: 'llm-step-finished',
    commandId,
    state,
  };
}

const RESULTADO = JSON.stringify({
  resumo: 'Cadeira ergonômica entre R$ 900 e R$ 1.400.',
  fontes: [{ titulo: 'Loja A', url: 'https://a.example/cadeira', data: '2026-11-10', precoEstimado: 1200, moeda: 'BRL' }],
});

async function post(app: FastifyInstance, payload: unknown) {
  return app.inject({
    method: 'POST',
    url: '/exec/workflow-event',
    headers: { 'content-type': 'application/json', 'x-app-id': APP_ID, authorization: `Bearer ${TOKEN}` },
    payload: JSON.stringify(payload),
  });
}

interface Prepared {
  pedidoId: string;
  repo: { list(filter: { id: string }): Promise<Array<Record<string, unknown>>> };
  engineBound: ReturnType<typeof fakePort>;
}

async function prepare(env: Bench, llm: TaskOccurrenceLlmResult): Promise<Prepared> {
  await env.pool.query('DELETE FROM platform_workflow_wake_inbox');
  const { workflowPlans, createModuleWorkflowEngine } = await import('/_102047_/l1/wfteste/layer_1_external/adapters/workflow/engine.js');
  const { bindWorkflowEngine } = await import('/_102047_/l1/wfteste/layer_2_application/workflows/processoPedido.js');
  const { createPedidoRepository } = await import('/_102047_/l1/wfteste/layer_1_external/adapters/persistence/pedidoRepositoryAdapter.js');
  const pedidoId = randomUUID();
  const solicitanteId = randomUUID();
  const aprovadorId = randomUUID();
  const repo = createPedidoRepository(env.ctx());
  const now = '2026-11-12T07:00:00.000Z';
  await repo.create({
    id: pedidoId,
    titulo: 'Cadeira',
    descricao: 'Cadeira ergonômica',
    solicitanteId,
    aprovadorId,
    situacao: 'pesquisando',
    pesquisaCommandId: `${pedidoId}:pesquisar:1`,
    pesquisaPedidaEm: now,
    criadoEm: now,
    atualizadoEm: now,
  });
  const faked = fakePort(occurrenceAtResearch(pedidoId, workflowPlans.processoPedido), llm);
  bindWorkflowEngine(createModuleWorkflowEngine(faked.port));
  return { pedidoId, repo: repo as unknown as Prepared['repo'], engineBound: faked };
}

function dispatcher(env: Bench, port: TaskOccurrenceLlmPort) {
  // Sem `resolve`: o despachante usa o registro REAL, que carregou a raiz de composição real do wfteste.
  return createWorkflowWakeDispatcher(APP_ID, MODULE, {
    port,
    now: () => new Date('2026-11-12T07:01:03Z'),
    companyId: () => 'company-canonical',
    readIntegration: () => ({ organizationId: 'org-1' }),
    createContext: () => env.ctx(),
  });
}

async function inboxRow(env: Bench, eventId: string) {
  const rows = await env.pool.query(
    'SELECT "state", "outcome", "attempts", "lastErrorCode", "payload" FROM platform_workflow_wake_inbox WHERE "eventId" = $1',
    [eventId],
  );
  return rows.rows[0] as { state: string; outcome: string | null; attempts: number; lastErrorCode: string | null; payload: Record<string, unknown> };
}

test('rt212 s3: o aviso de LLM concluído leva o pedido a aguardandoAprovacao no banco e a Task a aprovar', { skip: !integration, timeout: 60000 }, async () => serial(async () => {
  const env = await benchOnce();
  const prepared = await prepare(env, { state: 'completed', result: RESULTADO });
  const body = llmEndBody(prepared.pedidoId, 'completed');
  const eventId = String(body.eventId);

  const accepted = await post(env.app, body);
  assert.equal(accepted.statusCode, 202, accepted.body);
  const stored = await inboxRow(env, eventId);
  assert.equal(stored.state, 'pending');
  assert.equal(stored.payload.kind, 'llm-step-finished');
  assert.equal(stored.payload.commandId, `${prepared.pedidoId}:pesquisar:1`);
  assert.equal(stored.payload.state, 'completed');

  const result = await env.inbox.runNext(APP_ID, (event) => dispatcher(env, prepared.engineBound.port).dispatch(event));
  assert.equal(result, 'accepted');
  assert.equal(await env.inbox.runNext(APP_ID, async () => 'accepted'), 'empty');

  const row = (await prepared.repo.list({ id: prepared.pedidoId }))[0];
  assert.equal(row.situacao, 'aguardandoAprovacao');
  assert.equal((row.resultadoPesquisa as { resumo: string }).resumo, 'Cadeira ergonômica entre R$ 900 e R$ 1.400.');
  assert.equal(prepared.engineBound.reads.length, 1);
  assert.equal(prepared.engineBound.reads[0].commandId, `${prepared.pedidoId}:pesquisar:1`);
  assert.equal(prepared.engineBound.advances.length, 1);
  const advance = prepared.engineBound.advances[0];
  assert.equal(advance.from, 'pesquisar');
  assert.equal(advance.to, 'aprovar');
  assert.equal(advance.actorNow, row.aprovadorId);
  assert.equal(advance.commandId, workflowWakeCommandId(eventId));
  assert.equal(prepared.engineBound.current().step, 'aprovar');

  const done = await inboxRow(env, eventId);
  assert.equal(done.state, 'completed');
  assert.equal(done.outcome, 'accepted');
  assert.equal(done.attempts, 1);

  // o mesmo aviso de novo: 200 e nada muda
  const repeated = await post(env.app, body);
  assert.equal(repeated.statusCode, 200, repeated.body);
  assert.equal(prepared.engineBound.advances.length, 1);
}));

test('rt212 s3: o aviso de LLM com falha leva o pedido a devolvido e a Task de volta a preencher', { skip: !integration, timeout: 60000 }, async () => serial(async () => {
  const env = await benchOnce();
  const prepared = await prepare(env, { state: 'failed', failure: { code: 'llm_error', message: 'A pesquisa não respondeu.' } });
  const body = llmEndBody(prepared.pedidoId, 'failed');
  const eventId = String(body.eventId);

  assert.equal((await post(env.app, body)).statusCode, 202);
  const result = await env.inbox.runNext(APP_ID, (event) => dispatcher(env, prepared.engineBound.port).dispatch(event));
  assert.equal(result, 'accepted');

  const row = (await prepared.repo.list({ id: prepared.pedidoId }))[0];
  assert.equal(row.situacao, 'devolvido');
  assert.equal(row.motivoDevolucao, 'A pesquisa não respondeu.');
  assert.equal(prepared.engineBound.advances.length, 1);
  const advance = prepared.engineBound.advances[0];
  assert.equal(advance.from, 'pesquisar');
  assert.equal(advance.to, 'preencher');
  assert.equal(advance.actorNow, row.solicitanteId);
  const done = await inboxRow(env, eventId);
  assert.equal(done.state, 'completed');
  assert.equal(done.outcome, 'accepted');
}));
