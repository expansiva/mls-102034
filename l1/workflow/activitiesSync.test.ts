/// <mls fileReference="_102034_/l1/workflow/activitiesSync.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { WorkflowActivityStore } from '/_102034_/l1/workflow/activitiesStore.js';
import { withWorkflowActivityProjection } from '/_102034_/l1/workflow/activitiesSync.js';
import type {
  OccurrenceKey,
  TaskOccurrenceAdvanceCommand,
  TaskOccurrenceAdvanceResult,
  TaskOccurrenceMessageStatus,
  TaskOccurrenceOpenCommand,
  TaskOccurrenceOpenResult,
  TaskOccurrencePort,
  TaskOccurrenceSnapshot,
} from '/_102034_/l1/workflow/contracts.js';
import type { WorkflowPlan } from '/_102034_/l1/workflow/plan.js';

const KEY: OccurrenceKey = {
  project: '10',
  module: 'tarefas',
  processId: 'proc',
  entity: 'Tarefa',
  recordId: 'rec-1',
};

const PLAN: WorkflowPlan = {
  processId: 'proc',
  title: 'Proc',
  moduleTitle: 'Mod',
  steps: [{ stepId: 'tell', kind: 'human', title: 'Tell', ownerKind: 'person', next: [] }],
};

const MESSAGE: TaskOccurrenceMessageStatus = { state: 'sent', threadId: 'thread-1' };

function ctx(): RequestContext {
  return createRequestContext();
}

function occurrence(revision = 1): TaskOccurrenceSnapshot {
  return {
    ref: { ...KEY, workflowVersion: null },
    step: 'tell',
    actorNow: 'person-a',
    done: false,
    history: [],
    plan: PLAN,
    title: 'Task',
    taskId: 'task-1',
    revision,
    status: 'in progress',
    owner: 'person-a',
    origin: { kind: 'screen', by: 'person-a' },
    room: { mode: 'exclusive' },
    roomId: 'room-1',
    pass: 1,
  };
}

function openCommand(): TaskOccurrenceOpenCommand {
  const current = occurrence();
  return {
    ref: current.ref,
    plan: PLAN,
    title: current.title,
    firstStep: 'tell',
    actorNow: 'person-a',
    owner: 'person-a',
    origin: current.origin,
    executor: { kind: 'person', mdmId: 'person-a' },
    room: current.room,
    message: { content: 'hello' },
  };
}

function advanceCommand(): TaskOccurrenceAdvanceCommand {
  return {
    taskId: 'task-1',
    commandId: 'cmd-1',
    expectedRevision: 1,
    from: 'tell',
    to: 'tell',
    actorNow: 'person-a',
    done: true,
    executor: { kind: 'person', mdmId: 'person-a' },
  };
}

type RefreshMode =
  | { kind: 'ok' }
  | { kind: 'throw-before'; error: AppError }
  | { kind: 'throw-after'; error: AppError }
  | { kind: 'timeout' };

function harness(mode: RefreshMode = { kind: 'ok' }) {
  const counts = { open: 0, advance: 0, find: 0, refresh: 0 };
  const seen: TaskOccurrenceSnapshot[] = [];
  const writes: Array<TaskOccurrenceSnapshot | null> = [];
  let hang: (() => void) | undefined;
  const hung = new Promise<void>((resolve) => {
    hang = resolve;
  });

  const base: TaskOccurrencePort = {
    kind: 'task',
    async open(): Promise<TaskOccurrenceOpenResult> {
      counts.open += 1;
      return { outcome: 'created', occurrence: occurrence(1), moduleMessage: MESSAGE };
    },
    async find(): Promise<TaskOccurrenceSnapshot | null> {
      counts.find += 1;
      if (mode.kind === 'timeout') await hung;
      return occurrence(2);
    },
    async advance(): Promise<TaskOccurrenceAdvanceResult> {
      counts.advance += 1;
      return { outcome: 'unchanged', occurrence: occurrence(1), moduleMessage: MESSAGE };
    },
  };

  const store: WorkflowActivityStore = {
    projectId: '10',
    moduleId: 'tarefas',
    async refresh(_ctx, _key, loadOccurrence) {
      counts.refresh += 1;
      if (mode.kind === 'throw-before') throw mode.error;
      if (mode.kind === 'timeout') {
        let timedOut = false;
        const pending = loadOccurrence();
        pending.then((value) => {
          if (!timedOut) writes.push(value);
        }, () => undefined);
        await new Promise<never>((_resolve, reject) => {
          setTimeout(() => {
            timedOut = true;
            reject(new AppError('WORKFLOW_PROJECTION_SOURCE_TIMEOUT', 'Workflow source did not answer in time.', 504));
          }, 30_000);
        });
      }
      const loaded = await loadOccurrence();
      seen.push(loaded ?? occurrence(0));
      if (mode.kind === 'throw-after') throw mode.error;
      if (loaded === null) return { state: 'absent', occurrence: null };
      return { state: 'synced', occurrence: loaded };
    },
    async list() {
      return { items: [] };
    },
  };

  return { port: withWorkflowActivityProjection(base, store), counts, seen, writes, release: () => hang?.() };
}

