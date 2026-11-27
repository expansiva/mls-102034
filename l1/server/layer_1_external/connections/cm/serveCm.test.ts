/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/cm/serveCm.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { AppError, type BffRequest, type BffResponse, type IRequestEnvelope, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { runAsCallerModule } from '/_102034_/l1/server/layer_1_external/connections/callerModule.js';
import { cmServeInputTypes } from '/_102034_/l1/server/layer_1_external/connections/cm/cmInputTypes.js';
import { checkCmServeInput } from '/_102034_/l1/server/layer_1_external/connections/cm/cmInputCheck.js';
import { serveCm, type CmServeAnswer } from '/_102034_/l1/server/layer_1_external/connections/cm/serveCm.js';
import { createConnectionServer } from '/_102034_/l1/workflow/connectionServe.js';
import { parseContractSource } from '/_102034_/l1/workflow/assistantContractSource.js';
import { cm as cmCatalog } from '/_102034_/l2/shared/contracts/connections/cm.js';
import type { CmSendChannelMessageOutput } from '/_102034_/l2/shared/contracts/connections/cm.js';

const WRITTEN = '2026-11-27T10:00:00.123Z';
const SEND = { to: { conversationRef: 'c-1' }, text: 'oi', writtenAt: WRITTEN, messageRef: 'm-1' };

describe('rt325 s3: the input of the cm, by the type of cm.ts', () => {
  it('a union of objects: each alternative fits, a third form does not, and the message names the field', () => {
    assert.equal(checkCmServeInput('sendChannelMessage', SEND), null);
    assert.equal(checkCmServeInput('sendChannelMessage', { ...SEND, to: { address: '+5511', botRef: 'b-1' } }), null);
    assert.match(checkCmServeInput('sendChannelMessage', { ...SEND, to: { address: '+5511' } }) ?? '', /to\.botRef is required|to must be one of/u);
    assert.match(checkCmServeInput('sendChannelMessage', { ...SEND, to: { conversationRef: 'c', botRef: 'b' } }) ?? '', /to\.botRef is not permitted|to must be one of/u);
    assert.match(checkCmServeInput('sendChannelMessage', { ...SEND, to: 'c-1' }) ?? '', /to must be one of/u);
  });

  it('required, optional and extra fields, wrong primitive types, and null', () => {
    assert.match(checkCmServeInput('sendChannelMessage', { ...SEND, text: undefined }) ?? '', /^text is required/u);
    assert.match(checkCmServeInput('sendChannelMessage', { ...SEND, text: 5 }) ?? '', /text must be a string/u);
    assert.match(checkCmServeInput('sendChannelMessage', { ...SEND, extra: 1 }) ?? '', /^extra is not permitted/u);
    assert.match(checkCmServeInput('sendChannelMessage', { ...SEND, text: null }) ?? '', /text must be a string/u);
    assert.equal(checkCmServeInput('setChannelConversationIdentity', { conversationRef: 'c' }), null, 'identity, displayName and since are optional');
    assert.equal(checkCmServeInput('setChannelConversationIdentity', { conversationRef: 'c', identity: { mdmId: 'p' }, since: WRITTEN }), null);
    assert.match(checkCmServeInput('setChannelConversationIdentity', { conversationRef: 'c', identity: { phone: '1' } }) ?? '', /identity/u);
    assert.equal(checkCmServeInput('disableChannel', { target: { botRef: 'b' }, reason: 'x' }), null);
    assert.match(checkCmServeInput('disableChannel', { target: { botRef: 'b' } }) ?? '', /^reason is required/u);
    assert.match(checkCmServeInput('record', { executionId: 'e', agentId: 'a', mode: 'maybe' }) ?? '', /mode is not a permitted value/u);
    assert.throws(() => checkCmServeInput('nothing', {}), (e: unknown) => e instanceof AppError && e.statusCode === 503, 'an operation without a type is unavailable, never a pass');
  });

  it('the default reader is unchanged: without keepUnions a union of objects is still `unknown`', () => {
    const source = 'export interface A { to: { a: string } | { b: string }; list: Array<{ x: string }> }';
    const plain = parseContractSource(source).types.A;
    assert.equal(plain.kind === 'object' && plain.fields[0].type.kind, 'primitive');
    const kept = parseContractSource(source, { keepUnions: true }).types.A;
    assert.equal(kept.kind === 'object' && kept.fields[0].type.kind, 'union');
    assert.equal(kept.kind === 'object' && kept.fields[1].type.kind === 'array' && kept.fields[1].type.of.kind, 'object');
  });
});

/** A moduleData that records what a real transaction would do: commit when the callback returns, rollback when it throws. */
function harness() {
  const events: string[] = [];
  const moduleData = {
    runInTransaction: async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => {
      events.push('begin');
      const tx = { marker: 'tx' };
      try {
        const result = await callback(tx);
        events.push('commit');
        return result;
      } catch (error) {
        events.push('rollback');
        throw error;
      }
    },
  };
  const ctx = { data: { moduleData }, requestMeta: {} } as unknown as RequestContext;
  const request = (over: Partial<NonNullable<BffRequest['meta']>> = {}, params: unknown = SEND, operationId = 'sendChannelMessage'): BffRequest => ({
    routine: 'telegram.cm.sendChannelMessage',
    params,
    meta: {
      userId: 'connection:cm',
      verifiedAuthorities: ['telegram:connection:cm'],
      connection: { connectionId: 'cm', operationId, context: {} },
      ...over,
    },
  }) as unknown as BffRequest;
  return { events, ctx, request };
}

const asModule = <T>(work: () => T): T => runAsCallerModule('telegram', work);

describe('rt325 s3b: the input types are data that follow the source of cm.ts', () => {
  it('the tree of cmInputTypes is exactly what the contract reader reads from cm.ts, for every served operation', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', 'l2', 'shared', 'contracts', 'connections', 'cm.ts'), 'utf8');
    const { types } = parseContractSource(source, { keepUnions: true });
    for (const operation of cmCatalog.operations.filter((candidate) => candidate.direction === 'serve')) {
      assert.deepEqual(cmServeInputTypes[operation.inputType], types[operation.inputType], operation.inputType);
    }
    for (const [name, node] of Object.entries(cmServeInputTypes)) assert.deepEqual(node, types[name], name);
  });
  it('a type that is missing is unavailable with a line in the log', () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
      assert.throws(() => checkCmServeInput('nothing', {}), /not known by this release/u);
    } finally {
      console.error = original;
    }
    assert.match(lines[0] ?? '', /no input type for the served operation nothing/u);
  });
});

