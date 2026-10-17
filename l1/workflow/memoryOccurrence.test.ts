/// <mls fileReference="_102034_/l1/workflow/memoryOccurrence.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { OccurrenceContext, OccurrenceRef } from '/_102034_/l1/workflow/contracts.js';
import { createMemoryOccurrencePort } from '/_102034_/l1/workflow/memoryOccurrence.js';

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

test('two concurrent opens create one occurrence', async () => {
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

test('a later release of the same reference keeps the birth version', async () => {
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

test('project, module, process, entity and record isolate occurrences', async () => {
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

test('two port instances do not share records', async () => {
  const left = createMemoryOccurrencePort();
  const right = createMemoryOccurrencePort();
  await left.open(ctx(), ref(), 'S', 'A', null);
  assert.equal(await right.find(ctx(), ref()), null);
  const opened = await right.open(ctx(), ref(), 'T', 'B', null);
  assert.equal(opened.outcome, 'created');
  assert.equal((await left.find(ctx(), ref()))?.step, 'S');
});

test('two fronts S→A and S→B: one advances, the other conflicts', async () => {
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

test('retry of an applied passage is unchanged and ignores from and note', async () => {
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

test('A→B→C on the same step records each actor, and the retry of C does not', async () => {
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

test('changing done writes, and retrying the close stays unchanged', async () => {
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

test('reopening a closed occurrence is refused', async () => {
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

test('advance of a missing occurrence is OCCURRENCE_NOT_FOUND and find is null', async () => {
  const port = createMemoryOccurrencePort();
  assert.equal(await port.find(ctx(), ref()), null);
  await assert.rejects(
    () => port.advance(ctx(), ref(), { from: 'S', to: 'A', actorNow: null, done: false, by: null }),
    (error: unknown) => error instanceof AppError && error.code === 'OCCURRENCE_NOT_FOUND' && error.statusCode === 404,
  );
});

test('returned snapshots cannot mutate the stored ref or history', async () => {
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