function pgDown(): AppError {
  return new AppError('WORKFLOW_PROJECTION_UNAVAILABLE', 'Workflow projection could not be updated.', 503);
}

test('open and advance keep the canonical result and reread through find', async () => {
  const { port, counts, seen } = harness();
  const opened = await port.open(ctx(), openCommand());
  assert.equal(opened.outcome, 'created');
  assert.deepEqual(opened.moduleMessage, MESSAGE);
  assert.equal(opened.occurrence.revision, 1);
  assert.equal(counts.open, 1);
  assert.equal(counts.find, 1);
  assert.equal(seen[0]?.revision, 2);

  const advanced = await port.advance(ctx(), KEY, advanceCommand());
  assert.equal(advanced.outcome, 'unchanged');
  assert.deepEqual(advanced.moduleMessage, MESSAGE);
  assert.equal(counts.advance, 1);
  assert.equal(counts.open, 1);
});

test('existing, conflict and paused still refresh once', async () => {
  const outcomes = ['existing', 'conflict', 'paused'] as const;
  for (const outcome of outcomes) {
    const counts = { open: 0, advance: 0, find: 0 };
    const base: TaskOccurrencePort = {
      kind: 'task',
      async open(): Promise<TaskOccurrenceOpenResult> {
        counts.open += 1;
        return { outcome: 'existing', occurrence: occurrence(1), moduleMessage: MESSAGE };
      },
      async find() {
        counts.find += 1;
        return occurrence(3);
      },
      async advance(): Promise<TaskOccurrenceAdvanceResult> {
        counts.advance += 1;
        const advanced: TaskOccurrenceAdvanceResult['outcome'] = outcome === 'existing' ? 'unchanged' : outcome;
        return { outcome: advanced, occurrence: occurrence(1), moduleMessage: MESSAGE };
      },
    };
    const store: WorkflowActivityStore = {
      projectId: '10',
      moduleId: 'tarefas',
      async refresh(_ctx, _key, loadOccurrence) {
        await loadOccurrence();
        return { state: 'synced', occurrence: occurrence(3) };
      },
      async list() {
        return { items: [] };
      },
    };
    const port = withWorkflowActivityProjection(base, store);
    if (outcome === 'existing') {
      const opened = await port.open(ctx(), openCommand());
      assert.equal(opened.outcome, 'existing');
      assert.equal(counts.open, 1);
    } else {
      const advanced = await port.advance(ctx(), KEY, advanceCommand());
      assert.equal(advanced.outcome, outcome);
      assert.equal(counts.advance, 1);
    }
    assert.equal(counts.find, 1);
  }
});

test('a projection failure after a confirmed command does not fail the command', async () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = ((message?: unknown) => { warnings.push(String(message)); }) as typeof console.warn;
  try {
    const { port, counts } = harness({ kind: 'throw-after', error: pgDown() });
    const opened = await port.open(ctx(), openCommand());
    assert.equal(opened.outcome, 'created');
    assert.deepEqual(opened.moduleMessage, MESSAGE);
    assert.equal(counts.open, 1);
    assert.equal(counts.find, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /^\[WORKFLOW_PROJECTION_LAG\] WORKFLOW_PROJECTION_UNAVAILABLE 10\/tarefas\/proc\/Tarefa\/rec-1$/);
  } finally {
    console.warn = original;
  }
});

