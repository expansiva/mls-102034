/// <mls fileReference="_102034_/l1/workflow/memoryOccurrence.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import cluster from 'node:cluster';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { OccurrenceContext, OccurrenceRef } from '/_102034_/l1/workflow/contracts.js';
import { createMemoryOccurrencePort } from '/_102034_/l1/workflow/memoryOccurrence.js';

const probing = process.env.MEMORY_TOPOLOGY_PROBE === '1';

function declare(name: string, fn: () => Promise<void> | void): void {
  if (!probing) test(name, fn);
}

if (probing) {
  if (process.env.PROBE_MODE === 'cluster-worker' && cluster.isPrimary) {
    const worker = cluster.fork();
    worker.on('exit', (code) => process.exit(code ?? 1));
  } else {
    void (async () => {
      try {
        const port = createMemoryOccurrencePort();
        if (process.env.PROBE_MODE === 'use') {
          await port.open(
            { clock: { nowIso: () => '2026-10-18T00:00:00.000Z' } },
            {
              project: '10',
              module: 'tarefas',
              processId: 'ciclo',
              entity: 'Tarefa',
              recordId: 'r1',
              workflowVersion: 'rel-1',
            },
            'S',
            'A',
            null,
          );
        }
        process.stdout.write(JSON.stringify({ ok: true }));
      } catch (error) {
        const code = error instanceof AppError ? error.code : 'THROWN';
        const details = error instanceof AppError ? error.details : undefined;
        const workerCount = details && typeof details === 'object' && 'workerCount' in details
          ? details.workerCount
          : undefined;
        process.stdout.write(JSON.stringify({ ok: false, code, workerCount }));
      }
      process.exit(0);
    })();
  }
}

function ctx(now = '2026-10-17T12:00:00.000Z'): OccurrenceContext {
  return { clock: { nowIso: () => now } };
}

function ref(overrides: Partial<OccurrenceRef> = {}): OccurrenceRef {
  return {
    project: '10',
    module: 'tarefas',
    processId: 'ciclo',
    entity: 'Tarefa',
    recordId: 'r1',
    workflowVersion: 'rel-1',
    ...overrides,
  };
}

declare('two concurrent opens create one occurrence', async () => {
  const port = createMemoryOccurrencePort();
  const [a, b] = await Promise.all([
    port.open(ctx(), ref(), 'S', 'A', 'person-1'),
    port.open(ctx(), ref({ workflowVersion: 'rel-2' }), 'Z', 'B', 'person-2'),
  ]);
  const outcomes = [a.outcome, b.outcome].sort();
  assert.deepEqual(outcomes, ['created', 'existing']);
  assert.equal(a.occurrence.step, b.occurrence.step);
  assert.equal(a.occurrence.ref.workflowVersion, 'rel-1');
  assert.equal(b.occurrence.ref.workflowVersion, 'rel-1');
  assert.equal(a.occurrence.history.length, 1);
  assert.equal(b.occurrence.history.length, 1);
});

declare('a later release of the same reference keeps the birth version', async () => {
  const port = createMemoryOccurrencePort();
  const created = await port.open(ctx(), ref({ workflowVersion: null }), 'S', 'A', null);
  const again = await port.open(ctx(), ref({ workflowVersion: 'rel-9' }), 'S', 'B', 'x');
  assert.equal(created.outcome, 'created');
  assert.equal(created.occurrence.ref.workflowVersion, null);
  assert.equal(again.outcome, 'existing');
  assert.equal(again.occurrence.ref.workflowVersion, null);
  assert.equal(again.occurrence.actorNow, 'A');
  assert.equal(again.occurrence.history.length, 1);
});

declare('project, module, process, entity and record isolate occurrences', async () => {
  const port = createMemoryOccurrencePort();
  await port.open(ctx(), ref(), 'S', 'A', null);
  const axes: Partial<OccurrenceRef>[] = [
    { project: '11' },
    { module: 'compras' },
    { processId: 'outro' },
    { entity: 'Pedido' },
    { recordId: 'r2' },
  ];
  for (const axis of axes) {
    const opened = await port.open(ctx(), ref(axis), 'T', 'B', null);
    assert.equal(opened.outcome, 'created');
    assert.equal(opened.occurrence.step, 'T');
  }
  const original = await port.find(ctx(), ref());
  assert.equal(original?.step, 'S');
  assert.equal(original?.actorNow, 'A');
});