describe('rt325 s3: serveCm', () => {
  it('runs decide inside the transaction, with the ctx bound to it, and answers the output', async () => {
    const h = harness();
    let seenTx: unknown;
    const route = serveCm('sendChannelMessage', async (input, ctx) => {
      seenTx = (ctx.data.moduleData as unknown as { marker: string }).marker;
      assert.deepEqual(input, SEND);
      return { ok: true, output: { channelMessageId: 'x' } satisfies CmSendChannelMessageOutput };
    });
    const answer = await asModule(() => route({ request: h.request(), ctx: h.ctx } as IRequestEnvelope));
    assert.deepEqual(answer, { ok: true, data: { channelMessageId: 'x' }, error: null });
    assert.equal(seenTx, 'tx');
    assert.deepEqual(h.events, ['begin', 'commit']);
  });

  it('a refusal commits what the module wrote and is returned as an error with ONE shape; reason leads the message', async () => {
    const h = harness();
    const route = serveCm('sendChannelMessage', async () => ({ ok: false, code: 'refused', reason: 'conversationBlocked', message: 'The conversation is blocked.' }));
    await assert.rejects(
      asModule(() => route({ request: h.request(), ctx: h.ctx } as IRequestEnvelope)),
      (error: unknown) => error instanceof AppError && error.statusCode === 422 && error.message === 'conversationBlocked: The conversation is blocked.',
    );
    assert.deepEqual(h.events, ['begin', 'commit'], 'the refusal is a decision: it commits');
  });

  it('an exception undoes everything: a 4xx AppError keeps its code, anything else is a 500', async () => {
    const h = harness();
    const notFound = serveCm('sendChannelMessage', async () => { throw new AppError('NOT_FOUND', 'no such bot', 404); });
    await assert.rejects(asModule(() => notFound({ request: h.request(), ctx: h.ctx } as IRequestEnvelope)), (e: unknown) => e instanceof AppError && e.code === 'NOT_FOUND' && e.statusCode === 404);
    const boom = serveCm('sendChannelMessage', async () => { throw new Error('db down'); });
    await assert.rejects(asModule(() => boom({ request: h.request(), ctx: h.ctx } as IRequestEnvelope)), /db down/u);
    assert.deepEqual(h.events, ['begin', 'rollback', 'begin', 'rollback']);
  });

  it('origin: not the cm, another operation, or without the authority of the module → 403 and decide does not run', async () => {
    const h = harness();
    let ran = 0;
    const route = serveCm('sendChannelMessage', async () => { ran += 1; return { ok: true, output: { channelMessageId: 'x' } }; });
    const cases: Array<Partial<NonNullable<BffRequest['meta']>>> = [
      { connection: undefined },
      { connection: { connectionId: 'telegram', operationId: 'sendChannelMessage', context: { organizationId: 'org-1' } } },
      { connection: { connectionId: 'cm', operationId: 'disableChannel', context: { organizationId: 'org-1' } } },
      { verifiedAuthorities: [] },
      { verifiedAuthorities: ['agents:connection:cm'] },
    ];
    for (const over of cases) {
      await assert.rejects(asModule(() => route({ request: h.request(over), ctx: h.ctx } as IRequestEnvelope)), (e: unknown) => e instanceof AppError && e.statusCode === 403, JSON.stringify(over));
    }
    assert.equal(ran, 0);
    assert.deepEqual(h.events, []);
  });

  it('an input that does not fit the catalog type is 400 with the path, before any transaction', async () => {
    const h = harness();
    const route = serveCm('sendChannelMessage', async () => ({ ok: true, output: { channelMessageId: 'x' } }));
    await assert.rejects(
      asModule(() => route({ request: h.request({}, { ...SEND, to: { address: 'a' } }), ctx: h.ctx } as IRequestEnvelope)),
      (e: unknown) => e instanceof AppError && e.statusCode === 400 && /to/u.test(e.message),
    );
    assert.deepEqual(h.events, []);
  });
});

