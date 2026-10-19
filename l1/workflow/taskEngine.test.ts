/// <mls fileReference="_102034_/l1/workflow/taskEngine.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { resetRunningReleaseCache } from '/_102034_/l1/server/layer_1_external/cbe/cbeRelease.js';
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
import type { WorkflowPlan, WorkflowPlanInput } from '/_102034_/l1/workflow/plan.js';
import {
  createWorkflowEngine,
  type TaskWorkflowAdvance,
  type TaskWorkflowOpen,
} from '/_102034_/l1/workflow/engine.js';
import { prepareWorkflowPlan } from '/_102034_/l1/workflow/plan.js';

const OCCURRENCE_TITLE = 'Occurrence title';
const PROCESS_TITLE = 'Process title';
const MODULE_TITLE = 'Module title';

const planA: WorkflowPlanInput = {
  processId: 'ciclo',
  title: PROCESS_TITLE,
  moduleTitle: MODULE_TITLE,
  steps: [
    {
      stepId: 'S',
      kind: 'human',
      title: 'Start',
      next: ['A'],
      conditions: 'ready',
      params: { lane: 'old' },
    },
    {
      stepId: 'A',
      kind: 'mechanical',
      title: 'Act',
      next: ['S'],
      functionRef: 'fn-a',
    },
  ],
};

const planB: WorkflowPlanInput = {
  processId: 'ciclo',
  title: 'Process B',
  moduleTitle: 'Module B',
  steps: [
    { stepId: 'S', kind: 'human', title: 'Start B', next: ['X'], conditions: 'later', params: { lane: 'new' } },
    { stepId: 'X', kind: 'llm', title: 'Other', next: [], functionRef: 'fn-b' },
  ],
};

function requestCtx(): RequestContext {
  const ctx = createRequestContext();
  ctx.moduleId = 'tarefas';
  ctx.sessionContext.project.projectId = '10';
  ctx.sessionContext.person = { mdmId: 'person-1', email: 'a@b.c', name: 'Ada' };
  ctx.requestMeta = { requestId: 'req-task', userId: 'telemetry-user', source: 'test' };
  return ctx;
}

function key(): OccurrenceKey {
  return { project: '10', module: 'tarefas', processId: 'ciclo', entity: 'Tarefa', recordId: 'r1' };
}

function clonePlan(plan: WorkflowPlanInput): WorkflowPlanInput {
  return {
    ...plan,
    steps: plan.steps.map((step) => ({
      ...step,
      next: [...step.next],
      ...(step.params === undefined ? {} : { params: { ...step.params } }),
    })),
  };
}

function openInput(plan: WorkflowPlanInput, title = OCCURRENCE_TITLE): TaskWorkflowOpen {
  return {
    key: key(),
    plan: clonePlan(plan),
    title,
    firstStep: 'S',
    actorNow: 'person-1',
    owner: 'owner-1',
    origin: { kind: 'screen', by: 'person-1' },
    executor: { kind: 'person', mdmId: 'person-1' },
    room: { mode: 'exclusive' },
    message: { content: 'hello' },
  };
}

function snapshot(
  plan: WorkflowPlan,
  patch: Partial<TaskOccurrenceSnapshot> = {},
): TaskOccurrenceSnapshot {
  return {
    ref: { ...key(), workflowVersion: 'rel-a' },
    step: 'S',
    actorNow: 'person-1',
    done: false,
    history: [
      {
        at: '2026-10-19T12:00:00.000Z',
        by: 'person-1',
        from: null,
        step: 'S',
        actorNow: 'person-1',
        done: false,
        commandId: 'open-1',
        executor: { kind: 'person', mdmId: 'person-1' },
      },
    ],
    plan,
    title: OCCURRENCE_TITLE,
    taskId: 'task-a',
    revision: 4,
    status: 'in progress',
    owner: 'owner-1',
    origin: { kind: 'screen', by: 'person-1' },
    room: { mode: 'exclusive' },
    roomId: 'room-1',
    pass: 2,
    wake: { everyMinutes: 15, routine: 'ciclo.S', nextAt: '2026-10-19T12:15:00.000Z', seq: 3 },
    ...patch,
  };
}

interface Routed {
  port: TaskOccurrencePort;
  opens: TaskOccurrenceOpenCommand[];
  advances: TaskOccurrenceAdvanceCommand[];
  findCalls: number;
}

