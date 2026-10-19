/// <mls fileReference="_102034_/l1/workflow/workflow.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { resetRunningReleaseCache } from '/_102034_/l1/server/layer_1_external/cbe/cbeRelease.js';
import { ownerOf as ownerOfEngine } from '/_102034_/l1/workflow/engine.js';
import {
  createMemoryOccurrencePort,
  createOccurrenceContext,
  createWorkflowEngine,
  occurrenceRecordId,
  ownerOf,
  prepareWorkflowPlan,
  type OccurrencePort,
  type WorkflowEngine,
  type WorkflowPlan,
  type WorkflowPlanInput,
  type WorkflowPlanStep,
  type WorkflowPlanStepInput,
  type WorkflowTable,
} from '/_102034_/l1/workflow/index.js';
import {
  prepareWorkflowPlan as prepareWorkflowPlanDirect,
  type WorkflowPlan as WorkflowPlanDirect,
  type WorkflowPlanInput as WorkflowPlanInputDirect,
  type WorkflowPlanStep as WorkflowPlanStepDirect,
  type WorkflowPlanStepInput as WorkflowPlanStepInputDirect,
} from '/_102034_/l1/workflow/plan.js';

/** In-memory business records. The library does not own this store. */
interface BusinessRecord {
  id: string;
  status: string;
}

const table: WorkflowTable = {
  processId: 'ciclo',
  steps: [
    { stepId: 'S', kind: 'human', next: ['A'] },
    { stepId: 'A', kind: 'human', next: [] },
  ],
};

function requestCtx(): RequestContext {
  const ctx = createRequestContext();
  ctx.moduleId = 'tarefas';
  ctx.sessionContext.project.projectId = '10';
  ctx.sessionContext.person = { mdmId: 'person-1', email: 'a@b.c', name: 'Ada' };
  ctx.requestMeta = { requestId: 'req-recovery', userId: 'telemetry-user', source: 'test' };
  return ctx;
}

function failOnce(inner: OccurrencePort, method: 'open' | 'advance'): OccurrencePort {
  let pending = true;
  return {
    open(ctx, ref, step, actorNow, by) {
      if (method === 'open' && pending) {
        pending = false;
        throw new Error('injected open failure');
      }
      return inner.open(ctx, ref, step, actorNow, by);
    },
    find(ctx, key) {
      return inner.find(ctx, key);
    },
    advance(ctx, key, command) {
      if (method === 'advance' && pending) {
        pending = false;
        throw new Error('injected advance failure');
      }
      return inner.advance(ctx, key, command);
    },
  };
}

async function withRelease(id: string | null, run: () => Promise<void>): Promise<void> {
  const previous = process.cwd();
  const root = mkdtempSync(join(tmpdir(), 'wf-public-'));
  try {
    if (id !== null) writeFileSync(join(root, 'release.json'), JSON.stringify({ id }));
    process.chdir(root);
    resetRunningReleaseCache();
    await run();
  } finally {
    process.chdir(previous);
    resetRunningReleaseCache();
    rmSync(root, { recursive: true, force: true });
  }
}

test('the public entry has no browser global', () => {
  assert.equal('window' in globalThis, false);
  assert.equal('document' in globalThis, false);
  assert.equal(typeof prepareWorkflowPlan, 'function');
  assert.equal(typeof prepareWorkflowPlanDirect, 'function');
});

const fullPlanInput: WorkflowPlanInput = {
  processId: 'ciclo',
  title: 'Ciclo de tarefa',
  moduleTitle: 'Tarefas',
  steps: [
    {
      stepId: 'H',
      kind: 'human',
      title: 'Pessoa',
      actorRef: 'actor-ada',
      next: ['M'],
      conditions: 'when the prose stays exactly',
      params: { note: 'keep me' },
    },
    { stepId: 'M', kind: 'mechanical', title: 'Módulo', functionRef: 'fn-close', next: ['L'] },
    { stepId: 'L', kind: 'llm', title: 'Agente', journeyRef: 'journey-1', next: ['W'] },
    { stepId: 'W', kind: 'wait', title: 'Relógio', next: ['A'] },
    { stepId: 'A', kind: 'alert', title: 'Alerta', next: ['H'] },
  ],
};

