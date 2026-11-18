/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/agentMember.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { ensureAgentMember, findAgentMember } from '/_102034_/l1/mdm/layer_3_usecases/agentMember.js';
import { lookupLoginEmail } from '/_102034_/l1/mdm/layer_3_usecases/identityUsecases.js';
import { putMdmKv } from '/_102034_/l1/mdm/layer_3_usecases/kvUsecases.js';

const fresh = () => createRequestContext(createMemoryDataRuntime());

test('creates the member of an agent, and repeating gives the same member', async () => {
  const ctx = fresh();
  assert.equal(await findAgentMember(ctx, 'agent-t0'), null);
  const first = await ensureAgentMember(ctx, { agentId: 'agent-t0', name: 'Ana', active: true });
  assert.deepEqual({ name: first.name, active: first.active }, { name: 'Ana', active: true });
  const again = await ensureAgentMember(ctx, { agentId: 'agent-t0', name: 'Ana', active: true });
  assert.equal(again.mdmId, first.mdmId);
  assert.deepEqual(await findAgentMember(ctx, 'agent-t0'), first);
  const entity = await ctx.mdm.entity.get({ mdmId: first.mdmId });
  assert.equal(entity.index.subtype, 'Person');
  const links = await ctx.data.mdmTag.findMany({ where: { entityType: 'MdmEntity', entityId: first.mdmId } });
  assert.deepEqual(links.map((row) => [row.namespace, row.tag]), [['agent', 'agent-t0']]);
  assert.equal(await lookupLoginEmail(ctx, first.mdmId), null);
});

test('another agent is another member', async () => {
  const ctx = fresh();
  const one = await ensureAgentMember(ctx, { agentId: 'a', name: 'A', active: true });
  const two = await ensureAgentMember(ctx, { agentId: 'b', name: 'B', active: true });
  assert.notEqual(one.mdmId, two.mdmId);
});

test('renames, inactivates and reactivates the same member; nothing is deleted', async () => {
  const ctx = fresh();
  const created = await ensureAgentMember(ctx, { agentId: 'agent-t2', name: 'Ana', active: true });
  const renamed = await ensureAgentMember(ctx, { agentId: 'agent-t2', name: 'Ana Maria', active: true });
  assert.deepEqual(renamed, { mdmId: created.mdmId, name: 'Ana Maria', active: true });
  const off = await ensureAgentMember(ctx, { agentId: 'agent-t2', name: 'Ana Maria', active: false });
  assert.deepEqual(off, { mdmId: created.mdmId, name: 'Ana Maria', active: false });
  assert.equal((await findAgentMember(ctx, 'agent-t2'))?.active, false);
  const on = await ensureAgentMember(ctx, { agentId: 'agent-t2', name: 'Ana Maria', active: true });
  assert.deepEqual(on, { mdmId: created.mdmId, name: 'Ana Maria', active: true });
  assert.equal((await ctx.data.mdmTag.findMany({ where: { namespace: 'agent', tag: 'agent-t2' } })).length, 1);
  assert.equal((await ctx.data.mdmEntityIndex.findMany({ where: { mdmId: created.mdmId } })).length, 1);
});

test('created inactive stays one member when activated later', async () => {
  const ctx = fresh();
  const off = await ensureAgentMember(ctx, { agentId: 'agent-t3', name: 'Ana', active: false });
  assert.equal(off.active, false);
  const on = await ensureAgentMember(ctx, { agentId: 'agent-t3', name: 'Ana', active: true });
  assert.deepEqual(on, { mdmId: off.mdmId, name: 'Ana', active: true });
});

test('many calls at once for one agent create one member', async () => {
  const ctx = fresh();
  const before = (await ctx.data.mdmEntityIndex.findMany({ where: { subtype: 'Person' } })).length;
  const results = await Promise.all(Array.from({ length: 12 }, () => ensureAgentMember(ctx, { agentId: 'agent-race', name: 'Ana', active: true })));
  assert.equal(new Set(results.map((member) => member.mdmId)).size, 1);
  assert.equal((await ctx.data.mdmEntityIndex.findMany({ where: { subtype: 'Person' } })).length, before + 1);
  assert.equal((await ctx.data.mdmTag.findMany({ where: { namespace: 'agent', tag: 'agent-race' } })).length, 1);
});

test('a creation that stopped after the entity is finished by the next call, with the same member', async () => {
  const ctx = fresh();
  const entity = await ctx.mdm.entity.create({ details: { subtype: 'Person', name: 'Ana', status: 'Active' } });
  await putMdmKv(ctx, { key: 'agentMember:agent-t5', value: { state: 'created', mdmId: entity.mdmId, at: new Date().toISOString() } });
  const member = await ensureAgentMember(ctx, { agentId: 'agent-t5', name: 'Ana', active: true });
  assert.equal(member.mdmId, entity.mdmId);
  assert.equal((await findAgentMember(ctx, 'agent-t5'))?.mdmId, entity.mdmId);
});

test('a creation that stopped before the entity is taken over once it is old', async () => {
  const ctx = fresh();
  await putMdmKv(ctx, { key: 'agentMember:agent-t6', value: { state: 'creating', at: new Date(Date.now() - 120_000).toISOString() } });
  const member = await ensureAgentMember(ctx, { agentId: 'agent-t6', name: 'Ana', active: true });
  assert.equal((await findAgentMember(ctx, 'agent-t6'))?.mdmId, member.mdmId);
});

test('an empty agentId or name is invalid', async () => {
  const ctx = fresh();
  for (const input of [{ agentId: '', name: 'Ana', active: true }, { agentId: 'a', name: '  ', active: true }]) {
    await assert.rejects(() => ensureAgentMember(ctx, input), (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR');
  }
  await assert.rejects(() => findAgentMember(ctx, ' '), (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR');
});
