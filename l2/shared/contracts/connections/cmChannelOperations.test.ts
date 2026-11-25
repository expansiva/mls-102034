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

// rt317: the time and the id of the message travel in the send request (same names as in the arrival).
test('CmSendChannelMessageInput requires writtenAt and messageRef: the compiler holds it', () => {
  const sent: CmSendChannelMessageInput = { to: { conversationRef: 'c-1' }, text: 'hi', writtenAt: '2026-11-25T12:00:00.123Z', messageRef: 'm-1' };
  // @ts-expect-error a send request without the time of the message is not valid
  const noTime: CmSendChannelMessageInput = { to: { conversationRef: 'c-1' }, text: 'hi', messageRef: 'm-1' };
  // @ts-expect-error a send request without the id of the message is not valid
  const noRef: CmSendChannelMessageInput = { to: { conversationRef: 'c-1' }, text: 'hi', writtenAt: '2026-11-25T12:00:00.123Z' };
  assert.equal(sent.messageRef, 'm-1');
  assert.equal(noTime.text, 'hi');
  assert.equal(noRef.text, 'hi');
});