test('public and direct plan imports share one preparation and one owner function', async () => {
  assert.equal(prepareWorkflowPlan, prepareWorkflowPlanDirect);
  assert.equal(ownerOf, ownerOfEngine);
  assert.equal(ownerOf('human'), 'person');
  assert.equal(ownerOfEngine('human'), 'person');
  assert.equal(ownerOf('alert'), 'person');
  assert.equal(ownerOfEngine('alert'), 'person');
  assert.equal(ownerOf('mechanical'), 'module');
  assert.equal(ownerOfEngine('mechanical'), 'module');
  assert.equal(ownerOf('llm'), 'agent');
  assert.equal(ownerOfEngine('llm'), 'agent');
  assert.equal(ownerOf('wait'), 'clock');
  assert.equal(ownerOfEngine('wait'), 'clock');

  const typed: WorkflowPlanInputDirect = fullPlanInput;
  const published: WorkflowPlan = prepareWorkflowPlan(typed);
  const direct: WorkflowPlanDirect = prepareWorkflowPlanDirect(fullPlanInput);
  const publishedStep: WorkflowPlanStep = published.steps[0];
  const directStep: WorkflowPlanStepDirect = direct.steps[0];
  const inputStep: WorkflowPlanStepInput = fullPlanInput.steps[0];
  const directInputStep: WorkflowPlanStepInputDirect = typed.steps[0];
  assert.equal(inputStep.title, directInputStep.title);
  assert.deepEqual(published, direct);
  assert.equal(published.processId, 'ciclo');
  assert.equal(published.title, 'Ciclo de tarefa');
  assert.equal(published.moduleTitle, 'Tarefas');
  assert.deepEqual(
    published.steps.map(step => [step.stepId, step.kind, step.ownerKind, step.title]),
    [
      ['H', 'human', 'person', 'Pessoa'],
      ['M', 'mechanical', 'module', 'Módulo'],
      ['L', 'llm', 'agent', 'Agente'],
      ['W', 'wait', 'clock', 'Relógio'],
      ['A', 'alert', 'person', 'Alerta'],
    ],
  );
  assert.equal(publishedStep.actorRef, 'actor-ada');
  assert.equal(published.steps[1]?.functionRef, 'fn-close');
  assert.equal(published.steps[2]?.journeyRef, 'journey-1');
  assert.equal(publishedStep.conditions, 'when the prose stays exactly');
  assert.deepEqual(publishedStep.params, { note: 'keep me' });
  assert.deepEqual(published.steps.map(step => step.next), [['M'], ['L'], ['W'], ['A'], ['H']]);
  assert.equal(directStep.ownerKind, 'person');

  const again = prepareWorkflowPlan(fullPlanInput);
  published.title = 'trocado';
  published.moduleTitle = 'outro';
  published.steps[0].title = 'outra pessoa';
  published.steps[0].conditions = 'prosa nova';
  published.steps[0].next.push('Z');
  published.steps[0].params = { note: 'mutado' };
  assert.equal(again.title, 'Ciclo de tarefa');
  assert.equal(again.moduleTitle, 'Tarefas');
  assert.equal(again.steps[0]?.title, 'Pessoa');
  assert.equal(again.steps[0]?.conditions, 'when the prose stays exactly');
  assert.deepEqual(again.steps[0]?.next, ['M']);
  assert.deepEqual(again.steps[0]?.params, { note: 'keep me' });
  assert.equal(fullPlanInput.title, 'Ciclo de tarefa');
  assert.deepEqual(fullPlanInput.steps[0]?.next, ['M']);

  const parent = requestCtx();
  const engine = createWorkflowEngine(createMemoryOccurrencePort());
  const recordId = occurrenceRecordId(parent, 'ciclo');
  assert.equal(await engine.find(parent, {
    project: '10',
    module: 'tarefas',
    processId: 'ciclo',
    entity: 'Tarefa',
    recordId,
  }), null);
});