describe('rt325 s3: the refusal reaches the cm with the same code (through the real connectionServe)', () => {
  const codes = ['refused', 'invalid', 'not_found', 'conflict', 'forbidden'] as const;
  for (const code of codes) {
    it(`${code}`, async () => {
      const h = harness();
      const route = serveCm('sendChannelMessage', async (): Promise<CmServeAnswer<CmSendChannelMessageOutput>> => ({ ok: false, code, reason: 'whyNot', message: 'No.' }));
      const serve = createConnectionServer({
        catalogOf: async () => cmCatalog,
        index: async () => ({ byOperation: new Map([['cm.sendChannelMessage', [{ moduleId: 'telegram', route: 'telegram.cm.sendChannelMessage' }]]]), issues: [] }),
        newContext: () => h.ctx,
        log: () => undefined,
        // What execBff does with a route: a thrown AppError becomes the error body and its status.
        execMessage: async (request) => {
          try {
            const response = await asModule(() => route({ request: { ...request, meta: { ...request.meta, verifiedAuthorities: request.meta?.verifiedAuthorities } } as BffRequest, ctx: h.ctx } as IRequestEnvelope));
            return { response, statusCode: 200 };
          } catch (error) {
            if (!(error instanceof AppError)) throw error;
            return { response: { ok: false, data: null, error: { code: error.code, message: error.message } } as BffResponse, statusCode: error.statusCode };
          }
        },
      });
      const result = await serve({ connectionId: 'cm', operationId: 'sendChannelMessage', input: SEND, context: { organizationId: 'org-1' }, targetModuleId: 'telegram' });
      assert.equal(result.ok, false);
      assert.equal(result.ok === false && result.code, code);
      assert.equal(result.ok === false && result.message, 'whyNot: No.');
    });
  }
});
