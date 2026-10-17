/// <mls fileReference="_102034_/l1/workflow/engine.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { ILogger } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  getRunningRelease,
  resetRunningReleaseCache,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeRelease.js';
import type {
  OccurrenceKey,
  OccurrencePort,
  WorkflowStepKind,
  WorkflowTable,
} from '/_102034_/l1/workflow/contracts.js';
import { createWorkflowEngine, ownerOf, type WorkflowEngineContext } from '/_102034_/l1/workflow/engine.js';
import { createMemoryOccurrencePort } from '/_102034_/l1/workflow/memoryOccurrence.js';

function logger(): ILogger & { lines: { message: string; data?: unknown }[] } {
  const lines: { message: string; data?: unknown }[] = [];
  return {
    lines,
    info(message, data) { lines.push({ message, data }); },
    error(message, data) { lines.push({ message, data }); },
  };
}

function ctx(person?: string): WorkflowEngineContext & { log: ReturnType<typeof logger> } {
  const log = logger();
  return {
    clock: { nowIso: () => '2026-10-17T12:00:00.000Z' },
    log,
    ...(person ? { sessionContext: { person: { mdmId: person } } } : {}),
  };
}

function key(overrides: Partial<OccurrenceKey> = {}): OccurrenceKey {
  return {
    project: '10',
    module: 'tarefas',
    processId: 'ciclo',
    entity: 'Tarefa',
    recordId: 'r1',
    ...overrides,
  };
}

function table(steps: WorkflowTable['steps'], processId = 'ciclo'): WorkflowTable {
  return { processId, steps };
}

function step(
  stepId: string,
  kind: WorkflowStepKind,
  next: string[],
): WorkflowTable['steps'][number] {
  return { stepId, kind, next };
}

const loop = table([
  step('S', 'human', ['A']),
  step('A', 'wait', ['B']),
  step('B', 'mechanical', ['A']),
]);

const chain = table([
  step('wait', 'wait', ['mechanical']),
  step('mechanical', 'mechanical', ['human']),
  step('human', 'human', []),
]);

