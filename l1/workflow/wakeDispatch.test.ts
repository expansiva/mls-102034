/// <mls fileReference="_102034_/l1/workflow/wakeDispatch.test.ts" enhancement="_blank"/>
import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { ModuleWakeEvent } from '/_102036_/l2/shared/interfaces.js';
import type {
  OccurrenceKey,
  TaskOccurrencePort,
  TaskOccurrenceSnapshot,
} from '/_102034_/l1/workflow/contracts.js';
import type { WorkflowPlan } from '/_102034_/l1/workflow/plan.js';
import type { WorkflowWakeHandler, WorkflowWakeScope } from '/_102034_/l1/workflow/wakeContracts.js';
import { workflowWakeCommandId } from '/_102034_/l1/workflow/wakeContracts.js';
import { createWorkflowWakeDispatcher } from '/_102034_/l1/workflow/wakeDispatch.js';

const PROJECT = '900001';
const MODULE = 'modA';

function event(overrides: Partial<ModuleWakeEvent> = {}): ModuleWakeEvent {
  return {
    eventId: 'task-1:wait:1:1',
    scheduledAt: '2026-10-20T12:00:00Z',
    attempt: 1,
    ref: {
      project: PROJECT,
      module: MODULE,
      entity: 'order',
      recordId: 'rec-1',
      processId: 'procA',
      workflowVersion: null,
    },
    taskId: 'task-1',
    stepKey: 'wait',
    pass: 1,
    seq: 1,
    revision: 3,
    routine: 'onWait',
    ...overrides,
  };
}

function plan(stepId = 'wait'): WorkflowPlan {
  return {
    processId: 'procA',
    title: 'Plan',
    moduleTitle: 'Module',
    steps: [{
      stepId,
      kind: 'wait',
      title: 'Wait',
      next: [],
      ownerKind: 'clock',
    }],
  };
}

function snapshot(overrides: Partial<TaskOccurrenceSnapshot> = {}): TaskOccurrenceSnapshot {
  return {
    ref: {
      project: PROJECT,
      module: MODULE,
      entity: 'order',
      recordId: 'rec-1',
      processId: 'procA',
      workflowVersion: null,
    },
    step: 'wait',
    actorNow: null,
    done: false,
    plan: plan(),
    title: 'Occurrence',
    taskId: 'task-1',
    revision: 4,
    status: 'in progress',
    owner: 'owner-1',
    origin: { kind: 'event' },
    room: { mode: 'exclusive' },
    roomId: 'room-1',
    pass: 1,
    wake: {
      everyMinutes: 5,
      routine: 'onWait',
      nextAt: '2026-10-20T12:00:00Z',
      seq: 1,
      until: '2026-10-21T00:00:00Z',
    },
    history: [],
    ...overrides,
  };
}

function harness(options: {
  occurrence?: TaskOccurrenceSnapshot | null;
  findError?: unknown;
  handlers?: Map<string, WorkflowWakeHandler>;
  now?: Date;
  integrationError?: unknown;
} = {}) {
  const calls: string[] = [];
  const contexts: RequestContext[] = [];
  const seen = new Map<string, { event: ModuleWakeEvent; occurrence: TaskOccurrenceSnapshot }>();
  const handlers = options.handlers ?? new Map<string, WorkflowWakeHandler>();
  if (!options.handlers) {
    handlers.set(key({ projectId: PROJECT, moduleId: MODULE, processId: 'procA', routine: 'onWait' }), async (ctx, item, occurrence) => {
      calls.push('handler');
      seen.set(item.eventId, { event: item, occurrence });
      assert.equal(ctx.sandbox, undefined);
      assert.equal(ctx.requestMeta?.userId, undefined);
    });
  }
  const port: TaskOccurrencePort = {
    kind: 'task',
    async open() {
      calls.push('open');
      throw new Error('dispatcher must not open');
    },
    async find(_ctx, keyRef: OccurrenceKey) {
      calls.push(`find:${keyRef.project}:${keyRef.module}:${keyRef.entity}:${keyRef.recordId}:${keyRef.processId}`);
      if (options.findError) throw options.findError;
      return options.occurrence === undefined ? snapshot() : options.occurrence;
    },
    async advance() {
      calls.push('advance');
      throw new Error('dispatcher must not advance');
    },
  };
  const dispatcher = createWorkflowWakeDispatcher(PROJECT, MODULE, {
    port,
    now: () => options.now ?? new Date('2026-10-20T12:00:01Z'),
    companyId: () => 'company-canonical',
    readIntegration: () => {
      if (options.integrationError) throw options.integrationError;
      return { organizationId: 'org-1' };
    },
    createContext: () => {
      const ctx = createRequestContext(createMemoryDataRuntime(), {
        sandbox: true,
        sessionContext: {
          actorId: 'env-person',
          actorScope: ['admin', 'writer'],
          person: { mdmId: 'p1', email: 'a@b.c', name: 'Env' },
          actorSession: { actorId: 'env-person', scope: ['admin', 'writer'] },
          activeCompanyId: 'env-company',
        },
        organization: { countryCode: 'BR', currency: 'BRL', timezone: 'America/Sao_Paulo' },
      });
      ctx.requestMeta = { source: 'http', requestId: 'other', userId: 'a@b.c' };
      contexts.push(ctx);
      return ctx;
    },
    resolve: async (scope) => {
      calls.push(`resolve:${scope.projectId}:${scope.moduleId}:${scope.processId}:${scope.routine}`);
      const handler = handlers.get(key(scope));
      if (!handler) {
        throw new AppError('WORKFLOW_WAKE_HANDLER_UNAVAILABLE', 'missing', 503);
      }
      return handler;
    },
  });
  return { dispatcher, calls, contexts, seen, handlers };
}

