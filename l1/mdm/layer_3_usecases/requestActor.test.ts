/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/requestActor.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { requestActorType } from '/_102034_/l1/mdm/layer_3_usecases/core/requestActor.js';
import { addTag } from '/_102034_/l1/mdm/layer_3_usecases/tagUsecases.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

function contextWith(requestMeta: RequestContext['requestMeta']): RequestContext {
  const ctx = createRequestContext(createMemoryDataRuntime());
  ctx.requestMeta = requestMeta;
  return ctx;
}

test('the author type: the agent when the server-side caller said so, a user when there is an author id, else the system', () => {
  assert.equal(requestActorType(contextWith({ userId: 'agent-1', actorType: 'agent', source: 'message' })), 'agent');
  assert.equal(requestActorType(contextWith({ userId: 'ana@example.test', source: 'message' })), 'user');
  assert.equal(requestActorType(contextWith({ source: 'message' })), 'system');
  assert.equal(requestActorType(contextWith(undefined)), 'system');
});

test('what an agent writes is recorded with its id and the agent type, in the columns that already exist', async () => {
  const ctx = contextWith({ userId: 'agent-1', actorType: 'agent', source: 'message' });
  const written = await addTag(ctx, { entityType: 'MdmCompany', entityId: 'e-1', tag: 'seen', module: 'modA' });
  assert.equal(written.tag.createdBy, 'agent-1');
  assert.equal(written.tag.createdByType, 'agent');

  const person = contextWith({ userId: 'ana@example.test', source: 'message' });
  const byPerson = await addTag(person, { entityType: 'MdmCompany', entityId: 'e-2', tag: 'seen', module: 'modA' });
  assert.equal(byPerson.tag.createdBy, 'ana@example.test');
  assert.equal(byPerson.tag.createdByType, 'user');
});
