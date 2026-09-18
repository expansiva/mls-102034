/// <mls fileReference="_102034_/l1/server/layer_2_application/tick/moduleTick.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadModuleTickHandlers,
  type ModuleTickRegistration,
} from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import {
  ModuleTickLoop,
  runModuleTick,
  type TickContextFactory,
} from '/_102034_/l1/server/layer_2_application/tick/moduleTick.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

/** The tick never reads the context in these tests; only which moduleId it was built for. */
const contextFor: TickContextFactory = (moduleId) => ({ moduleId } as unknown as RequestContext);

function handler(moduleId: string, calls: string[], fail = false): ModuleTickRegistration {
  return {
    moduleId,
    onTick: async (ctx, now) => {
      calls.push(`${moduleId}@${ctx.moduleId}@${now.toISOString()}`);
      if (fail) {
        throw new Error(`${moduleId} exploded`);
      }
    },
  };
}

test('runModuleTick calls every module in series with its own context', async () => {
  const calls: string[] = [];
  const now = new Date('2026-09-17T10:00:00.000Z');
  await runModuleTick([handler('alpha', calls), handler('beta', calls)], contextFor, now);
  assert.deepEqual(calls, [
    'alpha@alpha@2026-09-17T10:00:00.000Z',
    'beta@beta@2026-09-17T10:00:00.000Z',
  ]);
});

test('a module that throws does not stop the modules after it', async () => {
  const calls: string[] = [];
  await runModuleTick(
    [handler('alpha', calls, true), handler('beta', calls)],
    contextFor,
    new Date('2026-09-17T10:00:00.000Z'),
  );
  assert.deepEqual(calls.map((call) => call.split('@')[0]), ['alpha', 'beta']);
});

test('the loop skips the minute when the previous tick is still running', async () => {
  const gate: { release: (() => void) | null } = { release: null };
  let entered = 0;
  const slow: ModuleTickRegistration = {
    moduleId: 'slow',
    onTick: () => {
      entered += 1;
      return new Promise<void>((resolve) => {
        gate.release = resolve;
      });
    },
  };
  const loop = new ModuleTickLoop(contextFor, 60_000, async () => [slow]);
  await loop.start();

  const first = loop.runOnce(new Date('2026-09-17T10:00:00.000Z'));
  await loop.runOnce(new Date('2026-09-17T10:01:00.000Z'));
  assert.equal(entered, 1, 'the second minute must be skipped while the first is still running');
  gate.release?.();
  await first;

  // Free again: the next minute runs.
  const third = loop.runOnce(new Date('2026-09-17T10:02:00.000Z'));
  assert.equal(entered, 2);
  gate.release?.();
  await third;
  loop.stop();
});

test('the registry collects onTick only from modules that export one', async () => {
  const handlers = await loadModuleTickHandlers();
  assert.equal(Array.isArray(handlers), true);
  // No module emits onTick yet (the backend generator does, in another front), so the platform
  // starts with an empty list instead of failing.
  for (const registration of handlers) {
    assert.equal(typeof registration.moduleId, 'string');
    assert.equal(typeof registration.onTick, 'function');
  }
});