function routed(options: {
  found?: TaskOccurrenceSnapshot | null | (() => TaskOccurrenceSnapshot | null);
  openResult?: (command: TaskOccurrenceOpenCommand) => TaskOccurrenceOpenResult;
  advanceResult?: (command: TaskOccurrenceAdvanceCommand) => TaskOccurrenceAdvanceResult;
  findError?: Error;
  openError?: Error;
  advanceError?: Error;
}): Routed {
  const opens: TaskOccurrenceOpenCommand[] = [];
  const advances: TaskOccurrenceAdvanceCommand[] = [];
  let findCalls = 0;
  const port: TaskOccurrencePort = {
    kind: 'task',
    async find() {
      findCalls += 1;
      if (options.findError) throw options.findError;
      const found = options.found;
      return typeof found === 'function' ? found() : (found ?? null);
    },
    async open(_ctx, command) {
      opens.push(command);
      if (options.openError) throw options.openError;
      if (options.openResult) return options.openResult(command);
      const created = snapshot(command.plan, { title: command.title, ref: command.ref });
      return { outcome: 'created', occurrence: created };
    },
    async advance(_ctx, _key, command) {
      advances.push(command);
      if (options.advanceError) throw options.advanceError;
      if (options.advanceResult) return options.advanceResult(command);
      const current = typeof options.found === 'function' ? options.found() : options.found;
      if (!current) throw new Error('routed advance has no snapshot');
      return { outcome: 'advanced', occurrence: current };
    },
  };
  return {
    port,
    opens,
    advances,
    get findCalls() {
      return findCalls;
    },
  };
}

async function withRelease(id: string | null, run: () => Promise<void>): Promise<void> {
  const previous = process.cwd();
  const root = mkdtempSync(join(tmpdir(), 'wf-task-'));
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

test('an existing task keeps plan A when the caller offers template B', async () => {
  const stored = snapshot(prepareWorkflowPlan(planA));
  const gate = routed({ found: stored });
  const engine = createWorkflowEngine(gate.port);
  const again = await engine.open(requestCtx(), openInput(planB, 'Replacement title'));
  assert.equal(again.outcome, 'existing');
  assert.equal(again.occurrence, stored);
  assert.equal(again.occurrence.plan.steps[0]?.conditions, 'ready');
  assert.deepEqual(again.occurrence.plan.steps[0]?.params, { lane: 'old' });
  assert.equal(again.occurrence.plan.steps[0]?.next[0], 'A');
  assert.equal(again.occurrence.title, OCCURRENCE_TITLE);
  assert.equal(gate.opens.length, 0);
  assert.equal(again.moduleMessage, undefined);
});

test('open retry returns A when the current template is invalid', async () => {
  const stored = snapshot(prepareWorkflowPlan(planA));
  const gate = routed({ found: stored });
  const engine = createWorkflowEngine(gate.port);
  const invalid: WorkflowPlanInput = { processId: 'ciclo', title: '', moduleTitle: '', steps: [] };
  const again = await engine.open(requestCtx(), openInput(invalid, ''));
  assert.equal(again.occurrence, stored);
  assert.equal(again.outcome, 'existing');
  assert.equal(gate.opens.length, 0);
});

test('a race that finds absence and opens existing keeps canonical A', async () => {
  const stored = snapshot(prepareWorkflowPlan(planA));
  const gate = routed({
    found: null,
    openResult: () => ({ outcome: 'existing', occurrence: stored, moduleMessage: { state: 'pending', threadId: 'th-1' } }),
  });
  const engine = createWorkflowEngine(gate.port);
  const raced = await engine.open(requestCtx(), openInput(planB, 'New title'));
  assert.equal(raced.outcome, 'existing');
  assert.equal(raced.occurrence, stored);
  assert.equal(raced.occurrence.title, OCCURRENCE_TITLE);
  assert.equal(raced.moduleMessage?.state, 'pending');
  assert.equal(gate.opens.length, 1);
  assert.notEqual(gate.opens[0]?.plan, planB);
});

test('a new open sends the occurrence title and an independent plan copy', async () => {
  await withRelease('rel-real', async () => {
    const gate = routed({ found: null });
    const engine = createWorkflowEngine(gate.port);
    const input = openInput(planA);
    const opened = await engine.open(requestCtx(), input);
    assert.equal(opened.outcome, 'created');
    assert.equal(gate.opens.length, 1);
    const command = gate.opens[0]!;
    assert.equal(command.title, OCCURRENCE_TITLE);
    assert.equal(command.plan.title, PROCESS_TITLE);
    assert.equal(command.plan.moduleTitle, MODULE_TITLE);
    assert.equal(command.ref.workflowVersion, 'rel-real');
    assert.equal(command.plan.steps[0]?.conditions, 'ready');
    assert.deepEqual(command.plan.steps[0]?.params, { lane: 'old' });
    input.plan.steps[0]!.params!.lane = 'mutated';
    input.plan.steps[0]!.next.push('Z');
    assert.equal(command.plan.steps[0]?.params?.lane, 'old');
    assert.deepEqual(command.plan.steps[0]?.next, ['A']);
    assert.equal(opened.moduleMessage, undefined);
  });
});

test('a new open without a title is refused and does not call the port', async () => {
  const gate = routed({ found: null });
  const engine = createWorkflowEngine(gate.port);
  await assert.rejects(() => engine.open(requestCtx(), openInput(planA, '   ')), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, 'INVALID_COMMAND');
    return true;
  });
  assert.equal(gate.opens.length, 0);
  assert.equal(gate.findCalls, 1);
});

