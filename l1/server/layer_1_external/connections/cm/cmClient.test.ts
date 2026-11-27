/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/cm/cmClient.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CallConnection, CallConnectionContext, CallConnectionOptions } from '/_102034_/l1/server/layer_1_external/connections/callConnection.js';
import { createCmClient, isTransient } from '/_102034_/l1/server/layer_1_external/connections/cm/cmClient.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { ConnectionResult } from '/_102034_/l2/shared/contracts/connections/types.js';

type Seen = { operationId: string; input: unknown; context: CallConnectionContext; opts?: CallConnectionOptions };

function harness(ctxOver: { connectionKey?: string; requestId?: string; mdmId?: string } = {}, answer: ConnectionResult | Error = { ok: true, output: { agents: [] } }) {
  const seen: Seen[] = [];
  const call: CallConnection = async (connectionId, operationId, input, context, opts) => {
    assert.equal(connectionId, 'cm');
    seen.push({ operationId, input, context, opts });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const ctx = {
    requestMeta: {
      ...(ctxOver.requestId !== undefined ? { requestId: ctxOver.requestId } : {}),
      ...(ctxOver.connectionKey !== undefined ? { connection: { connectionId: 'cm', operationId: 'x', context: {}, idempotencyKey: ctxOver.connectionKey } } : {}),
    },
    sessionContext: { person: ctxOver.mdmId !== undefined ? { mdmId: ctxOver.mdmId } : undefined },
  } as unknown as RequestContext;
  return { client: createCmClient(ctx, call), seen };
}

describe('rt325 s2: cm(ctx)', () => {
  it('calls the operation by name with the person of the ctx; the default key of a command is <key of the request>:<operation>', async () => {
    const h = harness({ connectionKey: 'arrival-1', requestId: 'req-9', mdmId: 'p-1' });
    const result = await h.client.channelMessageReceived({ conversationRef: 'c', audience: 'member', conversationKind: 'person', author: { channelAccountId: 'a', name: 'A' }, writtenAt: 'now', text: 'oi' });
    assert.equal(result.ok, true);
    assert.equal(h.seen[0].operationId, 'channelMessageReceived');
    assert.equal(h.seen[0].context.actorMdmId, 'p-1');
    assert.equal(h.seen[0].opts?.idempotencyKey, 'arrival-1:channelMessageReceived');
    assert.equal(h.seen[0].opts?.requestId, 'req-9');
  });

  it('without a key of the arrival it falls back to the request id; a key passed by the module wins; a query takes no key', async () => {
    const h = harness({ requestId: 'req-9' });
    await h.client.notifyPerson({ contact: 'x', text: 't' });
    await h.client.notifyPerson({ contact: 'x', text: 't' }, { idempotencyKey: 'mine' });
    await h.client.listAgents({});
    assert.equal(h.seen[0].opts?.idempotencyKey, 'req-9:notifyPerson');
    assert.equal(h.seen[1].opts?.idempotencyKey, 'mine');
    assert.equal(h.seen[2].opts?.idempotencyKey, undefined);
  });

  it('never throws: a caller that throws comes back as unavailable; a failure result is passed as it is', async () => {
    const thrown = await harness({ requestId: 'r' }, new Error('network down')).client.listAgents({});
    assert.deepEqual(thrown.ok === false && thrown.code, 'unavailable');
    const refused = await harness({ requestId: 'r' }, { ok: false, code: 'refused', message: 'no' }).client.listAgents({});
    assert.deepEqual(refused, { ok: false, code: 'refused', message: 'no' });
  });

  it('isTransient is true only for unavailable', () => {
    for (const code of ['refused', 'invalid', 'not_found', 'conflict', 'forbidden', 'disabled'] as const) {
      assert.equal(isTransient({ ok: false, code, message: 'm' }), false, code);
    }
    assert.equal(isTransient({ ok: false, code: 'unavailable', message: 'm' }), true);
    assert.equal(isTransient({ ok: true, output: 1 }), false);
  });

  it('the client has the 13 call operations and nothing else', () => {
    const client = harness().client as unknown as Record<string, unknown>;
    assert.equal(typeof client.listAgents, 'function');
    assert.equal(client.sendChannelMessage, undefined, 'a serve operation is not callable');
  });
});
