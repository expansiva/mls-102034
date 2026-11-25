/// <mls fileReference="_102034_/l2/shared/contracts/connections/cmChannelOperations.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CmSendChannelMessageInput } from '/_102034_/l2/shared/contracts/connections/cm.js';
import cm from '/_102034_/l2/shared/contracts/connections/cm.js';

// rt309: the five operations of the channel modules are in the catalog of the connection `cm`.
test('cm has the five channel operations, the three serve ones hidden from the agents', () => {
  const byId = new Map(cm.operations.map((op) => [op.operationId, op]));
  const received = byId.get('channelMessageReceived');
  const notify = byId.get('notifyPerson');
  assert.equal(received?.direction, 'call');
  assert.equal(notify?.direction, 'call');
  for (const id of ['sendChannelMessage', 'setChannelConversationIdentity', 'disableChannel']) {
    const op = byId.get(id);
    assert.equal(op?.direction, 'serve', id);
    assert.equal(op?.hiddenFromAgents, true, id);
  }
  for (const id of ['channelMessageReceived', 'notifyPerson']) {
    assert.notEqual(byId.get(id)?.hiddenFromAgents, true, id);
  }
});

test('every operation of the cm has a description', () => {
  for (const op of cm.operations) {
    assert.ok(op.description.trim().length > 0, op.operationId);
  }
});

test('operation ids of the cm are not repeated', () => {
  const ids = cm.operations.map((op) => op.operationId);
  assert.equal(new Set(ids).size, ids.length);
});

// rt317: the time of the message travels in the send request, the same name as in the arrival (`CmChannelMessageReceivedInput`).
test('CmSendChannelMessageInput requires writtenAt: the compiler holds it', () => {
  const sent: CmSendChannelMessageInput = { to: { conversationRef: 'c-1' }, text: 'hi', writtenAt: '2026-11-25T12:00:00.123Z' };
  // @ts-expect-error a send request without the time of the message is not valid
  const missing: CmSendChannelMessageInput = { to: { conversationRef: 'c-1' }, text: 'hi' };
  assert.equal(sent.writtenAt, '2026-11-25T12:00:00.123Z');
  assert.equal(missing.text, 'hi');
});
