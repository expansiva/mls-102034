/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/cm/cmBench.test.ts" enhancement="_blank" />
// rt325 s5: the cm of the script. A module of fixture (SOURCE .ts in a folder, no dist) serves `sendChannelMessage` with `serveCm` + `once`;
// the bench asks it through the REAL connectionServe. The proof says what is a double: "cm of the script" (the answers of the cm).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import { runAsCallerModule } from '/_102034_/l1/server/layer_1_external/connections/callerModule.js';
import { cm, isTransient } from '/_102034_/l1/server/layer_1_external/connections/cm/index.js';
import { installCmBench, type CmBench } from '/_102034_/l1/server/layer_1_external/connections/cm/cmBench.js';
import { resetOnceMemory } from '/_102034_/l1/server/layer_1_external/connections/cm/once.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';

const PROJECT = '900301';
const MODULE = 'chan';
const root = mkdtempSync(path.join(tmpdir(), 'cm-bench-project-'));
const SENDS = '__cmBenchSends';
let bench: CmBench | undefined;

function write(file: string, text: string): void {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
}

before(() => {
  write(`l1/${MODULE}/layer_1_external/adapters/http/controllers/cm.ts`, `
import { serveCm, once } from '/_102034_/l1/server/layer_1_external/connections/cm/index.js';
export const routes = [
  {
    key: '${MODULE}.cm.sendChannelMessage',
    handler: serveCm('sendChannelMessage', async (input, ctx) => once(ctx, { scope: 'sendChannelMessage', key: input.messageRef }, async () => {
      const sends = ((globalThis as Record<string, unknown>)['${SENDS}'] ??= []) as string[];
      sends.push(input.messageRef);
      return input.text === 'refuse'
        ? { ok: false as const, code: 'refused' as const, reason: 'conversationBlocked', message: 'blocked' }
        : { ok: true as const, output: { channelMessageId: 'ch-' + sends.length } };
    })),
  },
];
`);
  write(`l1/${MODULE}/layer_2_application/requests/cm.defs.ts`, `
export const definition = { data: { requests: [{ route: '${MODULE}.cm.sendChannelMessage', kind: 'cmd', serves: 'cm.sendChannelMessage' }] } };
`);
  write(`l1/${MODULE}/layer_1_external/adapters/persistence/registerRepositories.ts`, 'export {};\n');
});

afterEach(() => {
  bench?.restore();
  bench = undefined;
  resetOnceMemory();
  (globalThis as Record<string, unknown>)[SENDS] = [];
});

after(() => rmSync(root, { recursive: true, force: true }));

const SEND = { to: { conversationRef: 'c-1' }, text: 'oi', writtenAt: '2026-11-27T10:00:00.123Z', messageRef: 'm-1' };
const sends = () => ((globalThis as Record<string, unknown>)[SENDS] ?? []) as string[];

describe('rt325 s5: the cm of the script', () => {
  it('the cm asks the module twice with the same key: one execution, the same answer (serveCm + once through the real connectionServe)', async () => {
    bench = installCmBench(PROJECT, {}, { projectRoot: root });
    const context = { organizationId: 'org-bench' };
    const first = await bench.serve('sendChannelMessage', SEND, context, { targetModuleId: MODULE, idempotencyKey: 'cm-key-1' });
    const second = await bench.serve('sendChannelMessage', SEND, context, { targetModuleId: MODULE, idempotencyKey: 'cm-key-1' });
    assert.deepEqual(first, { ok: true, output: { channelMessageId: 'ch-1' } });
    assert.deepEqual(second, first);
    assert.deepEqual(sends(), ['m-1'], 'the module ran once');
  });

  it('a refusal comes back with the same code and the reason first in the message, and a repeat gets the same refusal', async () => {
    bench = installCmBench(PROJECT, {}, { projectRoot: root });
    const input = { ...SEND, text: 'refuse', messageRef: 'm-refuse' };
    const answer = await bench.serve('sendChannelMessage', input, { organizationId: 'org-bench' }, { targetModuleId: MODULE, idempotencyKey: 'cm-key-2' });
    assert.deepEqual(answer.ok === false && [answer.code, answer.message], ['refused', 'conversationBlocked: blocked']);
    const again = await bench.serve('sendChannelMessage', input, { organizationId: 'org-bench' }, { targetModuleId: MODULE, idempotencyKey: 'cm-key-2' });
    assert.deepEqual(again, answer);
    assert.equal(sends().length, 1);
  });

  it('an input that does not fit the type of the catalog is invalid, and the module does not run', async () => {
    bench = installCmBench(PROJECT, {}, { projectRoot: root });
    const answer = await bench.serve('sendChannelMessage', { ...SEND, to: { address: 'only' } } as never, { organizationId: 'org-bench' }, { targetModuleId: MODULE });
    assert.equal(answer.ok === false && answer.code, 'invalid');
    assert.equal(sends().length, 0);
  });

  it('the module calls the cm: the call is recorded with its key; a scripted operation answers; one without script is unavailable, never an invented success', async () => {
    bench = installCmBench(PROJECT, { notifyPerson: () => ({ ok: true, output: { status: 'sent' } }) }, { projectRoot: root });
    const ctx = createRequestContext();
    ctx.requestMeta = { requestId: 'req-1', userId: 'u', source: 'message' } as typeof ctx.requestMeta;
    const sent = await runAsCallerModule(MODULE, () => cm(ctx).notifyPerson({ contact: 'a@b.c', text: 'hi' }));
    assert.deepEqual(sent, { ok: true, output: { status: 'sent' } });
    const missing = await runAsCallerModule(MODULE, () => cm(ctx).listAgents({}));
    assert.equal(missing.ok === false && missing.message, 'cm bench: listAgents not scripted');
    assert.equal(isTransient(missing), true);
    assert.deepEqual(bench.calls.map((call) => [call.operationId, call.idempotencyKey]), [['notifyPerson', 'req-1:notifyPerson'], ['listAgents', undefined]]);
    assert.equal(bench.calls[0].context.callerModuleId, MODULE, 'the module is stamped by the platform');
  });

  it('restore() gives the real wiring back: the sandbox of the project is gone and the working folder is the same', async () => {
    const before = process.cwd();
    bench = installCmBench(PROJECT, {}, { projectRoot: root });
    assert.notEqual(process.cwd(), before);
    bench.restore();
    bench = undefined;
    assert.equal(process.cwd(), before);
  });
});