test('a missing release is logged without session fields and still opens', async () => {
  await withRelease(null, async () => {
    const gate = routed({ found: null });
    const engine = createWorkflowEngine(gate.port);
    const ctx = requestCtx();
    const lines: { message: string; data?: unknown }[] = [];
    ctx.log = {
      info(message, data) { lines.push({ message, data }); },
      error(message, data) { lines.push({ message, data }); },
    };
    await engine.open(ctx, openInput(planA));
    assert.equal(gate.opens[0]?.ref.workflowVersion, null);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.message, 'WORKFLOW_VERSION_UNKNOWN');
    assert.deepEqual(lines[0]?.data, {
      project: '10',
      module: 'tarefas',
      processId: 'ciclo',
      entity: 'Tarefa',
      recordId: 'r1',
    });
  });
});

test('advance uses plan A after template B and does not refresh expectedRevision', async () => {
  await withRelease('rel-b', async () => {
    const stored = snapshot(prepareWorkflowPlan(planA));
    const gate = routed({ found: stored });
    const engine = createWorkflowEngine(gate.port);
    const moved = await engine.advance(requestCtx(), key(), {
      commandId: 'cmd-1',
      expectedRevision: 2,
      from: 'S',
      to: 'A',
      actorNow: 'person-2',
      executor: { kind: 'person', mdmId: 'person-2' },
      wake: { everyMinutes: 5, routine: 'ciclo.A' },
    });
    assert.equal(moved.outcome, 'advanced');
    assert.equal(moved.occurrence, stored);
    assert.equal(gate.advances.length, 1);
    const command = gate.advances[0]!;
    assert.equal(command.taskId, 'task-a');
    assert.equal(command.expectedRevision, 2);
    assert.equal(command.to, 'A');
    assert.equal(command.done, false);
    assert.deepEqual(command.wake, { everyMinutes: 5, routine: 'ciclo.A' });
    assert.equal(command.wake && 'nextAt' in command.wake, false);
    await assert.rejects(
      () => engine.advance(requestCtx(), key(), {
        commandId: 'cmd-x',
        expectedRevision: 2,
        from: 'S',
        to: 'X',
        actorNow: null,
        executor: { kind: 'routine', name: 'ciclo.S' },
      }),
      (error: unknown) => error instanceof AppError && error.code === 'UNKNOWN_STEP',
    );
    assert.equal(gate.advances.length, 1);
  });
});

