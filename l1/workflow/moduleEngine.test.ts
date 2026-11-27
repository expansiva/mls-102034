/// <mls fileReference="_102034_/l1/workflow/moduleEngine.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type {
  TaskOccurrenceAdvanceCommand,
  TaskOccurrenceHistoryEntry,
  TaskOccurrenceOpenCommand,
  TaskOccurrencePort,
  TaskOccurrenceSnapshot,
} from '/_102034_/l1/workflow/contracts.js';
import { createModuleWorkflowEngine, runOccurrence } from '/_102034_/l1/workflow/moduleEngine.js';
import type { WorkflowPlanInput } from '/_102034_/l1/workflow/plan.js';

// Declared the way a module declares them: `as const satisfies`, so the step ids are literal types and the arrays are readonly.
const plans = {
  send: {
    processId: 'send',
    title: 'Send',
    moduleTitle: 'telegram',
    steps: [{ stepId: 'sendAndRecord', kind: 'mechanical', title: 'Send and record', next: [] }],
  },
  review: {
    processId: 'review',
    title: 'Review',
    moduleTitle: 'telegram',
    steps: [
      { stepId: 'look', kind: 'human', title: 'Look at it', next: ['wait'] },
      { stepId: 'wait', kind: 'wait', title: 'Wait', next: [] },
    ],
  },
} as const satisfies Record<string, WorkflowPlanInput>;

const PERSON = 'person-1';

function born(command: TaskOccurrenceOpenCommand): TaskOccurrenceSnapshot {
  const entry: TaskOccurrenceHistoryEntry = { at: '2026-11-27T10:00:00.000Z', by: null, from: null, step: command.firstStep, actorNow: command.actorNow, done: false, commandId: `open-${command.ref.recordId}`, executor: command.executor };
  return { ref: command.ref, step: command.firstStep, actorNow: command.actorNow, done: false, history: [entry], plan: command.plan, title: command.title, taskId: `task-${command.ref.recordId}`, revision: 1, status: 'in progress', owner: command.owner, origin: command.origin, room: command.room, roomId: 'room', pass: 1 };
}

function port() {
  const snapshots = new Map<string, TaskOccurrenceSnapshot>();
  const opened: TaskOccurrenceOpenCommand[] = [];
  const advanced: TaskOccurrenceAdvanceCommand[] = [];
  const impl: TaskOccurrencePort = {
    kind: 'task',
    async find(_ctx, key) { return snapshots.get(key.recordId) ?? null; },
    async open(_ctx, command) {
      opened.push(command);
      const created = born(command);
      snapshots.set(command.ref.recordId, created);
      return { outcome: 'created', occurrence: created };
    },
    async advance(_ctx, key, command) {
      advanced.push(command);
      const current = snapshots.get(key.recordId);
      if (!current) throw new Error('no snapshot');
      const next = { ...current, step: command.done ? 'end' : command.to, done: command.done, revision: current.revision + 1, status: command.done ? 'done' as const : current.status };
      snapshots.set(key.recordId, next);
      return { outcome: 'advanced', occurrence: next };
    },
  };
  return { impl, snapshots, opened, advanced };
}

function ctxOf(over: { connectionKey?: string; requestId?: string; person?: boolean } = {}): RequestContext {
  const ctx = createRequestContext();
  ctx.moduleId = 'telegram';
  ctx.sessionContext.project.projectId = '102047';
  if (over.person) ctx.sessionContext.person = { mdmId: PERSON, email: 'a@b.c', name: 'Ada' };
  ctx.requestMeta = {
    ...(over.requestId !== undefined ? { requestId: over.requestId, userId: 'u', source: 'message' } : {}),
    ...(over.connectionKey !== undefined ? { connection: { connectionId: 'cm', operationId: 'x', context: {}, idempotencyKey: over.connectionKey } } : {}),
  } as RequestContext['requestMeta'];
  return ctx;
}

const executor = { kind: 'routine', name: 'telegram.send' } as const;

test('rt325 s4: the step ids come from the plan; a name outside it does not compile (and is refused at run time)', async () => {
  const p = port();
  const engine = createModuleWorkflowEngine(plans, { projectId: '102047', moduleId: 'telegram', port: p.impl });
  const key = { project: '102047', module: 'telegram', processId: 'send' as const, entity: 'Message', recordId: 'r1' };
  await engine.open(ctxOf({ requestId: 'r' }), { key, processId: 'send', title: 'T', firstStep: 'sendAndRecord', actorNow: null, owner: null, origin: { kind: 'event' }, executor, room: { mode: 'exclusive' } });
  assert.equal(p.opened[0].plan.steps[0].stepId, 'sendAndRecord');
  // @ts-expect-error 'task:<id>' is not a step of the plan 'send'
  const bad = engine.open(ctxOf({ requestId: 'r' }), { key: { ...key, recordId: 'r2' }, processId: 'send', title: 'T', firstStep: 'task:abc', actorNow: null, owner: null, origin: { kind: 'event' }, executor, room: { mode: 'exclusive' } });
  await assert.rejects(bad, /does not know the step/u);
  // @ts-expect-error 'look' is a step of 'review', not of 'send'
  const alien = engine.advance(ctxOf({ requestId: 'r' }), key, { commandId: 'c', expectedRevision: 1, from: 'look', to: 'end', actorNow: null, executor });
  await assert.rejects(alien, /does not know|not/u);
  await engine.advance(ctxOf({ requestId: 'r' }), key, { commandId: 'c2', expectedRevision: 1, from: 'sendAndRecord', to: 'end', actorNow: null, executor });
  assert.equal(p.advanced.at(-1)?.done, true, 'the end is the logical close of the step');
});

