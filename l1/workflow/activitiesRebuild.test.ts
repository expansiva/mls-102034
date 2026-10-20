/// <mls fileReference="_102034_/l1/workflow/activitiesRebuild.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { ResponseListModuleTasks, TaskModuleRef } from '/_102036_/l2/shared/interfaces.js';
import {
  rebuildWorkflowActivityPage,
  type TaskOccurrencePort,
  type TaskOccurrenceSnapshot,
  type WorkflowActivityStore,
} from '/_102034_/l1/workflow/index.js';
import type { OccurrenceKey } from '/_102034_/l1/workflow/contracts.js';

const PROJECT = 'app-1';
const MODULE = 'mod-1';

type ListResult = {
  httpStatus: number;
  body: { statusCode?: number; msg?: string; items?: ResponseListModuleTasks['items']; cursor?: string; code?: string };
};

function ctx(): RequestContext {
  return {
    sessionContext: { project: { projectId: PROJECT } },
    clock: { nowIso: () => '2026-10-20T00:00:00.000Z' },
  } as RequestContext;
}

function ref(recordId: string, patch: Partial<TaskModuleRef> = {}): TaskModuleRef {
  return {
    project: PROJECT,
    module: MODULE,
    processId: 'proc',
    entity: 'Tarefa',
    recordId,
    workflowVersion: '1',
    ...patch,
  };
}

function item(recordId: string, taskId = `task-${recordId}`, patch: Partial<TaskModuleRef> = {}) {
  return { ref: ref(recordId, patch), taskId, revision: 1, status: 'in progress' as const };
}

function snapshot(recordId: string, taskId: string, patch: Partial<TaskOccurrenceSnapshot> = {}): TaskOccurrenceSnapshot {
  return {
    ref: ref(recordId),
    taskId,
    revision: 4,
    status: 'paused',
    ...patch,
  } as TaskOccurrenceSnapshot;
}

function keyOf(recordId: string): OccurrenceKey {
  const source = ref(recordId);
  return {
    project: source.project,
    module: source.module,
    processId: source.processId,
    entity: source.entity,
    recordId: source.recordId,
  };
}

function token(key: OccurrenceKey): string {
  return JSON.stringify([key.project, key.module, key.processId, key.entity, key.recordId]);
}

function harness(pages: ListResult[]) {
  const calls: Array<{ cursor?: string; pageSize: number; userId: string }> = [];
  const rows = new Map<string, TaskOccurrenceSnapshot | null>();
  const finds: OccurrenceKey[] = [];
  const commands: string[] = [];
  let listUses = 0;
  const client = {
    async listModuleTasks(userId: string, input: { project: string; module: string; cursor?: string; pageSize: number }) {
      calls.push({ cursor: input.cursor, pageSize: input.pageSize, userId });
      const page = pages[listUses] ?? pages.at(-1);
      listUses += 1;
      return page as Awaited<ReturnType<NonNullable<Parameters<typeof rebuildWorkflowActivityPage>[1]['client']>['listModuleTasks']>>;
    },
  };
  const basePort: TaskOccurrencePort = {
    kind: 'task',
    async open() {
      commands.push('open');
      throw new Error('open');
    },
    async advance() {
      commands.push('advance');
      throw new Error('advance');
    },
    async find(_ctx, key) {
      commands.push('find');
      finds.push(key);
      return rows.get(`source:${token(key)}`) ?? null;
    },
  };
  const store: WorkflowActivityStore = {
    projectId: PROJECT,
    moduleId: MODULE,
    async refresh(_ctx, key, loadOccurrence) {
      commands.push('refresh');
      const occurrence = await loadOccurrence();
      rows.set(token(key), occurrence);
      return { state: occurrence ? 'synced' : 'absent', occurrence };
    },
    async list() {
      commands.push('store.list');
      throw new Error('store.list');
    },
  };
  return { calls, rows, finds, commands, client, basePort, store, source: rows };
}

test('a failed first insert is rediscovered from the list without a local row', async () => {
  const page = harness([{ httpStatus: 200, body: { statusCode: 200, items: [item('rec-1', 'task-new')] } }]);
  page.rows.set('source:' + token(keyOf('rec-1')), snapshot('rec-1', 'task-new', { revision: 2, status: 'in progress' }));
  const result = await rebuildWorkflowActivityPage(ctx(), {
    projectId: PROJECT,
    moduleId: MODULE,
    client: page.client,
    store: page.store,
    basePort: page.basePort,
  });
  assert.equal(result.counts.refreshed, 1);
  assert.equal(result.counts.failed, 0);
  assert.equal(result.cursor, undefined);
  assert.equal(page.rows.get(token(keyOf('rec-1')))?.taskId, 'task-new');
  assert.equal(page.calls[0]?.userId, `app:${PROJECT}`);
  assert.equal(page.calls[0]?.pageSize, 50);
  assert.deepEqual(page.commands.filter((name) => name === 'open' || name === 'advance' || name === 'store.list'), []);
});