declare('two port instances do not share records', async () => {
  const left = createMemoryOccurrencePort();
  const right = createMemoryOccurrencePort();
  await left.open(ctx(), ref(), 'S', 'A', null);
  assert.equal(await right.find(ctx(), ref()), null);
  const opened = await right.open(ctx(), ref(), 'T', 'B', null);
  assert.equal(opened.outcome, 'created');
  assert.equal((await left.find(ctx(), ref()))?.step, 'S');
});

declare('two fronts S→A and S→B: one advances, the other conflicts', async () => {
  const port = createMemoryOccurrencePort();
  await port.open(ctx(), ref(), 'S', null, null);
  const [first, second] = await Promise.all([
    port.advance(ctx('t1'), ref(), { from: 'S', to: 'A', actorNow: 'A', done: false, by: 'p' }),
    port.advance(ctx('t2'), ref(), { from: 'S', to: 'B', actorNow: 'B', done: false, by: 'q' }),
  ]);
  const outcomes = [first.outcome, second.outcome].sort();
  assert.deepEqual(outcomes, ['advanced', 'conflict']);
  assert.equal(first.occurrence.step, second.occurrence.step);
  assert.equal(first.occurrence.history.length, 2);
  const stored = await port.find(ctx(), ref());
  assert.equal(stored?.history.length, 2);
  assert.notEqual(stored?.step, 'B');
  assert.equal(stored?.step, 'A');
});

declare('retry of an applied passage is unchanged and ignores from and note', async () => {
  const port = createMemoryOccurrencePort();
  await port.open(ctx(), ref(), 'S', 'A', null);
  const applied = await port.advance(ctx('t1'), ref(), {
    from: 'S', to: 'A', actorNow: 'A', done: false, note: 'first', by: 'p',
  });
  assert.equal(applied.outcome, 'advanced');
  const retry = await port.advance(ctx('t2'), ref(), {
    from: 'WRONG', to: 'A', actorNow: 'A', done: false, note: 'other', by: 'other',
  });
  assert.equal(retry.outcome, 'unchanged');
  assert.equal(retry.occurrence.history.length, 2);
  assert.equal(retry.occurrence.history[1]?.note, 'first');
  assert.equal(retry.occurrence.history[1]?.by, 'p');
});

declare('A→B→C on the same step records each actor, and the retry of C does not', async () => {
  const port = createMemoryOccurrencePort();
  await port.open(ctx('t0'), ref(), 'executar', 'A', null);
  const toB = await port.advance(ctx('t1'), ref(), {
    from: 'executar', to: 'executar', actorNow: 'B', done: false, by: 'p',
  });
  const toC = await port.advance(ctx('t2'), ref(), {
    from: 'executar', to: 'executar', actorNow: 'C', done: false, by: 'p',
  });
  const retryC = await port.advance(ctx('t3'), ref(), {
    from: 'executar', to: 'executar', actorNow: 'C', done: false, by: 'p',
  });
  assert.equal(toB.outcome, 'advanced');
  assert.equal(toC.outcome, 'advanced');
  assert.equal(retryC.outcome, 'unchanged');
  assert.deepEqual(retryC.occurrence.history.map(entry => entry.actorNow), ['A', 'B', 'C']);
});

declare('changing done writes, and retrying the close stays unchanged', async () => {
  const port = createMemoryOccurrencePort();
  await port.open(ctx(), ref(), 'S', 'A', null);
  const closed = await port.advance(ctx('t1'), ref(), {
    from: 'S', to: 'end', actorNow: 'A', done: true, by: null,
  });
  const retry = await port.advance(ctx('t2'), ref(), {
    from: 'elsewhere', to: 'end', actorNow: 'A', done: true, by: 'ignored',
  });
  assert.equal(closed.outcome, 'advanced');
  assert.equal(closed.occurrence.done, true);
  assert.equal(retry.outcome, 'unchanged');
  assert.equal(retry.occurrence.history.length, 2);
});

declare('reopening a closed occurrence is refused', async () => {
  const port = createMemoryOccurrencePort();
  await port.open(ctx(), ref(), 'S', 'A', null);
  await port.advance(ctx(), ref(), { from: 'S', to: 'end', actorNow: 'A', done: true, by: null });
  await assert.rejects(
    () => port.advance(ctx(), ref(), { from: 'end', to: 'end', actorNow: 'A', done: false, by: null }),
    (error: unknown) => error instanceof AppError && error.code === 'OCCURRENCE_CLOSED' && error.statusCode === 409,
  );
  const stored = await port.find(ctx(), ref());
  assert.equal(stored?.done, true);
  assert.equal(stored?.history.length, 2);
});