function key(scope: WorkflowWakeScope): string {
  return `${scope.projectId}:${scope.moduleId}:${scope.processId}:${scope.routine}`;
}

test('contexto de rotina zera ator do env e guarda empresa, locale e projeto', async () => {
  const { dispatcher, contexts } = harness();
  await dispatcher.dispatch(event());
  const ctx = contexts[0];
  assert.ok(ctx);
  assert.equal(ctx.sessionContext.person, undefined);
  assert.equal(ctx.sessionContext.actorId, undefined);
  assert.deepEqual(ctx.sessionContext.actorScope, []);
  assert.equal(ctx.sessionContext.actorSession.actorId, undefined);
  assert.deepEqual(ctx.sessionContext.actorSession.scope, []);
  assert.equal(ctx.sessionContext.activeCompanyId, 'company-canonical');
  assert.equal(ctx.sessionContext.businessContext.activeCompanyId, 'company-canonical');
  assert.equal(ctx.sessionContext.project.projectId, PROJECT);
  assert.equal(ctx.moduleId, MODULE);
  assert.equal(ctx.organization.countryCode, 'BR');
  assert.equal(ctx.requestMeta?.source, 'message');
  assert.equal(ctx.requestMeta?.requestId, 'task-1:wait:1:1');
  assert.equal(ctx.requestMeta?.userId, undefined);
  assert.equal(ctx.sandbox, undefined);
  await dispatcher.dispatch(event());
  assert.notEqual(contexts[0], contexts[1]);
});

test('find nulo é stale e 403, 503, incompleto ou transporte não apagam nem chamam handler', async () => {
  const missing = harness({ occurrence: null });
  assert.equal(await missing.dispatcher.dispatch(event()), 'stale');
  assert.equal(missing.calls.includes('handler'), false);

  for (const error of [
    new AppError('WORKFLOW_CM_REJECTED', 'no', 403),
    new AppError('WORKFLOW_CM_BUSY', 'no', 503),
    new AppError('WORKFLOW_CM_TASK_INCOMPLETE', 'no', 503),
    new Error('socket hang up'),
  ]) {
    const run = harness({ findError: error });
    const result = await run.dispatcher.dispatch(event());
    assert.equal(run.calls.includes('handler'), false);
    assert.equal(run.calls.includes('advance'), false);
    assert.deepEqual(result, {
      retry: {
        code: error instanceof AppError ? 'WORKFLOW_WAKE_CANONICAL_UNAVAILABLE' : 'WORKFLOW_WAKE_HANDLER_FAILED',
      },
    });
  }
});

test('task, ref ou revisão menor que a observação viram retry de protocolo', async () => {
  const wrongTask = harness({ occurrence: snapshot({ taskId: 'other-task' }) });
  assert.deepEqual(await wrongTask.dispatcher.dispatch(event()), { retry: { code: 'WORKFLOW_WAKE_PROTOCOL' } });
  const wrongRef = harness({ occurrence: snapshot({ ref: { ...snapshot().ref, recordId: 'other' } }) });
  assert.deepEqual(await wrongRef.dispatcher.dispatch(event()), { retry: { code: 'WORKFLOW_WAKE_PROTOCOL' } });
  const regressed = harness({ occurrence: snapshot({ revision: 2 }) });
  assert.deepEqual(await regressed.dispatcher.dispatch(event({ revision: 3 })), { retry: { code: 'WORKFLOW_WAKE_PROTOCOL' } });
  assert.equal(wrongTask.calls.includes('handler'), false);
});

test('comando já aplicado aceita sem handler mesmo com passo encerrado', async () => {
  const commandId = workflowWakeCommandId('task-1:wait:1:1');
  const { dispatcher, calls } = harness({
    occurrence: snapshot({
      status: 'done',
      step: 'end',
      done: true,
      history: [{
        at: '2026-10-20T12:00:02Z',
        commandId,
        executor: { kind: 'routine', name: 'onWait' },
        by: null,
        from: 'wait',
        step: 'end',
        actorNow: null,
        done: true,
      }],
    }),
  });
  assert.equal(await dispatcher.dispatch(event()), 'accepted');
  assert.equal(calls.includes('handler'), false);
  assert.equal(calls.some((call) => call.startsWith('resolve')), false);
});

