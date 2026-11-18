/// <mls fileReference="_102034_/l1/workflow/agentMemberFlow.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { createRequestContext, createSessionContext, normalizeRequest, trustedAgentMember } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { BffRequest } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { findAgentMember } from '/_102034_/l1/mdm/layer_3_usecases/agentMember.js';
import { mdmPlatformServes } from '/_102034_/l1/mdm/layer_3_usecases/platformServes.js';
import { getMdmKv, putMdmKv, reserveMdmKv } from '/_102034_/l1/mdm/layer_3_usecases/kvUsecases.js';
import { createAssistantCatalogSource, ASSISTANT_CATALOG_SCHEMA } from '/_102034_/l1/workflow/assistantCatalog.js';
import { execAssistantAction } from '/_102034_/l1/workflow/assistantExec.js';
import { createConnectionServer } from '/_102034_/l1/workflow/connectionServe.js';
import cmCatalog from '/_102034_/l4/ontology/connections/cm.defs.js';

/**
 * The whole way, no LLM, with the mdm in memory: the cm makes the agent a member through the connection (the function `/exec/connection`
 * runs), the agent runs an action through the exec (the function `/exec/assistant` runs), and the record carries the member.
 */
test('the cm makes the agent a member, the agent runs an action in its own name, and the record carries the member', async () => {
  const ctx = createRequestContext(createMemoryDataRuntime());
  const item = { route: 'modA.page.modA.create', routes: ['modA.page.modA.create'], kind: 'cmd', actionId: 'modA.create', title: 'create', actors: ['boss'], assistant: 'included', risk: 'write', inputs: [] };
  const catalogs = createAssistantCatalogSource({
    projectId: '102047',
    releaseId: () => 'r1',
    importCatalog: async (moduleId) => (moduleId === 'modA'
      ? ({ schemaVersion: ASSISTANT_CATALOG_SCHEMA, module: 'modA', lookups: [], entities: [], issues: [], commands: [item], queries: [] } as never)
      : undefined),
  });
  // What a generated route does with the session the entry builds: the author of the record is the person of the session.
  const records: Array<{ title: unknown; createdBy: unknown; authorName: unknown; actorType: unknown }> = [];
  const execMessage = async (request: BffRequest) => {
    const meta = normalizeRequest({ ...request, meta: { ...request.meta, source: 'message' } }).meta;
    const person = trustedAgentMember(meta);
    const session = createSessionContext({ ...ctx.sessionContext, ...(person ? { person } : {}) });
    records.push({ title: (request.params as { title: unknown }).title, createdBy: session.person?.mdmId, authorName: session.person?.name, actorType: meta?.actorType });
    return { response: { ok: true, data: { id: 'rec-1' } } as never, statusCode: 200 };
  };
  const serve = createConnectionServer({
    catalogOf: async (id) => (id === 'cm' ? cmCatalog : undefined),
    index: async () => ({ byOperation: new Map(), issues: [] }),
    execMessage: async () => { throw new Error('a route of a module must not run for a platform operation'); },
    newContext: () => ctx,
    platform: mdmPlatformServes,
    log: () => undefined,
  });
  const ensure = (name: string, active: boolean) => serve({ connectionId: 'cm', operationId: 'ensureAgentMember', input: { agentId: 'agent-flow', name, active }, context: { organizationId: 'org-1' } });
  const run = (commandId: string) => execAssistantAction(ctx, {
    projectId: '102047',
    modules: [{ moduleId: 'modA' }],
    identities: { toMdmId: async () => { throw new Error('no person here'); } },
    withAlpha: async (meta) => meta,
    agent: { allowedActions: async () => ({ ok: true, allowed: ['modA.create'] }) },
    catalogs,
    loginEmailOf: async () => null,
    agentMemberOf: (callerCtx, agentId) => findAgentMember(callerCtx, agentId),
    execMessage,
    kv: { reserve: reserveMdmKv, put: putMdmKv },
  }, { onBehalfOf: { agentId: 'agent-flow', requestedBy: 'cm-9', via: 'agent' }, actionId: 'modA.create', commandId, input: { title: 'from the agent' } });

  // 1. Not a member yet: nothing runs and the command id stays free.
  const before = await run('flow-1');
  assert.equal(before.outcome, 'no_person');
  assert.equal(before.error?.code, 'ASSISTANT_AGENT_NO_MEMBER');
  assert.deepEqual(records, []);
  assert.equal(await getMdmKv(ctx, { key: 'assistant:flow-1' }), null);

  // 2. The cm makes it a member; repeating answers the same one.
  const made = await ensure('Ana Robo', true);
  assert.equal(made.ok, true);
  const mdmId = (made as { output: { mdmId: string } }).output.mdmId;
  assert.ok(mdmId);
  assert.deepEqual(await ensure('Ana Robo', true), { ok: true, output: { mdmId } });

  // 3. The repeat with another command id runs, and the record carries the member.
  assert.equal((await run('flow-2')).outcome, 'done');
  assert.deepEqual(records, [{ title: 'from the agent', createdBy: mdmId, authorName: 'Ana Robo', actorType: 'agent' }]);

  // 4. Inactive: forbidden, nothing runs.
  await ensure('Ana Robo', false);
  const off = await run('flow-3');
  assert.equal(off.outcome, 'forbidden');
  assert.equal(off.error?.code, 'ASSISTANT_AGENT_INACTIVE');
  assert.equal(records.length, 1);
});