async function withRelease(id: string | null, run: () => Promise<void>): Promise<void> {
  const previous = process.cwd();
  const root = mkdtempSync(join(tmpdir(), 'wf-release-'));
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

test('ownerOf maps kind to person, module, agent or clock', () => {
  assert.equal(ownerOf('human'), 'person');
  assert.equal(ownerOf('alert'), 'person');
  assert.equal(ownerOf('mechanical'), 'module');
  assert.equal(ownerOf('llm'), 'agent');
  assert.equal(ownerOf('wait'), 'clock');
});

test('open stamps the running release and a repeat keeps the birth version', async () => {
  await withRelease('rel-real', async () => {
    assert.equal(getRunningRelease()?.id, 'rel-real');
    const engine = createWorkflowEngine(createMemoryOccurrencePort());
    const caller = ctx('person-1');
    const opened = await engine.open(caller, loop, key(), 'S', 'ada');
    assert.equal(opened.outcome, 'created');
    assert.equal(opened.occurrence.ref.workflowVersion, 'rel-real');
    assert.equal(opened.occurrence.history[0]?.by, 'person-1');
    assert.equal(caller.log.lines.length, 0);

    await withRelease('rel-later', async () => {
      const again = await engine.open(caller, loop, key(), 'A', 'bee');
      assert.equal(again.outcome, 'existing');
      assert.equal(again.occurrence.ref.workflowVersion, 'rel-real');
      assert.equal(again.occurrence.step, 'S');
      assert.equal(again.occurrence.history.length, 1);
    });
  });
});

test('a missing release is stored as null and logged without a submission key', async () => {
  await withRelease(null, async () => {
    assert.equal(getRunningRelease(), null);
    const engine = createWorkflowEngine(createMemoryOccurrencePort());
    const caller = ctx();
    const opened = await engine.open(caller, loop, key(), 'S', null);
    assert.equal(opened.occurrence.ref.workflowVersion, null);
    assert.equal(caller.log.lines.length, 1);
    assert.equal(caller.log.lines[0]?.message, 'WORKFLOW_VERSION_UNKNOWN');
    const data = caller.log.lines[0]?.data as Record<string, unknown>;
    assert.deepEqual(data, {
      project: '10',
      module: 'tarefas',
      processId: 'ciclo',
      entity: 'Tarefa',
      recordId: 'r1',
    });
  });
});

test('a loop, a transitive wait path, and end without a terminal step', async () => {
  await withRelease('rel-1', async () => {
    const port = createMemoryOccurrencePort();
    const engine = createWorkflowEngine(port);
    const caller = ctx('person-1');
    await engine.open(caller, loop, key(), 'S', 'ada');
    const toB = await engine.advance(caller, loop, key(), { from: 'S', to: 'B', actorNow: 'mod' });
    assert.equal(toB.outcome, 'advanced');
    assert.equal(toB.occurrence.step, 'B');
    const around = await engine.advance(caller, loop, key(), { from: 'B', to: 'A', actorNow: null });
    assert.equal(around.outcome, 'advanced');
    assert.equal(around.occurrence.step, 'A');

    await engine.open(caller, chain, key({ recordId: 'r2' }), 'wait', null);
    const jumped = await engine.advance(caller, chain, key({ recordId: 'r2' }), {
      from: 'wait',
      to: 'human',
      actorNow: 'ada',
    });
    assert.equal(jumped.outcome, 'advanced');
    assert.equal(jumped.occurrence.step, 'human');
    assert.equal(jumped.occurrence.done, false);

    const closed = await engine.advance(caller, chain, key({ recordId: 'r2' }), {
      from: 'human',
      to: 'end',
      actorNow: 'ada',
      note: 'done',
    });
    assert.equal(closed.outcome, 'advanced');
    assert.equal(closed.occurrence.step, 'end');
    assert.equal(closed.occurrence.done, true);
    assert.equal(closed.occurrence.history.at(-1)?.note, 'done');
  });
});

test('unknown and unreachable destinations do not write', async () => {
  await withRelease('rel-1', async () => {
    let advances = 0;
    const inner = createMemoryOccurrencePort();
    const port: OccurrencePort = {
      open: (c, ref, step, actorNow, by) => inner.open(c, ref, step, actorNow, by),
      find: (c, occurrenceKey) => inner.find(c, occurrenceKey),
      async advance(c, occurrenceKey, command) {
        advances += 1;
        return inner.advance(c, occurrenceKey, command);
      },
    };
    const engine = createWorkflowEngine(port);
    const caller = ctx();
    await engine.open(caller, chain, key(), 'wait', null);
    await assert.rejects(
      () => engine.advance(caller, chain, key(), { from: 'wait', to: 'missing', actorNow: null }),
      (error: unknown) => error instanceof AppError && error.code === 'UNKNOWN_STEP',
    );
    await assert.rejects(
      () => engine.advance(caller, chain, key(), { from: 'human', to: 'wait', actorNow: null }),
      (error: unknown) => error instanceof AppError && error.code === 'UNREACHABLE_STEP',
    );
    assert.equal(advances, 0);
    assert.equal((await engine.find(caller, key()))?.step, 'wait');
  });
});

test('the same step accepts another actor and a repeated close stays unchanged', async () => {
  await withRelease('rel-1', async () => {
    const engine = createWorkflowEngine(createMemoryOccurrencePort());
    const caller = ctx('person-1');
    await engine.open(caller, chain, key(), 'human', 'ada');
    const moved = await engine.advance(caller, chain, key(), { from: 'human', to: 'human', actorNow: 'bee' });
    assert.equal(moved.outcome, 'advanced');
    assert.equal(moved.occurrence.actorNow, 'bee');
    assert.equal(moved.occurrence.step, 'human');
    assert.equal(moved.occurrence.history.length, 2);
    const again = await engine.advance(caller, chain, key(), { from: 'human', to: 'human', actorNow: 'bee' });
    assert.equal(again.outcome, 'unchanged');
    assert.equal(again.occurrence.history.length, 2);

    const closed = await engine.advance(caller, chain, key(), { from: 'human', to: 'end', actorNow: 'bee' });
    assert.equal(closed.outcome, 'advanced');
    const retry = await engine.advance(caller, chain, key(), { from: 'human', to: 'end', actorNow: 'bee' });
    assert.equal(retry.outcome, 'unchanged');
    assert.equal(retry.occurrence.step, 'end');
    assert.equal(retry.occurrence.history.length, 3);
  });
});

test('a retry with the old origin returns the current state', async () => {
  await withRelease('rel-1', async () => {
    const engine = createWorkflowEngine(createMemoryOccurrencePort());
    const caller = ctx();
    await engine.open(caller, chain, key(), 'wait', null);
    const first = await engine.advance(caller, chain, key(), { from: 'wait', to: 'mechanical', actorNow: 'mod' });
    assert.equal(first.outcome, 'advanced');
    const retry = await engine.advance(caller, chain, key(), { from: 'wait', to: 'mechanical', actorNow: 'mod' });
    assert.equal(retry.outcome, 'unchanged');
    const other = await engine.advance(caller, chain, key(), { from: 'wait', to: 'human', actorNow: 'ada' });
    assert.equal(other.outcome, 'conflict');
    assert.equal(other.occurrence.step, 'mechanical');
    assert.equal(other.occurrence.history.length, 2);
  });
});

test('a birth release stays valid when the running release changes', async () => {
  const port = createMemoryOccurrencePort();
  const engine = createWorkflowEngine(port);
  const caller = ctx();
  await withRelease('birth', async () => {
    const opened = await engine.open(caller, chain, key(), 'wait', null);
    assert.equal(opened.occurrence.ref.workflowVersion, 'birth');
  });
  await withRelease('current', async () => {
    const moved = await engine.advance(caller, chain, key(), {
      from: 'wait',
      to: 'mechanical',
      actorNow: 'mod',
    });
    assert.equal(moved.outcome, 'advanced');
    assert.equal(moved.occurrence.ref.workflowVersion, 'birth');
    assert.equal(getRunningRelease()?.id, 'current');
  });
});

test('a recorded step removed from the table is not migrated', async () => {
  await withRelease('rel-1', async () => {
    let advances = 0;
    const inner = createMemoryOccurrencePort();
    const port: OccurrencePort = {
      open: (c, ref, stepId, actorNow, by) => inner.open(c, ref, stepId, actorNow, by),
      find: (c, occurrenceKey) => inner.find(c, occurrenceKey),
      async advance(c, occurrenceKey, command) {
        advances += 1;
        return inner.advance(c, occurrenceKey, command);
      },
    };
    const engine = createWorkflowEngine(port);
    const caller = ctx();
    await engine.open(caller, loop, key(), 'S', 'ada');
    const reduced = table([step('A', 'wait', ['B']), step('B', 'mechanical', ['A'])]);
    await assert.rejects(
      () => engine.advance(caller, reduced, key(), { from: 'A', to: 'B', actorNow: null }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'STEP_NOT_IN_TABLE');
        assert.equal(error.statusCode, 409);
        assert.deepEqual(error.details, {
          step: 'S',
          birthVersion: 'rel-1',
          currentVersion: 'rel-1',
        });
        return true;
      },
    );
    assert.equal(advances, 0);
    assert.equal((await engine.find(caller, key()))?.step, 'S');
    assert.equal((await engine.find(caller, key()))?.history.length, 1);
  });
});

test('two engines do not share a port unless one is passed to both', async () => {
  await withRelease(null, async () => {
    const left = createWorkflowEngine(createMemoryOccurrencePort());
    const right = createWorkflowEngine(createMemoryOccurrencePort());
    const caller = ctx();
    await left.open(caller, loop, key(), 'S', null);
    assert.equal(await right.find(caller, key()), null);
  });
});

test('a table with a reserved, duplicate, dangling or foreign id is refused', async () => {
  await withRelease(null, async () => {
    const engine = createWorkflowEngine(createMemoryOccurrencePort());
    const caller = ctx();
    const bad = [
      table([step('end', 'human', [])]),
      table([step('S', 'human', []), step('S', 'wait', [])]),
      table([step('S', 'human', ['missing'])]),
      table([step('', 'human', [])]),
      table([step('S', 'human', [])], 'outro'),
      table([{ stepId: 'S', kind: 'nope' as WorkflowStepKind, next: [] }]),
    ];
    for (const candidate of bad) {
      await assert.rejects(
        () => engine.open(caller, candidate, key(), 'S', null),
        (error: unknown) => error instanceof AppError && error.code === 'INVALID_WORKFLOW_TABLE',
      );
    }
    assert.equal(await engine.find(caller, key()), null);
  });
});