test('done, passo, pass, seq, wake, rotina e until vencido são stale sem efeito', async () => {
  const cases: TaskOccurrenceSnapshot[] = [
    snapshot({ status: 'done' }),
    snapshot({ step: 'end' }),
    snapshot({ step: 'other' }),
    snapshot({ pass: 2 }),
    snapshot({ wake: { ...snapshot().wake!, seq: 9 } }),
    snapshot({ wake: undefined }),
    snapshot({ wake: { ...snapshot().wake!, routine: 'other' } }),
    snapshot({ wake: { ...snapshot().wake!, until: '2026-10-20T11:00:00Z' } }),
  ];
  for (const occurrence of cases) {
    const run = harness({ occurrence });
    assert.equal(await run.dispatcher.dispatch(event()), 'stale');
    assert.equal(run.calls.includes('handler'), false);
    assert.equal(run.calls.includes('advance'), false);
    assert.equal(run.calls.includes('open'), false);
  }
});

test('paused fica pendente e revisão maior com o mesmo passo executa', async () => {
  const paused = harness({ occurrence: snapshot({ status: 'paused' }) });
  assert.deepEqual(await paused.dispatcher.dispatch(event()), { retry: { code: 'WORKFLOW_WAKE_PAUSED' } });
  assert.equal(paused.calls.includes('handler'), false);

  const higher = harness({ occurrence: snapshot({ revision: 8 }) });
  assert.equal(await higher.dispatcher.dispatch(event({ revision: 3 })), 'accepted');
  assert.equal(higher.calls.filter((call) => call === 'handler').length, 1);

  const equal = harness({ occurrence: snapshot({ revision: 3 }) });
  assert.equal(await equal.dispatcher.dispatch(event({ revision: 3 })), 'accepted');
});

test('reentrada, transferência e novo período usam o comando do evento', async () => {
  const first = harness();
  assert.equal(await first.dispatcher.dispatch(event()), 'accepted');
  const again = event({ eventId: 'task-1:wait:1:2', seq: 2 });
  const transferred = harness({
    occurrence: snapshot({
      step: 'other',
      wake: { ...snapshot().wake!, routine: 'onOther', seq: 2 },
      plan: plan('other'),
    }),
  });
  assert.equal(await transferred.dispatcher.dispatch({ ...again, stepKey: 'other', routine: 'onWait' }), 'stale');

  let ran = 0;
  const next = harness({
    occurrence: snapshot({ wake: { ...snapshot().wake!, seq: 2 } }),
    handlers: new Map([[key({ projectId: PROJECT, moduleId: MODULE, processId: 'procA', routine: 'onWait' }), async () => {
      ran += 1;
    }]]),
  });
  assert.equal(await next.dispatcher.dispatch(again), 'accepted');
  assert.equal(ran, 1);
  assert.equal(first.seen.get('task-1:wait:1:1')?.occurrence.revision, 4);
});

test('fonte 503 não chama find e handlers de escopo não se misturam', async () => {
  const down = harness({ integrationError: new AppError('MSG_APP_NOT_CONFIGURED', 'no', 503) });
  assert.deepEqual(await down.dispatcher.dispatch(event()), { retry: { code: 'WORKFLOW_WAKE_CANONICAL_UNAVAILABLE' } });
  assert.equal(down.calls.length, 0);

  const ran: string[] = [];
  const handlers = new Map<string, WorkflowWakeHandler>([
    [key({ projectId: PROJECT, moduleId: MODULE, processId: 'procA', routine: 'onWait' }), async () => {
      ran.push('a');
    }],
    [key({ projectId: PROJECT, moduleId: MODULE, processId: 'procB', routine: 'onWait' }), async () => {
      ran.push('b');
    }],
  ]);
  const run = harness({
    handlers,
    occurrence: snapshot({ ref: { ...snapshot().ref, processId: 'procB' } }),
  });
  const item = event({ ref: { ...event().ref, processId: 'procB' } });
  assert.equal(await run.dispatcher.dispatch(item), 'accepted');
  assert.deepEqual(ran, ['b']);
});

test('exceção do handler volta código sanitizado e o mesmo evento', async () => {
  const handlers = new Map<string, WorkflowWakeHandler>([
    [key({ projectId: PROJECT, moduleId: MODULE, processId: 'procA', routine: 'onWait' }), async () => {
      throw new Error('database password leaked');
    }],
  ]);
  const run = harness({ handlers });
  const item = event();
  assert.deepEqual(await run.dispatcher.dispatch(item), { retry: { code: 'WORKFLOW_WAKE_HANDLER_FAILED' } });
  assert.equal(JSON.stringify(await run.dispatcher.dispatch(item)).includes('password'), false);
});

test('passo fora do plano persistido não executa', async () => {
  const run = harness({ occurrence: snapshot({ plan: plan('other') }) });
  assert.deepEqual(await run.dispatcher.dispatch(event()), { retry: { code: 'WORKFLOW_WAKE_NOT_CURRENT' } });
  assert.equal(run.calls.includes('handler'), false);
});