test('partial create then partial advance recover without a second business write or history row', async () => {
  await withRelease('rel-public', async () => {
    const parent = requestCtx();
    const records = new Map<string, BusinessRecord>();
    let writes = 0;
    const recordId = occurrenceRecordId(parent, 'ciclo');
    const key = {
      project: '10',
      module: 'tarefas',
      processId: 'ciclo',
      entity: 'Tarefa',
      recordId,
    };
    const memory = createMemoryOccurrencePort();
    let engine: WorkflowEngine = createWorkflowEngine(failOnce(memory, 'open'));

    const openOccurrence = async (): Promise<void> => {
      const existing = records.get(recordId);
      if (!existing) {
        writes += 1;
        const child = createOccurrenceContext(parent, recordId);
        const createdId = child.idGenerator.newId();
        assert.equal(createdId, recordId);
        records.set(createdId, { id: createdId, status: 'aberta' });
      }
      await engine.open(parent, table, key, 'S', 'ada');
    };

    await assert.rejects(openOccurrence, /injected open failure/);
    assert.equal(writes, 1);
    assert.equal(records.get(recordId)?.status, 'aberta');
    assert.equal(await engine.find(parent, key), null);

    engine = createWorkflowEngine(memory);
    await openOccurrence();
    assert.equal(writes, 1);
    const opened = await engine.find(parent, key);
    assert.equal(opened?.step, 'S');
    assert.equal(opened?.ref.workflowVersion, 'rel-public');
    assert.equal(opened?.history.length, 1);
    assert.equal(opened?.history[0]?.from, null);
    assert.equal(opened?.history[0]?.by, 'person-1');

    const accept = async (): Promise<void> => {
      const row = records.get(recordId);
      assert.ok(row);
      if (row.status !== 'aceita') {
        writes += 1;
        row.status = 'aceita';
      }
      await engine.advance(parent, table, key, { from: 'S', to: 'A', actorNow: 'ada' });
    };

    engine = createWorkflowEngine(failOnce(memory, 'advance'));
    await assert.rejects(accept, /injected advance failure/);
    assert.equal(writes, 2);
    assert.equal(records.get(recordId)?.status, 'aceita');
    const stuck = await engine.find(parent, key);
    assert.equal(stuck?.step, 'S');
    assert.equal(stuck?.history.length, 1);

    engine = createWorkflowEngine(memory);
    await accept();
    assert.equal(writes, 2);
    const moved = await engine.find(parent, key);
    assert.equal(moved?.step, 'A');
    assert.equal(moved?.actorNow, 'ada');
    assert.equal(moved?.done, false);
    assert.equal(moved?.history.length, 2);
    assert.equal(moved?.history[1]?.from, 'S');
    assert.equal(moved?.history[1]?.step, 'A');
    assert.equal(moved?.history[1]?.by, 'person-1');
  });
});

