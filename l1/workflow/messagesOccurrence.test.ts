/// <mls fileReference="_102034_/l1/workflow/messagesOccurrence.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { ServerMessagesClient } from '/_102034_/l1/server/layer_1_external/collabMessages/client.js';
import type {
  AgentIntentModuleAdvance,
  AIModuleStep,
  ResponseBase,
  TaskData,
  Thread,
} from '/_102036_/l2/shared/interfaces.js';
import type {
  OccurrenceKey,
  TaskOccurrenceAdvanceCommand,
  TaskOccurrenceOpenCommand,
} from '/_102034_/l1/workflow/contracts.js';
import { prepareWorkflowPlan, type WorkflowPlan } from '/_102034_/l1/workflow/plan.js';
import type { MessagesWorkflowIdentities } from '/_102034_/l1/workflow/messagesTask.js';
import { createMessagesTaskOccurrencePort } from '/_102034_/l1/workflow/messagesOccurrence.js';

const PAIRS: Record<string, string> = { 'mdm-owner': 'cm-owner', 'mdm-by': 'cm-by', 'mdm-actor': 'cm-actor', 'mdm-member': 'cm-member' };
const CM_OF = Object.fromEntries(Object.entries(PAIRS).map(([mdm, cm]) => [cm, mdm]));

function identities(seen: string[]): MessagesWorkflowIdentities {
  return {
    async toCmUserId(_ctx, mdmId) {
      seen.push(`cm:${mdmId}`);
      const cm = PAIRS[mdmId];
      if (cm === undefined) throw new AppError('IDENTITY_NOT_FOUND', `missing ${mdmId}`, 404);
      return cm;
    },
    async toMdmId(_ctx, userId) {
      seen.push(`mdm:${userId}`);
      const mdm = CM_OF[userId];
      if (mdm === undefined) throw new AppError('IDENTITY_NOT_FOUND', `missing ${userId}`, 404);
      return mdm;
    },
  };
}

function ctx(): RequestContext {
  const context = createRequestContext();
  context.requestMeta = { userId: 'telemetry-only', source: 'test' };
  return context;
}

const KEY: OccurrenceKey = { project: '10', module: 'tarefas', processId: 'ciclo', entity: 'ordem', recordId: 'rec-1' };

function plan(): WorkflowPlan {
  return prepareWorkflowPlan({
    processId: 'ciclo',
    title: 'Process title',
    moduleTitle: 'Module title',
    steps: [
      { stepId: 'S', kind: 'human', title: 'Start title', actorRef: 'role-start', next: ['A'] },
      { stepId: 'A', kind: 'mechanical', title: 'Act title', functionRef: 'fn-act', next: [] },
    ],
  });
}

function child(key: string, status: AIModuleStep['status'], kind: 'human' | 'mechanical'): AIModuleStep {
  return {
    type: 'module',
    stepId: key === 'S' ? 1 : 2,
    status,
    stepTitle: key === 'S' ? 'Start title' : 'Act title',
    interaction: null,
    nextSteps: [],
    module: {
      key,
      kind,
      ownerKind: kind === 'human' ? 'person' : 'module',
      next: key === 'S' ? ['A'] : [],
      passes: 1,
      actorNow: 'cm-actor',
      ...(key === 'S' ? { actorRef: 'role-start' } : { functionRef: 'fn-act' }),
    },
  };
}