declare('advance of a missing occurrence is OCCURRENCE_NOT_FOUND and find is null', async () => {
  const port = createMemoryOccurrencePort();
  assert.equal(await port.find(ctx(), ref()), null);
  await assert.rejects(
    () => port.advance(ctx(), ref(), { from: 'S', to: 'A', actorNow: null, done: false, by: null }),
    (error: unknown) => error instanceof AppError && error.code === 'OCCURRENCE_NOT_FOUND' && error.statusCode === 404,
  );
});

declare('returned snapshots cannot mutate the stored ref or history', async () => {
  const port = createMemoryOccurrencePort();
  const opened = await port.open(ctx(), ref(), 'S', 'A', 'p');
  opened.occurrence.ref.project = 'mutated';
  opened.occurrence.ref.workflowVersion = 'mutated';
  opened.occurrence.history.push({
    at: 'x', by: 'x', from: 'x', step: 'x', actorNow: 'x', done: true,
  });
  opened.occurrence.step = 'x';
  const stored = await port.find(ctx(), ref());
  assert.equal(stored?.ref.project, '10');
  assert.equal(stored?.ref.workflowVersion, 'rel-1');
  assert.equal(stored?.step, 'S');
  assert.equal(stored?.history.length, 1);
  stored!.history[0]!.note = 'leaked';
  const again = await port.find(ctx(), ref());
  assert.equal(again?.history[0]?.note, undefined);
});

function probe(env: Record<string, string | undefined>): Promise<{ ok?: boolean, code?: string, workerCount?: unknown }> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, MEMORY_TOPOLOGY_PROBE: '1' };
  delete childEnv.COLLAB_WORKER_COUNT;
  delete childEnv.NODE_APP_INSTANCE;
  delete childEnv.PROBE_MODE;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }
  const execArgv = process.execArgv.filter((arg) => arg !== '--test');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...execArgv, fileURLToPath(import.meta.url)], {
      cwd: process.cwd(),
      env: childEnv,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`topology probe timed out: ${stderr}`));
    }, 15000);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (status) => {
      clearTimeout(timer);
      if (status !== 0) reject(new Error(`probe status ${status}: ${stderr || stdout}`));
      else resolve(JSON.parse(stdout.trim()) as { ok?: boolean, code?: string, workerCount?: unknown });
    });
  });
}

declare('announced worker counts 1, 2, 0 and invalid', async () => {
  assert.deepEqual(await probe({ COLLAB_WORKER_COUNT: '1', PROBE_MODE: 'use' }), { ok: true });
  assert.deepEqual(await probe({ COLLAB_WORKER_COUNT: '2' }), {
    ok: false,
    code: 'WORKFLOW_MEMORY_REQUIRES_SINGLE_WORKER',
    workerCount: '2',
  });
  assert.deepEqual(await probe({ COLLAB_WORKER_COUNT: '0' }), {
    ok: false,
    code: 'WORKFLOW_RUNTIME_TOPOLOGY_INVALID',
    workerCount: '0',
  });
  assert.deepEqual(await probe({ COLLAB_WORKER_COUNT: '' }), {
    ok: false,
    code: 'WORKFLOW_RUNTIME_TOPOLOGY_INVALID',
    workerCount: '',
  });
  assert.deepEqual(await probe({ COLLAB_WORKER_COUNT: 'nope' }), {
    ok: false,
    code: 'WORKFLOW_RUNTIME_TOPOLOGY_INVALID',
    workerCount: 'nope',
  });
});

declare('NODE_APP_INSTANCE=0 without a total is refused, and an isolated node is allowed', async () => {
  assert.deepEqual(await probe({ NODE_APP_INSTANCE: '0' }), {
    ok: false,
    code: 'WORKFLOW_RUNTIME_TOPOLOGY_INVALID',
  });
  assert.deepEqual(await probe({}), { ok: true });
  assert.deepEqual(await probe({ PROBE_MODE: 'cluster-worker' }), {
    ok: false,
    code: 'WORKFLOW_RUNTIME_TOPOLOGY_INVALID',
  });
});