test('two fronts keep one history row, the same step can change actor, and closing retries stay unchanged', async () => {
  await withRelease('rel-public', async () => {
    const parent = requestCtx();
    const engine = createWorkflowEngine(createMemoryOccurrencePort());
    const recordId = occurrenceRecordId(parent, 'ciclo');
    const key = {
      project: '10',
      module: 'tarefas',
      processId: 'ciclo',
      entity: 'Tarefa',
      recordId,
    };
    await engine.open(parent, table, key, 'S', 'ada');
    const [left, right] = await Promise.all([
      engine.advance(parent, table, key, { from: 'S', to: 'A', actorNow: 'ada' }),
      engine.advance(parent, table, key, { from: 'S', to: 'A', actorNow: 'bee' }),
    ]);
    const outcomes = [left.outcome, right.outcome].sort();
    assert.deepEqual(outcomes, ['advanced', 'conflict']);
    const winner = left.outcome === 'advanced' ? left : right;
    const loser = left.outcome === 'conflict' ? left : right;
    assert.equal(loser.occurrence.step, 'A');
    assert.equal(loser.occurrence.actorNow, winner.occurrence.actorNow);
    assert.equal(loser.occurrence.history.length, winner.occurrence.history.length);
    assert.equal(winner.occurrence.history.filter(entry => entry.step === 'A').length, 1);
    assert.equal(winner.occurrence.history.filter(entry => entry.from === 'S').length, 1);

    const toBee = await engine.advance(parent, table, key, { from: 'A', to: 'A', actorNow: 'bee' });
    const toCid = await engine.advance(parent, table, key, { from: 'A', to: 'A', actorNow: 'cid' });
    const retryCid = await engine.advance(parent, table, key, { from: 'A', to: 'A', actorNow: 'cid' });
    assert.equal(toBee.outcome, 'advanced');
    assert.equal(toCid.outcome, 'advanced');
    assert.equal(retryCid.outcome, 'unchanged');
    assert.equal(toCid.occurrence.step, 'A');
    assert.equal(retryCid.occurrence.history.length, toCid.occurrence.history.length);
    assert.deepEqual(
      retryCid.occurrence.history.slice(-2).map(entry => entry.actorNow),
      ['bee', 'cid'],
    );

    const closed = await engine.advance(parent, table, key, { from: 'A', to: 'end', actorNow: 'cid' });
    const retryClose = await engine.advance(parent, table, key, { from: 'A', to: 'end', actorNow: 'cid' });
    assert.equal(closed.outcome, 'advanced');
    assert.equal(closed.occurrence.done, true);
    assert.equal(closed.occurrence.step, 'end');
    assert.equal(retryClose.outcome, 'unchanged');
    assert.equal(retryClose.occurrence.history.length, closed.occurrence.history.length);
    assert.equal(retryClose.occurrence.history.at(-1)?.done, true);
    assert.equal(retryClose.occurrence.history.at(-1)?.step, 'end');
  });
});

test('a null running release stays null on the public snapshot', async () => {
  await withRelease(null, async () => {
    const parent = requestCtx();
    const engine = createWorkflowEngine(createMemoryOccurrencePort());
    const recordId = occurrenceRecordId(parent, 'ciclo');
    const opened = await engine.open(parent, table, {
      project: '10',
      module: 'tarefas',
      processId: 'ciclo',
      entity: 'Tarefa',
      recordId,
    }, 'S', null);
    assert.equal(opened.occurrence.ref.workflowVersion, null);
    assert.equal(Object.prototype.hasOwnProperty.call(opened.occurrence.ref, 'workflowVersion'), true);
    const found = await engine.find(parent, opened.occurrence.ref);
    assert.equal(found?.ref.workflowVersion, null);
  });
});