test('two pages restart from the first cursor and stay idempotent', async () => {
  const page = harness([
    { httpStatus: 200, body: { statusCode: 200, items: [item('rec-1')], cursor: 'page-2' } },
    { httpStatus: 200, body: { statusCode: 200, items: [item('rec-2')] } },
    { httpStatus: 200, body: { statusCode: 200, items: [item('rec-1')], cursor: 'page-2' } },
  ]);
  page.rows.set('source:' + token(keyOf('rec-1')), snapshot('rec-1', 'task-rec-1'));
  page.rows.set('source:' + token(keyOf('rec-2')), snapshot('rec-2', 'task-rec-2'));
  const first = await rebuildWorkflowActivityPage(ctx(), {
    projectId: PROJECT, moduleId: MODULE, client: page.client, store: page.store, basePort: page.basePort,
  });
  const second = await rebuildWorkflowActivityPage(ctx(), {
    projectId: PROJECT, moduleId: MODULE, cursor: first.cursor, client: page.client, store: page.store, basePort: page.basePort,
  });
  const again = await rebuildWorkflowActivityPage(ctx(), {
    projectId: PROJECT, moduleId: MODULE, client: page.client, store: page.store, basePort: page.basePort,
  });
  assert.equal(first.cursor, 'page-2');
  assert.equal(second.cursor, undefined);
  assert.equal(second.counts.refreshed, 1);
  assert.equal(again.counts.refreshed, 1);
  assert.equal(page.calls[1]?.cursor, 'page-2');
  assert.equal(page.calls[2]?.cursor, undefined);
  assert.equal(page.finds.filter((key) => key.recordId === 'rec-1').length, 2);
});

test('one item failure continues the rest of the page', async () => {
  const page = harness([{
    httpStatus: 200,
    body: { statusCode: 200, items: [item('bad'), item('good')], cursor: 'next' },
  }]);
  page.rows.set('source:' + token(keyOf('good')), snapshot('good', 'task-good'));
  const finding = page.basePort.find.bind(page.basePort);
  page.basePort.find = async (context, key) => {
    if (key.recordId === 'bad') throw new AppError('WORKFLOW_PROJECTION_SOURCE_STALE', 'older', 503);
    return finding(context, key);
  };
  const result = await rebuildWorkflowActivityPage(ctx(), {
    projectId: PROJECT, moduleId: MODULE, client: page.client, store: page.store, basePort: page.basePort,
  });
  assert.equal(result.cursor, 'next');
  assert.equal(result.counts.refreshed, 1);
  assert.equal(result.counts.failed, 1);
  assert.equal(result.failures[0]?.code, 'WORKFLOW_PROJECTION_SOURCE_STALE');
  assert.equal(result.failures[0]?.ref?.recordId, 'bad');
  assert.equal(page.rows.has(token(keyOf('bad'))), false);
  assert.equal(page.rows.get(token(keyOf('good')))?.taskId, 'task-good');
});

test('an invalid list does not advance the cursor or refresh', async () => {
  const page = harness([{ httpStatus: 503, body: { code: 'down', items: [item('rec-1')], cursor: 'next' } }]);
  await assert.rejects(
    () => rebuildWorkflowActivityPage(ctx(), {
      projectId: PROJECT, moduleId: MODULE, cursor: 'start', client: page.client, store: page.store, basePort: page.basePort,
    }),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_CM_PROTOCOL_ERROR',
  );
  assert.equal(page.commands.includes('refresh'), false);
});

test('an HTTP 200 carrying an error envelope is a protocol error before any refresh', async () => {
  const page = harness([{ httpStatus: 200, body: { statusCode: 503, msg: 'busy', items: [item('rec-1')], cursor: 'next' } }]);
  await assert.rejects(
    () => rebuildWorkflowActivityPage(ctx(), {
      projectId: PROJECT, moduleId: MODULE, client: page.client, store: page.store, basePort: page.basePort,
    }),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_CM_PROTOCOL_ERROR' && error.statusCode === 502,
  );
  assert.equal(page.commands.includes('refresh'), false);
});

test('a repeated cursor is a protocol error before any refresh', async () => {
  const page = harness([{ httpStatus: 200, body: { statusCode: 200, items: [item('rec-1')], cursor: 'same' } }]);
  await assert.rejects(
    () => rebuildWorkflowActivityPage(ctx(), {
      projectId: PROJECT, moduleId: MODULE, cursor: 'same', client: page.client, store: page.store, basePort: page.basePort,
    }),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_CM_PROTOCOL_ERROR',
  );
  assert.equal(page.commands.includes('refresh'), false);
});