test('rt325 s4: the owner of the step decides what goes with the command (person: notice; module: none)', async () => {
  const p = port();
  const engine = createModuleWorkflowEngine(plans, { projectId: '102047', moduleId: 'telegram', port: p.impl });
  const key = { project: '102047', module: 'telegram', processId: 'review' as const, entity: 'Message', recordId: 'r1' };
  await engine.open(ctxOf({ requestId: 'r', person: true }), { key, processId: 'review', title: 'T', firstStep: 'look', actorNow: PERSON, owner: PERSON, origin: { kind: 'screen', by: PERSON }, executor: { kind: 'person', mdmId: PERSON }, room: { mode: 'exclusive' } });
  assert.deepEqual(p.opened[0].message, { content: 'Look at it' }, 'a person step carries its title as the notice');
  const mech = port();
  const second = createModuleWorkflowEngine(plans, { projectId: '102047', moduleId: 'telegram', port: mech.impl });
  await second.open(ctxOf({ requestId: 'r' }), { key: { ...key, processId: 'send' }, processId: 'send', title: 'T', firstStep: 'sendAndRecord', actorNow: null, owner: null, origin: { kind: 'event' }, executor, room: { mode: 'exclusive' }, message: { content: 'ignored' } });
  assert.equal(mech.opened[0].message, undefined, 'a module step takes no notice');
});

test('rt325 s4: the process of the open has to match the key', async () => {
  const engine = createModuleWorkflowEngine(plans, { projectId: '102047', moduleId: 'telegram', port: port().impl });
  const key = { project: '102047', module: 'telegram', processId: 'review' as const, entity: 'Message', recordId: 'r1' };
  await assert.rejects(
    engine.open(ctxOf({ requestId: 'r' }), { key, processId: 'send', title: 'T', firstStep: 'sendAndRecord', actorNow: null, owner: null, origin: { kind: 'event' }, executor, room: { mode: 'exclusive' } }),
    /does not match the key/u,
  );
});

test('rt325 s4: runOccurrence opens, runs the work with the context that gives the first id to the record, and closes the step', async () => {
  const p = port();
  const engine = createModuleWorkflowEngine(plans, { projectId: '102047', moduleId: 'telegram', port: p.impl });
  const ctx = ctxOf({ connectionKey: 'cm-key-1', requestId: 'req-1' });
  let seenRecord = '';
  let firstId = '';
  const result = await runOccurrence(ctx, engine, { processId: 'send', entity: 'Message', title: 'Hello', step: 'sendAndRecord', executor, origin: { kind: 'event' } }, async (occurrenceCtx, recordId) => {
    seenRecord = recordId;
    firstId = occurrenceCtx.idGenerator.newId();
    return { sent: true };
  });
  assert.deepEqual(result, { sent: true });
  assert.match(seenRecord, /^wf_/u);
  assert.equal(firstId, seenRecord, 'the first id of the work is the record id');
  assert.equal(p.opened.length, 1);
  assert.equal(p.opened[0].firstStep, 'sendAndRecord');
  assert.equal(p.advanced.length, 1);
  assert.equal(p.advanced[0].from, 'sendAndRecord');
  assert.equal(p.advanced[0].done, true, 'the end is the logical close of the step');
  assert.equal(p.snapshots.get(seenRecord)?.done, true);
});

test('rt325 s4: the default key is the one of the request in course; the same key gives the same occurrence; a seed overrides; no key is an explicit error', async () => {
  const p = port();
  const engine = createModuleWorkflowEngine(plans, { projectId: '102047', moduleId: 'telegram', port: p.impl });
  const ids: string[] = [];
  const run = (ctx: RequestContext, seed?: string) => runOccurrence(ctx, engine, { processId: 'send', ...(seed !== undefined ? { seed } : {}), entity: 'Message', title: 'T', step: 'sendAndRecord', executor, origin: { kind: 'event' } }, async (_c, recordId) => { ids.push(recordId); });
  await run(ctxOf({ connectionKey: 'k1', requestId: 'r1' }));
  await run(ctxOf({ connectionKey: 'k1', requestId: 'r2' }));
  await run(ctxOf({ requestId: 'r-only' }));
  await run(ctxOf({ requestId: 'r-other' }), 'business-key');
  await run(ctxOf({ requestId: 'r-third' }), 'business-key');
  assert.equal(ids[0], ids[1], 'the key of the arrival wins over the request id');
  assert.notEqual(ids[0], ids[2]);
  assert.equal(ids[3], ids[4], 'the same seed is the same occurrence');
  assert.equal(p.opened.length, 3, 'one occurrence per distinct key');
  await assert.rejects(run(ctxOf()), /has no key/u);
});
