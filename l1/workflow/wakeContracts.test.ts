/// <mls fileReference="_102034_/l1/workflow/wakeContracts.test.ts" enhancement="_blank"/>
import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { tableDefinitions } from '/_102034_/l1/server/persistence.js';
import {
  WORKFLOW_WAKE_BODY_LIMIT_BYTES,
  parseWorkflowWakeEvent,
  sameWorkflowWakeIdentity,
  workflowWakeCommandId,
  type ModuleWakeEvent,
} from '/_102034_/l1/workflow/wakeContracts.js';

function body(overrides: Record<string, unknown> = {}, ref: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: 'task-1:wait:2:3',
    scheduledAt: '2026-10-20T12:00:00.000Z',
    attempt: 1,
    ref: {
      project: '102034',
      module: 'tarefas',
      entity: 'item',
      recordId: 'rec_1',
      processId: 'proc',
      workflowVersion: null,
      ...ref,
    },
    taskId: 'task-1',
    stepKey: 'wait',
    pass: 1,
    seq: 2,
    revision: 4,
    routine: 'onWait',
    ...overrides,
  };
}

function parsed(overrides: Record<string, unknown> = {}, ref: Record<string, unknown> = {}): ModuleWakeEvent {
  return parseWorkflowWakeEvent(body(overrides, ref));
}

test('parse keeps only wire fields and accepts non-uuid ids', () => {
  const event = parsed({ token: 'secret', note: 'plan' }, { extra: true });
  assert.deepEqual(event, {
    eventId: 'task-1:wait:2:3',
    scheduledAt: '2026-10-20T12:00:00.000Z',
    attempt: 1,
    ref: {
      project: '102034',
      module: 'tarefas',
      entity: 'item',
      recordId: 'rec_1',
      processId: 'proc',
      workflowVersion: null,
    },
    taskId: 'task-1',
    stepKey: 'wait',
    pass: 1,
    seq: 2,
    revision: 4,
    routine: 'onWait',
  });
  assert.equal('token' in event, false);
  assert.equal('extra' in event.ref, false);
  assert.deepEqual(parsed({}, { workflowVersion: 'v1' }).ref.workflowVersion, 'v1');
  assert.deepEqual(parsed({ scheduledAt: '2026-10-20T12:00:00Z' }).scheduledAt, '2026-10-20T12:00:00Z');
});

test('validation rejects each wire field, arrays, and the 32 KiB body', () => {
  const cases: Array<Record<string, unknown> | unknown> = [
    [],
    { ...body(), ref: [] },
    body({ eventId: '' }),
    body({ eventId: 'other:wait:2:3' }),
    body({ eventId: 'task-1:wait:2:0' }),
    body({ eventId: 'task-1:wait:2:01' }),
    body({ scheduledAt: '2026-10-20T12:00:00+00:00' }),
    body({ scheduledAt: '2026-02-31T00:00:00Z' }),
    body({ attempt: 0 }),
    body({ attempt: 1.5 }),
    body({ attempt: Number.MAX_SAFE_INTEGER + 1 }),
    body({ taskId: '' }),
    body({ stepKey: '' }),
    body({ pass: 0 }),
    body({ seq: '2' }),
    body({ revision: -1 }),
    body({ routine: '' }),
    body({}, { project: '01' }),
    body({}, { project: '102034.0' }),
    body({}, { module: '' }),
    body({}, { entity: '' }),
    body({}, { recordId: '' }),
    body({}, { processId: '' }),
    body({}, { workflowVersion: '' }),
    body({}, { workflowVersion: 1 }),
  ];
  for (const input of cases) {
    assert.throws(() => parseWorkflowWakeEvent(input), AppError);
  }
  const huge = body({ routine: 'x'.repeat(WORKFLOW_WAKE_BODY_LIMIT_BYTES) });
  assert.throws(() => parseWorkflowWakeEvent(huge), (error: unknown) => {
    return error instanceof AppError && error.statusCode === 413;
  });
  const atLimit = 'x'.repeat(WORKFLOW_WAKE_BODY_LIMIT_BYTES);
  assert.doesNotThrow(() => parseWorkflowWakeEvent(body(), Buffer.byteLength(JSON.stringify(body()))));
  assert.throws(() => parseWorkflowWakeEvent(body(), atLimit.length + 1), (error: unknown) => {
    return error instanceof AppError && error.code === 'WORKFLOW_WAKE_BODY_TOO_LARGE';
  });
});

