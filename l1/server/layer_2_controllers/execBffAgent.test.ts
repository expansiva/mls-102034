/// <mls fileReference="_102034_/l1/server/layer_2_controllers/execBffAgent.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { createRequestContext, execBff } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { execMessage } from '/_102034_/l1/server/layer_1_external/transport/message/execMessage.js';

/** Through the real entry: what a server-side caller says about the agent reaches the audit of the write, and the browser's word is dropped. */
async function createPersonAs(meta: Record<string, unknown>, through: 'message' | 'http'): Promise<string[]> {
  process.env.APP_ENV = 'development';
  process.env.RUNTIME_MODE = 'memory';
  const ctx = createRequestContext(createMemoryDataRuntime());
  const request = { routine: 'mdm.entity.create', params: { detail: { subtype: 'Person', name: `Author ${through}`, status: 'Active' } }, meta: meta as never };
  const answer = through === 'message' ? await execMessage(request, ctx) : await execBff({ ...request, meta: { ...request.meta, source: 'http' } }, ctx);
  assert.equal(answer.response.ok, true);
  const rows = (await ctx.data.mdmMonitoringWrite.findMany()) as unknown as Array<{ actorType?: string }>;
  return rows.map((row) => row.actorType ?? '');
}

test('a message request that says it is the agent writes with the agent type', async () => {
  assert.deepEqual(new Set(await createPersonAs({ requestId: 'r-agent', userId: 'agent-x', actorType: 'agent', agentMdmId: 'member-1', agentName: 'Ana' }, 'message')), new Set(['agent']));
});

test('the same words over http are dropped: the write is a user write', async () => {
  assert.deepEqual(new Set(await createPersonAs({ requestId: 'r-http', userId: 'agent-x', actorType: 'agent', agentMdmId: 'member-1', agentName: 'Ana' }, 'http')), new Set(['user']));
});