const publicComposition = `
import { createMemoryOccurrencePort, createWorkflowEngine } from '/_102034_/l1/workflow/index.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

const engines = {
  cicloTarefa: createWorkflowEngine(createMemoryOccurrencePort()),
  avisoDiario: createWorkflowEngine(createMemoryOccurrencePort()),
  liberacaoAcessoPessoa: createWorkflowEngine(createMemoryOccurrencePort()),
};

console.log('WF_PUBLIC_LOADED');

void main();

async function main() {
const table = {
  processId: 'ciclo',
  steps: [
    { stepId: 'S', kind: 'human', next: ['A'] },
    { stepId: 'A', kind: 'human', next: [] },
  ],
};
const key = {
  project: '10',
  module: 'tarefas',
  processId: 'ciclo',
  entity: 'Tarefa',
  recordId: 'r-public',
};
const ctx = {
  clock: { nowIso() { throw new Error('clock touched'); } },
  log: { info() {}, warn() {}, error() {}, debug() {} },
};

function refusal(error) {
  if (!(error instanceof AppError)) {
    return { code: error instanceof Error ? error.message : 'THROWN', statusCode: 0 };
  }
  const details = error.details && typeof error.details === 'object' ? error.details : {};
  return { code: error.code, statusCode: error.statusCode, details };
}

const refusals = [];
for (const [name, engine] of Object.entries(engines)) {
  for (const method of ['find', 'open', 'advance']) {
    try {
      if (method === 'find') await engine.find(ctx, key);
      else if (method === 'open') await engine.open(ctx, table, key, 'S', 'ada');
      else await engine.advance(ctx, table, key, { from: 'S', to: 'A', actorNow: 'ada' });
      refusals.push({ engine: name, method, code: 'ALLOWED' });
    } catch (error) {
      refusals.push({ engine: name, method, ...refusal(error) });
    }
  }
}

delete process.env.COLLAB_WORKER_COUNT;
delete process.env.NODE_APP_INSTANCE;
const stored = {};
for (const [name, engine] of Object.entries(engines)) {
  stored[name] = await engine.find(ctx, key);
}
console.log(JSON.stringify({ engines: Object.keys(engines).sort(), refusals, stored }));
}
`;

function publicLoad(env: Record<string, string | undefined>): Promise<{ marker: string, report: {
  engines: string[],
  refusals: Array<{ engine: string, method: string, code: string, statusCode: number, details?: Record<string, unknown> }>,
  stored: Record<string, null>,
} }> {
  const root = mkdtempSync(join(tmpdir(), 'wf-public-load-'));
  const file = join(root, 'compose.ts');
  writeFileSync(file, publicComposition);
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.COLLAB_WORKER_COUNT;
  delete childEnv.NODE_APP_INSTANCE;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }
  const execArgv = process.execArgv.filter((arg) => arg !== '--test');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...execArgv, file], { cwd: process.cwd(), env: childEnv });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`public load timed out: ${stderr}`));
    }, 15000);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (status) => {
      clearTimeout(timer);
      rmSync(root, { recursive: true, force: true });
      if (status !== 0) {
        reject(new Error(`public load status ${status}: ${stderr || stdout}`));
        return;
      }
      const lines = stdout.trim().split('\n');
      const marker = lines[0] ?? '';
      try {
        resolve({ marker, report: JSON.parse(lines.at(-1) ?? '') });
      } catch (error) {
        reject(new Error(`public load output: ${stdout}\n${error}`));
      }
    });
  });
}

test('public composition loads under an incompatible topology and every engine operation refuses before writing', async () => {
  const cases = [
    {
      env: { COLLAB_WORKER_COUNT: '2' },
      code: 'WORKFLOW_MEMORY_REQUIRES_SINGLE_WORKER',
      details: { workerCount: '2' },
    },
    {
      env: { NODE_APP_INSTANCE: '0' },
      code: 'WORKFLOW_RUNTIME_TOPOLOGY_INVALID',
      details: { nodeAppInstance: '0' },
    },
  ];
  for (const entry of cases) {
    const { marker, report } = await publicLoad(entry.env);
    assert.equal(marker, 'WF_PUBLIC_LOADED');
    assert.deepEqual(report.engines, ['avisoDiario', 'cicloTarefa', 'liberacaoAcessoPessoa']);
    assert.equal(report.refusals.length, 9);
    for (const refusal of report.refusals) {
      assert.equal(refusal.code, entry.code);
      assert.equal(refusal.statusCode, 500);
      assert.deepEqual(refusal.details, entry.details);
    }
    assert.deepEqual(report.stored, {
      cicloTarefa: null,
      avisoDiario: null,
      liberacaoAcessoPessoa: null,
    });
  }
});