test('stable identity ignores property order, attempt and revision', () => {
  const left = parsed();
  const reversed = parseWorkflowWakeEvent({
    routine: 'onWait',
    revision: 9,
    seq: 2,
    pass: 1,
    stepKey: 'wait',
    taskId: 'task-1',
    ref: {
      workflowVersion: null,
      processId: 'proc',
      recordId: 'rec_1',
      entity: 'item',
      module: 'tarefas',
      project: '102034',
    },
    attempt: 7,
    scheduledAt: '2026-10-20T12:00:00.000Z',
    eventId: 'task-1:wait:2:3',
  });
  assert.equal(sameWorkflowWakeIdentity(left, reversed), true);
  assert.equal(workflowWakeCommandId(left.eventId), 'wake:task-1:wait:2:3');
  const next = parsed({ eventId: 'task-1:wait:2:4' });
  assert.equal(workflowWakeCommandId(next.eventId), 'wake:task-1:wait:2:4');
  assert.notEqual(workflowWakeCommandId(left.eventId), workflowWakeCommandId(next.eventId));
});

test('stable identity diverges on each stable field', () => {
  const base = parsed();
  const changes: ModuleWakeEvent[] = [
    parsed({ eventId: 'task-1:wait:2:8', seq: 2 }),
    parsed({ scheduledAt: '2026-10-20T12:00:01.000Z' }),
    parsed({ taskId: 'task-2', eventId: 'task-2:wait:2:3' }),
    parsed({ stepKey: 'other', eventId: 'task-1:other:2:3' }),
    parsed({ pass: 2 }),
    parsed({ seq: 3, eventId: 'task-1:wait:3:3' }),
    parsed({ routine: 'otherRoutine' }),
    parsed({}, { project: '102035' }),
    parsed({}, { module: 'inicio' }),
    parsed({}, { entity: 'other' }),
    parsed({}, { recordId: 'rec_2' }),
    parsed({}, { processId: 'other' }),
    parsed({}, { workflowVersion: 'v2' }),
  ];
  for (const event of changes) {
    assert.equal(sameWorkflowWakeIdentity(base, event), false);
  }
});

test('workflow wake inbox is a platform postgres table registered for migrate', async () => {
  const defined = tableDefinitions.find((definition) => definition.repositoryName === 'workflowWakeInbox');
  assert.ok(defined);
  assert.equal(defined.moduleId, 'platform');
  assert.equal(defined.tableName, 'platform_workflow_wake_inbox');
  assert.equal(defined.purpose, 'controle');
  assert.equal(defined.storageProfile, 'postgres');
  assert.equal(defined.writeMode, 'sync');
  assert.equal(defined.dynamo, undefined);
  assert.equal(defined.retentionDays, undefined);
  assert.deepEqual(defined.primaryKey, ['projectId', 'eventId']);
  assert.deepEqual(defined.indexes, [{
    name: 'platform_workflow_wake_inbox_due',
    columns: ['projectId', 'state', 'nextAttemptAt', 'receivedAt', 'eventId'],
  }]);
  const column = (name: string) => defined.columns.find((item) => item.name === name);
  assert.equal(column('payload')?.postgresType, 'JSONB');
  assert.equal(column('state')?.postgresType, 'TEXT');
  assert.equal(column('outcome')?.nullable, true);
  assert.equal(column('receivedAt')?.postgresType, 'TIMESTAMPTZ');
  assert.equal(column('receivedAt')?.nullable, undefined);
  assert.equal(column('nextAttemptAt')?.nullable, true);
  assert.equal(column('completedAt')?.nullable, true);
  assert.equal(column('attempts')?.postgresType, 'INTEGER');
  assert.equal(column('attempts')?.defaultSql, '0');
  assert.equal(column('lastErrorCode')?.nullable, true);
  for (const name of ['moduleId', 'processId', 'entity', 'recordId', 'taskId']) {
    assert.equal(column(name)?.postgresType, 'TEXT');
  }

  const loaded = await import('/_102034_/l1/server/persistence.js') as { tableDefinitions: typeof tableDefinitions };
  const registered = loaded.tableDefinitions.find((definition) => definition.repositoryName === 'workflowWakeInbox');
  assert.equal(registered, defined);
});

