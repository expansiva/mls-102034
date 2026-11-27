/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/cm/once.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { runAsCallerModule } from '/_102034_/l1/server/layer_1_external/connections/callerModule.js';
import type { CmServeAnswer } from '/_102034_/l1/server/layer_1_external/connections/cm/serveCm.js';
import type { CmSendChannelMessageOutput } from '/_102034_/l2/shared/contracts/connections/cm.js';
import { once, resetOnceMemory } from '/_102034_/l1/server/layer_1_external/connections/cm/once.js';
import { createMemoryModuleDataRuntime } from '/_102034_/l1/server/layer_1_external/data/moduleDataRuntime.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

function ctxOf(moduleData: ReturnType<typeof createMemoryModuleDataRuntime>): RequestContext {
  return { data: { moduleData } } as unknown as RequestContext;
}

/** The ctx of a transaction, the way `serveCm` hands it to the module. */
async function inTx<T>(runtime: ReturnType<typeof createMemoryModuleDataRuntime>, run: (ctx: RequestContext) => Promise<T>): Promise<T> {
  return runtime.runInTransaction((tx) => run(ctxOf(tx)));
}

const WHERE = { scope: 'sendChannelMessage', key: 'k-1' };

describe('rt325 s1: once (memory)', () => {
  const runtime = createMemoryModuleDataRuntime({ appEnv: 'development', projectId: '0' } as unknown as AppEnv);
  beforeEach(() => resetOnceMemory());

  it('the second call with the same key gets the stored answer and the work does not run', async () => {
    let runs = 0;
    const work = async () => { runs += 1; return { ok: true as const, n: runs }; };
    const first = await runAsCallerModule('telegram', () => inTx(runtime, (ctx) => once(ctx, WHERE, work)));
    const second = await runAsCallerModule('telegram', () => inTx(runtime, (ctx) => once(ctx, WHERE, work)));
    assert.deepEqual(first, { ok: true, n: 1 });
    assert.deepEqual(second, { ok: true, n: 1 });
    assert.equal(runs, 1);
  });

  it('the module comes from the platform: the same scope and key in another module is another entry', async () => {
    let runs = 0;
    const work = async () => ++runs;
    await runAsCallerModule('agents', () => inTx(runtime, (ctx) => once(ctx, WHERE, work)));
    await runAsCallerModule('telegram', () => inTx(runtime, (ctx) => once(ctx, WHERE, work)));
    assert.equal(runs, 2);
  });

  it('a refusal (an answer) is stored like any answer', async () => {
    let runs = 0;
    const work = async () => { runs += 1; return { ok: false as const, code: 'refused', message: 'no' }; };
    await runAsCallerModule('telegram', () => inTx(runtime, (ctx) => once(ctx, WHERE, work)));
    const again = await runAsCallerModule('telegram', () => inTx(runtime, (ctx) => once(ctx, WHERE, work)));
    assert.deepEqual(again, { ok: false, code: 'refused', message: 'no' });
    assert.equal(runs, 1);
  });

  it('an exception is not stored: the repeat runs the work again', async () => {
    let runs = 0;
    await assert.rejects(
      runAsCallerModule('telegram', () => inTx(runtime, (ctx) => once(ctx, WHERE, async () => { runs += 1; throw new Error('boom'); }))),
      /boom/u,
    );
    const second = await runAsCallerModule('telegram', () => inTx(runtime, (ctx) => once(ctx, WHERE, async () => { runs += 1; return 'done'; })));
    assert.equal(second, 'done');
    assert.equal(runs, 2);
  });

  it('two simultaneous calls with the same key run the work once and both get the same answer', async () => {
    let runs = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const work = async () => { runs += 1; await gate; return { n: runs }; };
    const a = runAsCallerModule('telegram', () => inTx(runtime, (ctx) => once(ctx, WHERE, work)));
    const b = runAsCallerModule('telegram', () => inTx(runtime, (ctx) => once(ctx, WHERE, work)));
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    assert.deepEqual(await Promise.all([a, b]), [{ n: 1 }, { n: 1 }]);
    assert.equal(runs, 1);
  });

  it('outside a transaction, outside a module, or without scope/key, it throws', async () => {
    await assert.rejects(runAsCallerModule('telegram', () => once(ctxOf(runtime), WHERE, async () => 1)), /inside a transaction/u);
    await assert.rejects(inTx(runtime, (ctx) => once(ctx, WHERE, async () => 1)), /needs a running module/u);
    await assert.rejects(runAsCallerModule('telegram', () => inTx(runtime, (ctx) => once(ctx, { scope: '', key: 'x' }, async () => 1))), /scope and key/u);
  });

  it('accepts the typed answer of the catalog (an interface) with no cast, and keeps it without the keys that are undefined', async () => {
    const work = async (): Promise<CmServeAnswer<CmSendChannelMessageOutput>> => ({ ok: false, code: 'refused', message: 'no', reason: undefined });
    const answer = await runAsCallerModule('telegram', () => inTx(runtime, (ctx) => once(ctx, WHERE, work)));
    assert.deepEqual(answer, { ok: false, code: 'refused', message: 'no' });
    assert.equal('reason' in answer, false, 'the first run answers what a repeat will answer');
    const again = await runAsCallerModule('telegram', () => inTx(runtime, (ctx) => once(ctx, WHERE, work)));
    assert.deepEqual(again, answer);
    const ok = await runAsCallerModule('telegram', () => inTx(runtime, (ctx) => once(ctx, { ...WHERE, key: 'k-2' }, async (): Promise<CmServeAnswer<CmSendChannelMessageOutput>> => ({ ok: true, output: { channelMessageId: 'c' } }))));
    assert.deepEqual(ok, { ok: true, output: { channelMessageId: 'c' } });
  });

  it('the type refuses a function or a Date in the answer (it does not compile)', async () => {
    // @ts-expect-error a function is not JSON
    const withFunction = once(undefined as never, WHERE, async () => ({ run: () => 1 }));
    // @ts-expect-error a Date comes back as a string
    const withDate = once(undefined as never, WHERE, async () => ({ at: new Date() }));
    await Promise.allSettled([withFunction, withDate]);
  });

  it('refuses at run time what JSON would change, with the path, and keeps nothing', async () => {
    const bad: Array<[string, unknown, RegExp]> = [
      ['a list with undefined', { items: [1, undefined] }, /answer\.items\[1\] is undefined in a list/u],
      ['a Date', { at: new Date() }, /answer\.at is an instance of Date/u],
      ['NaN', { n: Number.NaN }, /answer\.n is a number that is not finite/u],
      ['Infinity', { n: Number.POSITIVE_INFINITY }, /answer\.n is a number that is not finite/u],
      ['a function', { f: () => 1 }, /answer\.f is a function/u],
      ['a nested class', { deep: { map: new Map() } }, /answer\.deep\.map is an instance of Map/u],
    ];
    for (const [name, value, message] of bad) {
      await assert.rejects(
        runAsCallerModule('telegram', () => inTx(runtime, (ctx) => once(ctx, { scope: 's', key: name }, async () => value as never))),
        (error: unknown) => (error as { code?: string }).code === 'ONCE_ANSWER_NOT_JSON' && message.test((error as Error).message),
        name,
      );
    }
    let runs = 0;
    const after = await runAsCallerModule('telegram', () => inTx(runtime, (ctx) => once(ctx, { scope: 's', key: 'a list with undefined' }, async () => { runs += 1; return { ok: 1 }; })));
    assert.deepEqual(after, { ok: 1 });
    assert.equal(runs, 1, 'a refused answer was not stored');
  });
});