function task(overrides: { title?: string; revision?: number; status?: TaskData['status']; pk?: string; history?: TaskData['module'] extends infer M ? M extends { history: infer H } ? H : never : never } = {}): TaskData {
  const current = child('S', 'in_progress', 'human');
  const root: AIModuleStep = {
    type: 'module',
    stepId: 0,
    status: 'pending',
    stepTitle: 'Process title',
    interaction: null,
    nextSteps: [current, child('A', 'pending', 'mechanical')],
    module: { key: 'ciclo', kind: 'human', ownerKind: 'person', next: ['S'], passes: 1 },
  };
  return {
    PK: overrides.pk ?? 'task#1',
    SK: 'metadata',
    title: overrides.title ?? 'Occurrence title',
    owner: 'cm-owner',
    team: null,
    status: overrides.status ?? 'in progress',
    last_updated: 1,
    last_update_log: null,
    taskRoom: { enabled: true, threadId: 'room-1' },
    iaCompressed: { nextSteps: [root], longMemory: {}, queueBackEnd: [], queueFrontEnd: [] },
    module: {
      ref: { ...KEY, workflowVersion: 'rel-1' },
      origin: { kind: 'screen', by: 'cm-by' },
      owner: 'cm-owner',
      revision: overrides.revision ?? 1,
      room: { mode: 'person', members: ['cm-member'] },
      moduleTitle: 'Module title',
      history: overrides.history ?? [{
        at: '2026-10-19T00:00:00.000Z',
        commandId: 'open-1',
        from: null,
        step: 'S',
        actorNow: 'cm-actor',
        done: false,
        executor: { kind: 'person', userId: 'cm-actor' },
      }],
    },
  };
}

function room(): Thread {
  return { threadId: 'room-1' } as Thread;
}

type Call = { name: 'get' | 'open' | 'advance'; asUserId: string; body: unknown };

function envelope(httpStatus: number, body: ResponseBase & Record<string, unknown>): { httpStatus: number; body: ResponseBase & Record<string, unknown> } {
  return { httpStatus, body };
}

function scripted(reply: (call: Call) => Promise<{ httpStatus: number; body: ResponseBase & Record<string, unknown> }>) {
  const calls: Call[] = [];
  const client: Pick<ServerMessagesClient, 'openModuleTask' | 'getModuleTask' | 'advanceModuleTask'> = {
    async getModuleTask(asUserId, input) {
      const call: Call = { name: 'get', asUserId, body: input };
      calls.push(call);
      return reply(call) as ReturnType<ServerMessagesClient['getModuleTask']>;
    },
    async openModuleTask(asUserId, input) {
      const call: Call = { name: 'open', asUserId, body: input };
      calls.push(call);
      return reply(call) as ReturnType<ServerMessagesClient['openModuleTask']>;
    },
    async advanceModuleTask(asUserId, intent) {
      const call: Call = { name: 'advance', asUserId, body: intent };
      calls.push(call);
      return reply(call) as ReturnType<ServerMessagesClient['advanceModuleTask']>;
    },
  };
  return { calls, client };
}

function port(client: Pick<ServerMessagesClient, 'openModuleTask' | 'getModuleTask' | 'advanceModuleTask'>, seen: string[] = []) {
  return createMessagesTaskOccurrencePort({ projectId: '10', moduleId: 'tarefas', asUserId: 'tech-user', identities: identities(seen), client });
}

function openCommand(message?: { content: string }): TaskOccurrenceOpenCommand {
  return {
    ref: { ...KEY, workflowVersion: 'rel-1' },
    plan: plan(),
    title: 'Input title',
    firstStep: 'S',
    actorNow: 'mdm-actor',
    owner: 'mdm-owner',
    origin: { kind: 'screen', by: 'mdm-by' },
    executor: { kind: 'person', mdmId: 'mdm-actor' },
    room: { mode: 'person', members: ['mdm-member'] },
    ...(message === undefined ? {} : { message }),
  };
}

function advanceCommand(message?: { content: string }): TaskOccurrenceAdvanceCommand {
  return {
    taskId: 'task#1',
    commandId: 'cmd-2',
    expectedRevision: 4,
    from: 'S',
    to: 'A',
    actorNow: 'mdm-actor',
    done: false,
    executor: { kind: 'routine', name: 'nightly' },
    note: 'kept',
    wake: { everyMinutes: 15, routine: 'nightly', until: '2026-10-20T00:00:00.000Z' },
    ...(message === undefined ? {} : { message }),
  };
}

