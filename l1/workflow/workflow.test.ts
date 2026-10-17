/// <mls fileReference="_102034_/l1/workflow/workflow.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { resetRunningReleaseCache } from '/_102034_/l1/server/layer_1_external/cbe/cbeRelease.js';
import {
  createMemoryOccurrencePort,
  createOccurrenceContext,
  createWorkflowEngine,
  occurrenceRecordId,
  type OccurrencePort,
  type WorkflowEngine,
  type WorkflowTable,
} from '/_102034_/l1/workflow/index.js';

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