test('close, transfer and step change keep the command shape and the port snapshot', async () => {
  const stored = snapshot(prepareWorkflowPlan(planA));
  const cases: { name: string; command: TaskWorkflowAdvance; expect: Pick<TaskOccurrenceAdvanceCommand, 'to' | 'done'> & { wake: boolean } }[] = [
    {
      name: 'enter with wake',
      command: {
        commandId: 'c1',
        expectedRevision: 4,
        from: 'S',
        to: 'A',
        actorNow: 'person-2',
        executor: { kind: 'person', mdmId: 'person-2' },
        wake: { everyMinutes: 10, routine: 'ciclo.A' },
      },
      expect: { to: 'A', done: false, wake: true },
    },
    {
      name: 'change step without wake',
      command: {
        commandId: 'c2',
        expectedRevision: 4,
        from: 'S',
        to: 'A',
        actorNow: 'person-2',
        executor: { kind: 'person', mdmId: 'person-2' },
      },
      expect: { to: 'A', done: false, wake: false },
    },
    {
      name: 'transfer without wake',
      command: {
        commandId: 'c3',
        expectedRevision: 4,
        from: 'S',
        to: 'S',
        actorNow: 'person-9',
        executor: { kind: 'person', mdmId: 'person-9' },
      },
      expect: { to: 'S', done: false, wake: false },
    },
    {
      name: 'close with wake',
      command: {
        commandId: 'c4',
        expectedRevision: 4,
        from: 'S',
        to: 'end',
        actorNow: null,
        executor: { kind: 'routine', name: 'ciclo.S' },
        wake: { everyMinutes: 10, routine: 'ciclo.S' },
      },
      expect: { to: 'S', done: true, wake: true },
    },
  ];
  for (const item of cases) {
    const returned = snapshot(stored.plan, { pass: stored.pass, wake: stored.wake, revision: 9 });
    const gate = routed({
      found: stored,
      advanceResult: () => ({ outcome: 'advanced', occurrence: returned }),
    });
    const engine = createWorkflowEngine(gate.port);
    const result = await engine.advance(requestCtx(), key(), item.command);
    assert.equal(result.occurrence, returned, item.name);
    assert.equal(result.occurrence.pass, 2, item.name);
    assert.equal(result.occurrence.wake?.seq, 3, item.name);
    const sent = gate.advances[0]!;
    assert.equal(sent.to, item.expect.to, item.name);
    assert.equal(sent.done, item.expect.done, item.name);
    assert.equal(sent.wake !== undefined, item.expect.wake, item.name);
    assert.equal('end' in sent ? false : sent.to !== 'end', true, item.name);
    assert.equal(Object.hasOwn(sent, 'wake'), item.expect.wake, item.name);
  }
});

test('a known commandId and a paused task are delegated without a graph refusal', async () => {
  const plan = prepareWorkflowPlan(planA);
  const looped = snapshot(plan, {
    history: [
      {
        at: '2026-10-19T12:00:00.000Z',
        by: null,
        from: null,
        step: 'S',
        actorNow: null,
        done: false,
        commandId: 'open-1',
        executor: { kind: 'routine', name: 'ciclo.S' },
      },
      {
        at: '2026-10-19T12:05:00.000Z',
        by: 'person-1',
        from: 'S',
        step: 'A',
        actorNow: 'person-1',
        done: false,
        commandId: 'loop-1',
        executor: { kind: 'person', mdmId: 'person-1' },
      },
    ],
  });
  const unchanged = snapshot(plan, { revision: looped.revision });
  const replayGate = routed({
    found: looped,
    advanceResult: () => ({ outcome: 'unchanged', occurrence: unchanged }),
  });
  const replay = await createWorkflowEngine(replayGate.port).advance(requestCtx(), key(), {
    commandId: 'loop-1',
    expectedRevision: 1,
    from: 'S',
    to: 'X',
    actorNow: 'person-1',
    executor: { kind: 'person', mdmId: 'person-1' },
  });
  assert.equal(replay.outcome, 'unchanged');
  assert.equal(replay.occurrence, unchanged);
  assert.equal(replayGate.advances[0]?.expectedRevision, 1);
  assert.equal(replayGate.advances[0]?.to, 'X');

  const pausedGate = routed({
    found: snapshot(plan, { status: 'paused' }),
    advanceResult: () => ({ outcome: 'unchanged', occurrence: unchanged }),
  });
  const paused = await createWorkflowEngine(pausedGate.port).advance(requestCtx(), key(), {
    commandId: 'fresh',
    expectedRevision: 1,
    from: 'nowhere',
    to: 'end',
    actorNow: null,
    executor: { kind: 'routine', name: 'ciclo.S' },
  });
  assert.equal(paused.outcome, 'unchanged');
  assert.equal(pausedGate.advances[0]?.to, 'nowhere');
  assert.equal(pausedGate.advances[0]?.done, true);
});