test('find turns only the structured not_found into null', async () => {
  for (const httpStatus of [200, 404]) {
    const routed = scripted(async () => envelope(httpStatus, { statusCode: 404, msg: 'not_found' }));
    const found = await port(routed.client).find(ctx(), KEY);
    assert.equal(found, null);
    assert.deepEqual(routed.calls.map((call) => call.name), ['get']);
    assert.equal((routed.calls[0].body as { ref: { workflowVersion?: string } }).ref.workflowVersion, undefined);
  }
});

test('find does not treat other failures as absence', async () => {
  const rejected: Array<{ httpStatus: number; body: { statusCode: number; msg?: string } }> = [
    { httpStatus: 404, body: { statusCode: 404, msg: 'missing' } },
    { httpStatus: 401, body: { statusCode: 401, msg: 'not_found' } },
    { httpStatus: 403, body: { statusCode: 403, msg: 'denied' } },
    { httpStatus: 409, body: { statusCode: 409, msg: 'legacy_module_task' } },
  ];
  for (const item of rejected) {
    const routed = scripted(async () => envelope(item.httpStatus, item.body));
    await assert.rejects(() => port(routed.client).find(ctx(), KEY), (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_CM_REJECTED' && error.statusCode === item.body.statusCode && error.message === 'Module task was rejected.');
  }
  const contradictory = scripted(async () => envelope(500, { statusCode: 200, msg: 'ok' }));
  await assert.rejects(() => port(contradictory.client).find(ctx(), KEY), (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_CM_PROTOCOL_ERROR');
  const routed = scripted(async () => { throw new AppError('MSG_SERVICE_TIMEOUT', 'timed out', 504); });
  await assert.rejects(() => port(routed.client).find(ctx(), KEY), (error: unknown) => error instanceof AppError && error.code === 'MSG_SERVICE_TIMEOUT');
  assert.equal(routed.calls.length, 1);
});

test('scope is rejected before any call or translation', async () => {
  const seen: string[] = [];
  const routed = scripted(async () => { throw new Error('sent'); });
  const occurrence = port(routed.client, seen);
  const foreign = { ...KEY, project: '11' };
  await assert.rejects(() => occurrence.find(ctx(), foreign), (error: unknown) => error instanceof AppError && error.code === 'MSG_APP_SCOPE_INVALID');
  await assert.rejects(() => occurrence.open(ctx(), { ...openCommand(), ref: { ...KEY, project: '10', module: 'other', workflowVersion: null } }), (error: unknown) => error instanceof AppError && error.code === 'MSG_APP_SCOPE_INVALID');
  await assert.rejects(() => occurrence.advance(ctx(), { ...KEY, module: 'other' }, advanceCommand()), (error: unknown) => error instanceof AppError && error.code === 'MSG_APP_SCOPE_INVALID');
  assert.equal(routed.calls.length, 0);
  assert.deepEqual(seen, []);
});

test('open keeps the producer snapshot and projects only a real opening status', async () => {
  const produced = task({ title: 'Stored title', revision: 3 });
  const routed = scripted(async (call) => {
    assert.equal(call.name, 'open');
    const body = call.body as { message?: { content: string }; plan: { steps: unknown[] }; startStep: string; title: string; action?: string };
    assert.equal(body.action, undefined);
    assert.equal(body.message, undefined);
    assert.equal(body.startStep, 'S');
    assert.equal(body.title, 'Input title');
    assert.equal(body.plan.steps.length, 2);
    assert.equal(call.asUserId, 'tech-user');
    return envelope(200, { statusCode: 200, task: produced, room: room(), created: false });
  });
  const opened = await port(routed.client).open(ctx(), openCommand());
  assert.equal(opened.outcome, 'existing');
  assert.equal(opened.occurrence.title, 'Stored title');
  assert.equal(opened.occurrence.revision, 3);
  assert.equal(opened.moduleMessage, undefined);
  assert.equal(routed.calls.length, 1);
});

test('existing open projects the opening history status and created does not invent one', async () => {
  const produced = task({
    history: [{
      at: '2026-10-19T00:00:00.000Z',
      commandId: 'open-1',
      from: null,
      step: 'S',
      actorNow: 'cm-actor',
      done: false,
      executor: { kind: 'person', userId: 'cm-actor' },
      message: { state: 'pending', threadId: 'room-1', content: 'hello', author: 'person' },
    }],
  });
  const existing = scripted(async () => envelope(200, { statusCode: 200, task: produced, room: room(), created: false }));
  const opened = await port(existing.client).open(ctx(), openCommand({ content: 'hello' }));
  assert.equal(opened.outcome, 'existing');
  assert.equal(opened.moduleMessage?.state, 'pending');
  const created = scripted(async (call) => {
    assert.deepEqual((call.body as { message?: { content: string } }).message, { content: 'hello' });
    return envelope(200, { statusCode: 200, task: task(), room: room(), created: true, moduleMessage: { state: 'sent', threadId: 'room-1', orderAt: 'o-1' } });
  });
  const made = await port(created.client).open(ctx(), openCommand({ content: 'hello' }));
  assert.equal(made.outcome, 'created');
  assert.equal(made.moduleMessage?.state, 'sent');
  assert.equal(made.occurrence.owner, 'mdm-owner');
});

test('open failure does not send a second call', async () => {
  const routed = scripted(async () => { throw new AppError('MSG_SERVICE_UNAVAILABLE', 'down', 502); });
  await assert.rejects(() => port(routed.client).open(ctx(), openCommand()), (error: unknown) => error instanceof AppError && error.code === 'MSG_SERVICE_UNAVAILABLE');
  assert.equal(routed.calls.length, 1);
});

test('advance confirms the canonical task and trusts moduleAdvance over revision', async () => {
  const seen: string[] = [];
  let gets = 0;
  const routed = scripted(async (call) => {
    if (call.name === 'get') {
      gets += 1;
      return envelope(200, { statusCode: 200, task: task({ revision: 9 }), room: room() });
    }
    const intent = call.body as AgentIntentModuleAdvance;
    assert.equal(intent.type, 'module-advance');
    assert.equal(intent.to, 'A');
    assert.equal(intent.expectedRevision, 4);
    assert.equal(intent.actorNow, 'cm-actor');
    assert.deepEqual(intent.executor, { kind: 'routine', name: 'nightly' });
    assert.deepEqual(intent.wake, { everyMinutes: 15, routine: 'nightly', until: '2026-10-20T00:00:00.000Z' });
    assert.equal(intent.done, false);
    assert.equal('nextAt' in (intent.wake ?? {}), false);
    const returned = task({
      revision: 9,
      history: [
        {
          at: '2026-10-19T00:00:00.000Z', commandId: 'cmd-1', from: null, step: 'S', actorNow: 'cm-actor', done: false,
          executor: { kind: 'routine', name: 'nightly' }, message: { state: 'sent', threadId: 'room-1', content: 'older', author: 'virtual' },
        },
        {
          at: '2026-10-19T00:01:00.000Z', commandId: 'cmd-2', from: 'S', step: 'A', actorNow: 'cm-actor', done: false,
          executor: { kind: 'routine', name: 'nightly' }, message: { state: 'pending', threadId: 'room-1', content: 'note', author: 'virtual' },
        },
      ],
    });
    return envelope(200, {
      statusCode: 200,
      task: returned,
      moduleAdvance: { commandId: 'cmd-2', outcome: 'unchanged' },
    });
  });
  const result = await port(routed.client, seen).advance(ctx(), KEY, advanceCommand({ content: 'note' }));
  assert.equal(result.outcome, 'unchanged');
  assert.equal(result.occurrence.revision, 9);
  assert.equal(result.moduleMessage?.state, 'pending');
  assert.equal(gets, 1);
  assert.equal(routed.calls.length, 2);
  assert.ok(seen.includes('cm:mdm-actor'));
  assert.equal(seen.includes('cm:nightly'), false);
});

test('applied stays advanced and a lost response is not retried', async () => {
  const applied = scripted(async (call) => {
    if (call.name === 'get') return envelope(200, { statusCode: 200, task: task(), room: room() });
    return envelope(200, {
      statusCode: 200,
      task: task({ revision: 2 }),
      moduleAdvance: { commandId: 'cmd-2', outcome: 'applied' },
      moduleMessage: { state: 'pending', threadId: 'room-1' },
    });
  });
  const moved = await port(applied.client).advance(ctx(), KEY, advanceCommand());
  assert.equal(moved.outcome, 'advanced');
  assert.equal(moved.moduleMessage?.state, 'pending');
  const routed = scripted(async (call) => {
    if (call.name === 'get') return envelope(200, { statusCode: 200, task: task(), room: room() });
    throw new AppError('MSG_SERVICE_TIMEOUT', 'lost', 504);
  });
  await assert.rejects(() => port(routed.client).advance(ctx(), KEY, advanceCommand()), (error: unknown) => error instanceof AppError && error.code === 'MSG_SERVICE_TIMEOUT');
  assert.equal(routed.calls.filter((call) => call.name === 'advance').length, 1);
});

test('canonical conflict and pause use the returned task; other 409 and http-200 body-409 do not advance', async () => {
  for (const msg of ['conflict', 'paused'] as const) {
    const routed = scripted(async (call) => {
      if (call.name === 'get') return envelope(200, { statusCode: 200, task: task(), room: room() });
      return envelope(200, { statusCode: 409, msg, task: task({ revision: 8, status: msg === 'paused' ? 'paused' : 'in progress' }) });
    });
    const result = await port(routed.client).advance(ctx(), KEY, advanceCommand());
    assert.equal(result.outcome, msg === 'paused' ? 'paused' : 'conflict');
    assert.equal(result.occurrence.revision, 8);
  }
  const other = scripted(async (call) => {
    if (call.name === 'get') return envelope(200, { statusCode: 200, task: task(), room: room() });
    return envelope(409, { statusCode: 409, msg: 'legacy_module_task', task: task() });
  });
  await assert.rejects(() => port(other.client).advance(ctx(), KEY, advanceCommand()), (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_CM_REJECTED' && error.statusCode === 409);
  const successMask = scripted(async (call) => {
    if (call.name === 'get') return envelope(200, { statusCode: 200, task: task(), room: room() });
    return envelope(409, { statusCode: 200, msg: 'ok', task: task(), moduleAdvance: { commandId: 'cmd-2', outcome: 'applied' } });
  });
  await assert.rejects(() => port(successMask.client).advance(ctx(), KEY, advanceCommand()), (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_CM_PROTOCOL_ERROR');
});

test('advance rejects a missing moduleAdvance, another task and a divergent ref before or without success', async () => {
  const missing = scripted(async (call) => {
    if (call.name === 'get') return envelope(200, { statusCode: 200, task: task(), room: room() });
    return envelope(200, { statusCode: 200, task: task(), moduleAdvance: { commandId: 'other', outcome: 'applied' } });
  });
  await assert.rejects(() => port(missing.client).advance(ctx(), KEY, advanceCommand()), (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_CM_PROTOCOL_ERROR');
  const absent = scripted(async () => envelope(200, { statusCode: 404, msg: 'not_found' }));
  await assert.rejects(() => port(absent.client).advance(ctx(), KEY, advanceCommand()), (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_TASK_MISMATCH');
  assert.equal(absent.calls.length, 1);
  const wrong = scripted(async () => envelope(200, { statusCode: 200, task: task({ pk: 'task#other' }), room: room() }));
  await assert.rejects(() => port(wrong.client).advance(ctx(), KEY, advanceCommand()), (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_TASK_MISMATCH');
  assert.equal(wrong.calls.some((call) => call.name === 'advance'), false);
});

test('a new port reads only from the client', async () => {
  let n = 0;
  const routed = scripted(async () => {
    n += 1;
    return envelope(200, { statusCode: 200, task: task({ title: `T${n}` }), room: room() });
  });
  const first = await port(routed.client).find(ctx(), KEY);
  const second = await port(routed.client).find(ctx(), KEY);
  assert.equal(first?.title, 'T1');
  assert.equal(second?.title, 'T2');
  assert.equal(routed.calls.length, 2);
});

test('recoverable get failures stay distinct and do not open, repair or advance', async () => {
  const secret = 'task#secret-99';
  const token = 'raw-token-value';
  const degraded: Array<{ httpStatus: number; body: ResponseBase & Record<string, unknown>; code: string; statusCode: number }> = [
    { httpStatus: 200, body: { statusCode: 503, msg: 'busy' }, code: 'WORKFLOW_CM_BUSY', statusCode: 503 },
    { httpStatus: 503, body: { statusCode: 503, msg: 'busy' }, code: 'WORKFLOW_CM_BUSY', statusCode: 503 },
    { httpStatus: 200, body: { statusCode: 503, msg: 'module_task_incomplete', taskId: secret }, code: 'WORKFLOW_CM_TASK_INCOMPLETE', statusCode: 503 },
    { httpStatus: 503, body: { statusCode: 503, msg: 'module_task_incomplete', taskId: secret }, code: 'WORKFLOW_CM_TASK_INCOMPLETE', statusCode: 503 },
    { httpStatus: 200, body: { statusCode: 200, created: false, task: task(), room: null, roomIssue: 'not_linked' }, code: 'WORKFLOW_CM_ROOM_UNAVAILABLE', statusCode: 503 },
    { httpStatus: 200, body: { statusCode: 200, created: false, task: task(), room: null, roomIssue: 'missing' }, code: 'WORKFLOW_CM_ROOM_UNAVAILABLE', statusCode: 503 },
  ];
  for (const item of degraded) {
    for (const op of ['find', 'open', 'advance'] as const) {
      const routed = scripted(async () => envelope(item.httpStatus, item.body));
      const occurrence = port(routed.client);
      const run = op === 'find'
        ? occurrence.find(ctx(), KEY)
        : op === 'open'
          ? occurrence.open(ctx(), openCommand())
          : occurrence.advance(ctx(), KEY, advanceCommand());
      await assert.rejects(run, (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, item.code);
        assert.equal(error.statusCode, item.statusCode);
        assert.equal(error.message.includes(secret), false);
        assert.equal(error.message.includes(token), false);
        assert.equal(error.details, undefined);
        return true;
      });
      assert.deepEqual(routed.calls.map((call) => call.name), [op === 'open' ? 'open' : 'get']);
    }
  }
  const protocolCases: Array<{ httpStatus: number; body: ResponseBase & Record<string, unknown> }> = [
    { httpStatus: 200, body: { statusCode: 503, msg: 'module_task_incomplete' } },
    { httpStatus: 503, body: { statusCode: 503, msg: 'module_task_incomplete', taskId: ' ' } },
    { httpStatus: 200, body: { statusCode: 200, task: task(), room: null } },
    { httpStatus: 200, body: { statusCode: 200, task: task(), room: { threadId: 'room-2' } as Thread, roomIssue: 'missing' } },
    { httpStatus: 200, body: { statusCode: 200, task: task(), room: { threadId: 'room-2' } as Thread } },
    { httpStatus: 503, body: { statusCode: 200, msg: 'busy', task: task(), room: room() } },
    { httpStatus: 403, body: { statusCode: 401, msg: token } },
  ];
  for (const item of protocolCases) {
    const routed = scripted(async () => envelope(item.httpStatus, item.body));
    await assert.rejects(() => port(routed.client).find(ctx(), KEY), (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_CM_PROTOCOL_ERROR' && error.message.includes(secret) === false);
    assert.deepEqual(routed.calls.map((call) => call.name), ['get']);
  }
  const tokenRejected = scripted(async () => envelope(403, { statusCode: 403, msg: token }));
  await assert.rejects(() => port(tokenRejected.client).find(ctx(), KEY), (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_CM_REJECTED' && error.statusCode === 403 && error.message.includes(token) === false);
  const legacy = scripted(async () => envelope(409, { statusCode: 409, msg: 'legacy_module_task' }));
  await assert.rejects(() => port(legacy.client).advance(ctx(), KEY, advanceCommand()), (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_CM_REJECTED' && error.statusCode === 409);
  assert.deepEqual(legacy.calls.map((call) => call.name), ['get']);
});

test('a coherent 422 is a definitive rejection and a mismatched 422 stays protocol', async () => {
  const secret = 'task#secret-99';
  const payload = 'raw-payload-value';
  const status422 = 422 as ResponseBase['statusCode'];
  const accepted: Array<{ httpStatus: number; body: ResponseBase & Record<string, unknown> }> = [
    { httpStatus: 200, body: { statusCode: status422, msg: 'test_rejected', taskId: secret, note: payload } },
    { httpStatus: 422, body: { statusCode: status422, msg: 'test_rejected', detail: payload } },
    { httpStatus: 200, body: { statusCode: status422, msg: 'quota_exceeded', reason: payload } },
  ];
  for (const item of accepted) {
    for (const op of ['find', 'open', 'advance'] as const) {
      const routed = scripted(async (call) => {
        if (op === 'advance' && call.name === 'get') return envelope(200, { statusCode: 200, task: task(), room: room() });
        return envelope(item.httpStatus, item.body);
      });
      const occurrence = port(routed.client);
      const run = op === 'find'
        ? occurrence.find(ctx(), KEY)
        : op === 'open'
          ? occurrence.open(ctx(), openCommand())
          : occurrence.advance(ctx(), KEY, advanceCommand());
      await assert.rejects(run, (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'WORKFLOW_CM_REJECTED');
        assert.equal(error.statusCode, 422);
        assert.equal(error.message, 'Module task was rejected.');
        assert.equal(error.message.includes(secret), false);
        assert.equal(error.message.includes(payload), false);
        assert.equal(error.message.includes('test_rejected'), false);
        assert.equal(error.details, undefined);
        return true;
      });
      assert.deepEqual(routed.calls.map((call) => call.name), op === 'advance' ? ['get', 'advance'] : [op === 'open' ? 'open' : 'get']);
    }
  }
  const invalid: Array<{ httpStatus: number; body: ResponseBase & Record<string, unknown> }> = [
    { httpStatus: 422, body: { statusCode: 200, msg: 'ok', task: task(), moduleAdvance: { commandId: 'cmd-2', outcome: 'applied' } } },
    { httpStatus: 403, body: { statusCode: status422, msg: 'test_rejected', taskId: secret } },
  ];
  for (const item of invalid) {
    for (const op of ['find', 'open', 'advance'] as const) {
      const routed = scripted(async (call) => {
        if (op === 'advance' && call.name === 'get') return envelope(200, { statusCode: 200, task: task(), room: room() });
        return envelope(item.httpStatus, item.body);
      });
      const occurrence = port(routed.client);
      const run = op === 'find'
        ? occurrence.find(ctx(), KEY)
        : op === 'open'
          ? occurrence.open(ctx(), openCommand())
          : occurrence.advance(ctx(), KEY, advanceCommand());
      await assert.rejects(run, (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_CM_PROTOCOL_ERROR' && error.message.includes(secret) === false && error.message.includes(payload) === false);
      assert.deepEqual(routed.calls.map((call) => call.name), op === 'advance' ? ['get', 'advance'] : [op === 'open' ? 'open' : 'get']);
    }
  }
});

test('factory rejects an empty binding', () => {
  assert.throws(() => createMessagesTaskOccurrencePort({
    projectId: ' ',
    moduleId: 'tarefas',
    asUserId: 'tech-user',
    identities: identities([]),
    client: scripted(async () => envelope(200, { statusCode: 404, msg: 'not_found' })).client,
  }), (error: unknown) => error instanceof AppError && error.code === 'MSG_APP_NOT_CONFIGURED');
});