// rt209: the end of a module LLM step travels as the same event, with kind, commandId and state.
function llmBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return body({
    kind: 'llm-step-finished',
    commandId: 'cmd-1',
    state: 'completed',
    eventId: 'task-1:wait:llm:cmd-1',
    ...overrides,
  });
}

test('llm-step-finished is parsed with kind, commandId and state; a wake keeps its shape', () => {
  const event = parseWorkflowWakeEvent(llmBody());
  assert.equal(event.kind, 'llm-step-finished');
  assert.equal(event.commandId, 'cmd-1');
  assert.equal(event.state, 'completed');
  assert.equal(event.eventId, 'task-1:wait:llm:cmd-1');
  assert.equal(event.seq, 2);
  assert.equal(workflowWakeCommandId(event.eventId), 'wake:task-1:wait:llm:cmd-1');
  assert.equal(parseWorkflowWakeEvent(llmBody({ state: 'failed' })).state, 'failed');

  // without kind, or with 'wake', exactly as before: no kind/commandId/state in the result, extra fields dropped
  for (const wake of [parsed(), parsed({ kind: 'wake', commandId: 'x', state: 'completed' })]) {
    assert.equal('kind' in wake, false);
    assert.equal('commandId' in wake, false);
    assert.equal('state' in wake, false);
  }
});

test('llm-step-finished refuses a missing commandId or state, an unknown kind, and the wake eventId format (and the reverse)', () => {
  const invalid = (value: unknown) => assert.throws(
    () => parseWorkflowWakeEvent(value),
    (error: unknown) => error instanceof AppError && error.statusCode === 400 && error.code === 'WORKFLOW_WAKE_EVENT_INVALID',
  );
  const { commandId: _c, ...noCommand } = llmBody();
  const { state: _s, ...noState } = llmBody();
  invalid(noCommand);
  invalid(noState);
  invalid(llmBody({ commandId: '' }));
  invalid(llmBody({ state: 'pending' }));
  invalid(llmBody({ kind: 'other' }));
  invalid(llmBody({ eventId: 'task-1:wait:2:3' })); // wake format with kind llm
  invalid(llmBody({ eventId: 'task-1:wait:llm:cmd-2' })); // another commandId
  invalid(llmBody({ eventId: 'task-9:wait:llm:cmd-1' })); // another task
  invalid(body({ eventId: 'task-1:wait:llm:cmd-1' })); // llm format without kind
  invalid(body({ kind: 'wake', eventId: 'task-1:wait:llm:cmd-1' })); // llm format with kind wake
});

test('llm-step-finished identity includes kind, commandId and state', () => {
  const base = parseWorkflowWakeEvent(llmBody());
  const repeated = parseWorkflowWakeEvent(llmBody({ attempt: 5, revision: 9 }));
  assert.equal(sameWorkflowWakeIdentity(base, repeated), true);
  assert.equal(sameWorkflowWakeIdentity(base, parseWorkflowWakeEvent(llmBody({ state: 'failed' }))), false);
  assert.equal(sameWorkflowWakeIdentity(base, parseWorkflowWakeEvent(llmBody({ commandId: 'cmd-2', eventId: 'task-1:wait:llm:cmd-2' }))), false);
  assert.equal(sameWorkflowWakeIdentity(parsed(), parsed({ kind: 'wake' })), true);
});
