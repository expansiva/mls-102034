/// <mls fileReference="_102034_/l1/workflow/personCmLink.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createPersonCmLinker } from '/_102034_/l1/workflow/personCmLink.js';

const ctx = {} as RequestContext;

test('a person without a link is linked once, and not again after it worked', async () => {
  const calls: string[] = [];
  const link = createPersonCmLinker({ isConfigured: () => true, toCmUserId: async (_c, id) => { calls.push(id); return 'cm-1'; }, log: () => {} });
  await link(ctx, 'person-1');
  await link(ctx, 'person-1');
  await link(ctx, 'person-2');
  assert.deepEqual(calls, ['person-1', 'person-2']);
});

test('two logins at once make one call', async () => {
  let calls = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const link = createPersonCmLinker({ isConfigured: () => true, toCmUserId: async () => { calls += 1; await gate; return 'cm-1'; }, log: () => {} });
  const first = link(ctx, 'person-1');
  const second = link(ctx, 'person-1');
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test('the cm being down never throws, logs the code without ids, and the next login tries again', async () => {
  const logs: string[] = [];
  let fail = true;
  let calls = 0;
  const link = createPersonCmLinker({
    isConfigured: () => true,
    toCmUserId: async () => {
      calls += 1;
      if (fail) throw new AppError('WORKFLOW_CM_UNAVAILABLE', 'person-1 pessoa@x.test', 503);
      return 'cm-1';
    },
    log: (line) => logs.push(line),
  });
  await link(ctx, 'person-1');
  assert.deepEqual(logs, ['session/info cm link failed: WORKFLOW_CM_UNAVAILABLE']);
  assert.equal(logs.join().includes('person-1'), false);
  assert.equal(logs.join().includes('@'), false);
  fail = false;
  await link(ctx, 'person-1');
  await link(ctx, 'person-1');
  assert.equal(calls, 2);
  await createPersonCmLinker({ isConfigured: () => true, toCmUserId: async () => { throw new Error('x'); }, log: (line) => logs.push(line) })(ctx, 'p');
  assert.equal(logs[1], 'session/info cm link failed: unknown');
});

test('without the cm integration nothing is called', async () => {
  let calls = 0;
  const link = createPersonCmLinker({ isConfigured: () => false, toCmUserId: async () => { calls += 1; return 'cm'; }, log: () => {} });
  await link(ctx, 'person-1');
  assert.equal(calls, 0);
});