test('delivery status from the port is returned unchanged', async () => {
  const pending: TaskOccurrenceMessageStatus = { state: 'pending', threadId: 'th-p' };
  const sent: TaskOccurrenceMessageStatus = { state: 'sent', threadId: 'th-s', orderAt: '2026-10-19T12:01:00.000Z' };
  const stored = snapshot(prepareWorkflowPlan(planA), {
    history: [
      {
        at: '2026-10-19T12:00:00.000Z',
        by: null,
        from: null,
        step: 'S',
        actorNow: null,
        done: false,
        commandId: 'open-1',
        executor: { kind: 'routine', name: 'ciclo.S' },
        message: pending,
      },
    ],
  });
  const existing = routed({ found: stored });
  const engine = createWorkflowEngine(existing.port);
  const opened = await engine.open(requestCtx(), openInput(planB));
  assert.deepEqual(opened.moduleMessage, pending);
  assert.equal(opened.occurrence.history[0]?.message?.state, 'pending');

  const createdGate = routed({
    found: null,
    openResult: (command) => ({
      outcome: 'created',
      occurrence: snapshot(command.plan),
      moduleMessage: sent,
    }),
  });
  const created = await createWorkflowEngine(createdGate.port).open(requestCtx(), openInput(planA));
  assert.equal(created.outcome, 'created');
  assert.deepEqual(created.moduleMessage, sent);

  const absentGate = routed({
    found: null,
    openResult: (command) => ({ outcome: 'created', occurrence: snapshot(command.plan) }),
  });
  const absent = await createWorkflowEngine(absentGate.port).open(requestCtx(), openInput(planA));
  assert.equal(Object.hasOwn(absent, 'moduleMessage'), false);

  for (const status of [pending, sent, undefined] as const) {
    for (const outcome of ['advanced', 'unchanged'] as const) {
      const body = snapshot(stored.plan);
      const gate = routed({
        found: stored,
        advanceResult: () => ({
          outcome,
          occurrence: body,
          ...(status === undefined ? {} : { moduleMessage: status }),
        }),
      });
      const result = await createWorkflowEngine(gate.port).advance(requestCtx(), key(), {
        commandId: `${outcome}-${status?.state ?? 'none'}`,
        expectedRevision: 4,
        from: 'S',
        to: 'A',
        actorNow: 'person-2',
        executor: { kind: 'person', mdmId: 'person-2' },
      });
      assert.equal(result.outcome, outcome);
      if (status === undefined) assert.equal(Object.hasOwn(result, 'moduleMessage'), false);
      else assert.deepEqual(result.moduleMessage, status);
    }
  }
});

test('port errors propagate once and do not invent an occurrence', async () => {
  const cases = [
    new AppError('FORBIDDEN', 'no', 403),
    new AppError('CONFLICT', 'rev', 409),
    new AppError('STORAGE', 'full', 507),
    new Error('timeout'),
  ];
  for (const error of cases) {
    const onFind = routed({ findError: error });
    const engine = createWorkflowEngine(onFind.port);
    await assert.rejects(() => engine.advance(requestCtx(), key(), {
      commandId: 'cmd',
      expectedRevision: 1,
      from: 'S',
      to: 'A',
      actorNow: null,
      executor: { kind: 'routine', name: 'ciclo.S' },
    }), (caught: unknown) => caught === error);
    assert.equal(onFind.findCalls, 1);
    assert.equal(onFind.advances.length, 0);

    const onAdvance = routed({ found: snapshot(prepareWorkflowPlan(planA)), advanceError: error });
    await assert.rejects(
      () => createWorkflowEngine(onAdvance.port).advance(requestCtx(), key(), {
        commandId: 'cmd',
        expectedRevision: 1,
        from: 'S',
        to: 'A',
        actorNow: null,
        executor: { kind: 'routine', name: 'ciclo.S' },
      }),
      (caught: unknown) => caught === error,
    );
    assert.equal(onAdvance.advances.length, 1);
    assert.equal(onAdvance.findCalls, 1);
  }
});

test('confirmed absence is not an open and a failed find is not treated as absence', async () => {
  const missing = routed({ found: null });
  await assert.rejects(
    () => createWorkflowEngine(missing.port).advance(requestCtx(), key(), {
      commandId: 'cmd',
      expectedRevision: 1,
      from: 'S',
      to: 'A',
      actorNow: null,
      executor: { kind: 'routine', name: 'ciclo.S' },
    }),
    (error: unknown) => error instanceof AppError && error.code === 'OCCURRENCE_NOT_FOUND',
  );
  assert.equal(missing.advances.length, 0);

  const timeout = new Error('timeout');
  const uncertain = routed({ findError: timeout });
  await assert.rejects(() => createWorkflowEngine(uncertain.port).open(requestCtx(), openInput(planA)), (error: unknown) => error === timeout);
  assert.equal(uncertain.opens.length, 0);
});