test('find falls back once when SQL fails before the source read', async () => {
  const { port, counts } = harness({ kind: 'throw-before', error: pgDown() });
  const found = await port.find(ctx(), KEY);
  assert.equal(found?.revision, 2);
  assert.equal(counts.find, 1);
  assert.equal(counts.refresh, 1);
});

test('find returns the read occurrence when the write fails afterwards', async () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = ((message?: unknown) => { warnings.push(String(message)); }) as typeof console.warn;
  try {
    const { port, counts } = harness({ kind: 'throw-after', error: pgDown() });
    const found = await port.find(ctx(), KEY);
    assert.equal(found?.revision, 2);
    assert.equal(counts.find, 1);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = original;
  }
});

test('a canonical source error is propagated once', async () => {
  const cases = [
    new AppError('WORKFLOW_CM_REJECTED', 'Module task was rejected.', 403),
    new AppError('WORKFLOW_CM_BUSY', 'Module task is busy.', 503),
    new AppError('WORKFLOW_PROJECTION_SOURCE_TIMEOUT', 'Workflow source did not answer in time.', 504),
  ];
  for (const error of cases) {
    let finds = 0;
    const base: TaskOccurrencePort = {
      kind: 'task',
      async open() {
        throw new Error('open');
      },
      async find() {
        finds += 1;
        throw error;
      },
      async advance() {
        throw new Error('advance');
      },
    };
    const store: WorkflowActivityStore = {
      projectId: '10',
      moduleId: 'tarefas',
      async refresh(_ctx, _key, loadOccurrence) {
        return { state: 'synced', occurrence: await loadOccurrence() };
      },
      async list() {
        return { items: [] };
      },
    };
    const port = withWorkflowActivityProjection(base, store);
    await assert.rejects(port.find(ctx(), KEY), (caught: unknown) => caught === error);
    assert.equal(finds, 1);
  }
});

test('a confirmed absence is returned from refresh', async () => {
  const base: TaskOccurrencePort = {
    kind: 'task',
    async open() {
      throw new Error('open');
    },
    async find() {
      return null;
    },
    async advance() {
      throw new Error('advance');
    },
  };
  const store: WorkflowActivityStore = {
    projectId: '10',
    moduleId: 'tarefas',
    async refresh(_ctx, _key, loadOccurrence) {
      const loaded = await loadOccurrence();
      return { state: 'absent', occurrence: loaded };
    },
    async list() {
      return { items: [] };
    },
  };
  const found = await withWorkflowActivityProjection(base, store).find(ctx(), KEY);
  assert.equal(found, null);
});

test('an invalid scope does no port or store IO', async () => {
  let io = 0;
  const base: TaskOccurrencePort = {
    kind: 'task',
    async open() {
      io += 1;
      throw new AppError('MSG_APP_SCOPE_INVALID', 'Module operation is outside the configured application.', 400);
    },
    async find() {
      io += 1;
      return occurrence();
    },
    async advance() {
      io += 1;
      throw new AppError('MSG_APP_SCOPE_INVALID', 'Module operation is outside the configured application.', 400);
    },
  };
  const store: WorkflowActivityStore = {
    projectId: '10',
    moduleId: 'tarefas',
    async refresh() {
      throw new AppError('MSG_APP_SCOPE_INVALID', 'Module operation is outside the configured application.', 400);
    },
    async list() {
      io += 1;
      return { items: [] };
    },
  };
  const port = withWorkflowActivityProjection(base, store);
  await assert.rejects(
    port.find(ctx(), KEY),
    (error: unknown) => error instanceof AppError && error.code === 'MSG_APP_SCOPE_INVALID',
  );
  await assert.rejects(port.open(ctx(), openCommand()), (error: unknown) => error instanceof AppError && error.code === 'MSG_APP_SCOPE_INVALID');
  assert.equal(io, 1);
});

test('a source timeout does not start another read and a late completion does not write', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { port, counts, writes, release } = harness({ kind: 'timeout' });
    const pending = port.find(ctx(), KEY);
    await mock.timers.tick(30_000);
    await assert.rejects(
      pending,
      (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_PROJECTION_SOURCE_TIMEOUT',
    );
    assert.equal(counts.find, 1);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(writes.length, 0);
    assert.equal(counts.find, 1);
  } finally {
    mock.timers.reset();
  }
});
