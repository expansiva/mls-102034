/// <mls fileReference="_102034_/l1/workflow/wakeLoop.test.ts" enhancement="_blank"/>
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { ModuleWakeEvent } from '/_102036_/l2/shared/interfaces.js';
import type {
  WorkflowWakeDispatchResult,
  WorkflowWakeRunNextResult,
} from '/_102034_/l1/workflow/wakeContracts.js';
import { WorkflowWakeInboxLoop, type WorkflowWakeTimer } from '/_102034_/l1/workflow/wakeLoop.js';

const PROJECT = '900001';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness(options: {
  runtimeMode?: 'memory' | 'postgres';
  tickEnabled?: boolean;
  runNext?: (
    projectId: string,
    dispatch: (event: ModuleWakeEvent) => Promise<WorkflowWakeDispatchResult>,
  ) => Promise<WorkflowWakeRunNextResult>;
} = {}) {
  const calls: string[] = [];
  const timers: Array<() => void> = [];
  let cleared = 0;
  let stores = 0;
  let dispatchers = 0;
  const loop = new WorkflowWakeInboxLoop({
    resolveProjectId: () => PROJECT,
    readEnv: () => ({
      runtimeMode: options.runtimeMode ?? 'postgres',
      tickEnabled: options.tickEnabled ?? false,
    }),
    createStore: () => {
      stores += 1;
      return {
        async enqueue() {
          throw new Error('enqueue is not used by the loop');
        },
        runNext: async (projectId, dispatch) => {
          calls.push(projectId);
          if (options.runNext) return options.runNext(projectId, dispatch);
          return 'empty';
        },
      };
    },
    createDispatcher: () => {
      dispatchers += 1;
      return { async dispatch() { return 'accepted'; } };
    },
    schedule: (callback) => {
      timers.push(callback);
      return { unref() {} } satisfies WorkflowWakeTimer;
    },
    clearTimer: () => {
      cleared += 1;
    },
  });
  return { loop, calls, timers, stores: () => stores, dispatchers: () => dispatchers, cleared: () => cleared };
}

test('start runs one round immediately and arms a single timer', async () => {
  const { loop, calls, timers, stores } = harness();
  await loop.start();
  assert.deepEqual(calls, [PROJECT]);
  assert.equal(timers.length, 1);
  assert.equal(stores(), 1);
  await loop.start();
  assert.deepEqual(calls, [PROJECT]);
  assert.equal(timers.length, 1);
  await loop.stop();
});

test('a round stops at twenty drains and continues after busy or retry', async () => {
  const seen: WorkflowWakeRunNextResult[] = [];
  const { loop, calls } = harness({
    runNext: async () => {
      const result: WorkflowWakeRunNextResult = calls.length <= 2 ? 'busy' : calls.length === 3 ? 'retry' : 'accepted';
      seen.push(result);
      return result;
    },
  });
  await loop.start();
  assert.equal(calls.length, 20);
  assert.deepEqual(seen.slice(0, 3), ['busy', 'busy', 'retry']);
  await loop.stop();
});

test('empty ends the round without asking the dispatcher', async () => {
  let dispatched = 0;
  const { loop, dispatchers } = harness({
    runNext: async (_projectId, dispatch) => {
      void dispatch;
      dispatched += 0;
      return 'empty';
    },
  });
  await loop.start();
  assert.equal(dispatched, 0);
  assert.equal(dispatchers(), 0);
  await loop.stop();
});

test('stop waits for the round that is already running', async () => {
  const gate = deferred<WorkflowWakeRunNextResult>();
  let entered = 0;
  const { loop, timers, cleared } = harness({
    runNext: async () => {
      entered += 1;
      if (entered === 1) return 'empty';
      return gate.promise;
    },
  });
  await loop.start();
  assert.equal(timers.length, 1);
  const running = loop.runOnce();
  await Promise.resolve();
  assert.equal(entered, 2);
  let stopped = false;
  const stopping = loop.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  assert.equal(stopped, false);
  gate.resolve('empty');
  await running;
  await stopping;
  assert.equal(stopped, true);
  assert.equal(cleared(), 1);
  const after = entered;
  await loop.runOnce();
  assert.equal(entered, after);
});

test('a failed round logs a sanitized code and the next round runs', async () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (line?: unknown) => {
    warnings.push(String(line));
  };
  let attempt = 0;
  try {
    const { loop } = harness({
      runNext: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('payload token secret');
        return 'empty';
      },
    });
    await loop.start();
    assert.deepEqual(warnings, ['[workflow-wake] WORKFLOW_WAKE_LOOP_FAILED']);
    assert.equal(warnings.some((line) => line.includes('secret')), false);
    await loop.runOnce();
    assert.equal(attempt, 2);
    await loop.stop();
  } finally {
    console.warn = original;
  }
});

test('a known wake code is kept and a local overlap does not start a second drain', async () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (line?: unknown) => {
    warnings.push(String(line));
  };
  const gate = deferred<WorkflowWakeRunNextResult>();
  let entered = 0;
  try {
    const { loop, timers } = harness({
      runNext: async () => {
        entered += 1;
        if (entered === 1) {
          throw new AppError('WORKFLOW_WAKE_HANDLER_FAILED', 'hidden body', 500);
        }
        return gate.promise;
      },
    });
    await loop.start();
    assert.deepEqual(warnings, ['[workflow-wake] WORKFLOW_WAKE_HANDLER_FAILED']);
    const again = loop.runOnce();
    await Promise.resolve();
    timers[0]?.();
    assert.equal(entered, 2);
    gate.resolve('empty');
    await again;
    await loop.stop();
  } finally {
    console.warn = original;
  }
});

test('tick disabled still drains postgres, and memory never opens a store', async () => {
  const postgres = harness({ runtimeMode: 'postgres', tickEnabled: false });
  await postgres.loop.start();
  assert.equal(postgres.calls.length, 1);
  await postgres.loop.stop();

  const memory = harness({ runtimeMode: 'memory', tickEnabled: true });
  await memory.loop.start();
  await memory.loop.start();
  assert.equal(memory.stores(), 0);
  assert.equal(memory.timers.length, 0);
  await memory.loop.runOnce();
  assert.equal(memory.stores(), 0);
});

test('the loop source does not schedule work or keep events', () => {
  const source = readFileSync(new URL('./wakeLoop.ts', import.meta.url), 'utf8');
  assert.equal(/everyMinutes|onTick|createTask|new Map/.test(source), false);
});