test('the canonical get wins over an older listed revision and pause', async () => {
  const page = harness([{
    httpStatus: 200,
    body: { statusCode: 200, items: [{ ...item('rec-1'), revision: 1, status: 'in progress' }] },
  }]);
  page.rows.set('source:' + token(keyOf('rec-1')), snapshot('rec-1', 'task-rec-1', { revision: 9, status: 'paused' }));
  await rebuildWorkflowActivityPage(ctx(), {
    projectId: PROJECT, moduleId: MODULE, client: page.client, store: page.store, basePort: page.basePort,
  });
  const stored = page.rows.get(token(keyOf('rec-1')));
  assert.equal(stored?.revision, 9);
  assert.equal(stored?.status, 'paused');
});

test('confirmed absence removes the ref and a 503 does not', async () => {
  const page = harness([{ httpStatus: 200, body: { statusCode: 200, items: [item('gone'), item('busy')] } }]);
  page.rows.set(token(keyOf('gone')), snapshot('gone', 'task-gone'));
  page.rows.set(token(keyOf('busy')), snapshot('busy', 'task-busy'));
  const finding = page.basePort.find.bind(page.basePort);
  page.basePort.find = async (context, key) => {
    if (key.recordId === 'gone') return null;
    if (key.recordId === 'busy') throw new AppError('MSG_SERVICE_UNAVAILABLE', 'down', 503);
    return finding(context, key);
  };
  const result = await rebuildWorkflowActivityPage(ctx(), {
    projectId: PROJECT, moduleId: MODULE, client: page.client, store: page.store, basePort: page.basePort,
  });
  assert.equal(result.counts.absent, 1);
  assert.equal(page.rows.get(token(keyOf('gone'))), null);
  assert.equal(page.rows.get(token(keyOf('busy')))?.taskId, 'task-busy');
  assert.equal(result.failures[0]?.code, 'MSG_SERVICE_UNAVAILABLE');
});

test('scope mismatches and duplicate refs do not refresh twice or cross the application', async () => {
  const foreign = item('other', 'task-other', { project: 'app-2' });
  const page = harness([{
    httpStatus: 200,
    body: { statusCode: 200, items: [item('rec-1'), item('rec-1'), foreign] },
  }]);
  page.rows.set('source:' + token(keyOf('rec-1')), snapshot('rec-1', 'task-rec-1'));
  const result = await rebuildWorkflowActivityPage(ctx(), {
    projectId: PROJECT, moduleId: MODULE, pageSize: 500, client: page.client, store: page.store, basePort: page.basePort,
  });
  assert.equal(page.calls[0]?.pageSize, 200);
  assert.equal(page.finds.length, 1);
  assert.equal(result.counts.refreshed, 1);
  assert.equal(result.counts.failed, 1);
  assert.equal(result.failures[0]?.code, 'MSG_APP_SCOPE_INVALID');
  assert.equal(result.counts.listed, 2);
});

test('a listed task id that disagrees with the canonical task is not stored', async () => {
  const page = harness([{ httpStatus: 200, body: { statusCode: 200, items: [item('rec-1', 'listed-id')] } }]);
  page.rows.set('source:' + token(keyOf('rec-1')), snapshot('rec-1', 'canonical-id'));
  page.rows.set(token(keyOf('rec-1')), snapshot('rec-1', 'previous'));
  const result = await rebuildWorkflowActivityPage(ctx(), {
    projectId: PROJECT, moduleId: MODULE, client: page.client, store: page.store, basePort: page.basePort,
  });
  assert.equal(result.counts.failed, 1);
  assert.equal(result.failures[0]?.code, 'WORKFLOW_PROJECTION_INVALID');
  assert.equal(page.rows.get(token(keyOf('rec-1')))?.taskId, 'previous');
});

test('a task that has no local row is still refreshed', async () => {
  const page = harness([{ httpStatus: 200, body: { statusCode: 200, items: [item('known'), item('fresh')] } }]);
  page.rows.set(token(keyOf('known')), snapshot('known', 'task-known'));
  page.rows.set('source:' + token(keyOf('known')), snapshot('known', 'task-known'));
  page.rows.set('source:' + token(keyOf('fresh')), snapshot('fresh', 'task-fresh'));
  const result = await rebuildWorkflowActivityPage(ctx(), {
    projectId: PROJECT, moduleId: MODULE, client: page.client, store: page.store, basePort: page.basePort,
  });
  assert.equal(result.counts.refreshed, 2);
  assert.equal(page.rows.get(token(keyOf('fresh')))?.taskId, 'task-fresh');
});

test('a session for another application does not list tasks', async () => {
  const page = harness([{ httpStatus: 200, body: { statusCode: 200, items: [] } }]);
  const foreign = ctx();
  foreign.sessionContext = { project: { projectId: 'other' } } as RequestContext['sessionContext'];
  await assert.rejects(
    () => rebuildWorkflowActivityPage(foreign, {
      projectId: PROJECT, moduleId: MODULE, client: page.client, store: page.store, basePort: page.basePort,
    }),
    (error: unknown) => error instanceof AppError && error.code === 'MSG_APP_SCOPE_INVALID',
  );
  assert.equal(page.calls.length, 0);
});
