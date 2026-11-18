/// <mls fileReference="_102034_/l1/server/layer_2_controllers/execBff.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionContext, normalizeRequest, trustedActorType, trustedAgentMember,
  trustedVia, withAlphaAuthorities, type AlphaAuthorityDeps } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { BffRequest } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

const moduleId = 'comanda';
const projectId = '102047';
const controllersDir = '_102047_/l1/comanda/layer_2_controllers';

function deps(on: boolean): AlphaAuthorityDeps {
  return {
    isAlphaAllAuthorities: () => on,
    moduleActorRefs: async () => ['caixa', 'garcom'],
  };
}

test('withAlphaAuthorities soma os atores só com a chave ligada e verifiedUserId', async () => {
  const signedIn: BffRequest['meta'] = {
    source: 'http',
    verifiedUserId: 'user-1',
    verifiedAuthorities: [`${moduleId}:caixa`],
  };
  const merged = await withAlphaAuthorities(signedIn, moduleId, projectId, controllersDir, deps(true));
  assert.deepEqual(merged?.verifiedAuthorities, [`${moduleId}:caixa`, `${moduleId}:garcom`]);

  const anonymous = await withAlphaAuthorities(
    { source: 'http', verifiedAuthorities: [] },
    moduleId,
    projectId,
    controllersDir,
    deps(true),
  );
  assert.deepEqual(anonymous?.verifiedAuthorities ?? [], []);

  const off = await withAlphaAuthorities(
    { source: 'http', verifiedUserId: 'user-1', verifiedAuthorities: [`${moduleId}:own`] },
    moduleId,
    projectId,
    controllersDir,
    deps(false),
  );
  assert.deepEqual(off?.verifiedAuthorities, [`${moduleId}:own`]);

  const emptyJwt = await withAlphaAuthorities(
    { source: 'http', verifiedUserId: 'user-1', verifiedAuthorities: [] },
    moduleId,
    projectId,
    controllersDir,
    deps(true),
  );
  assert.ok((emptyJwt?.verifiedAuthorities ?? []).length > 0);
  assert.deepEqual(emptyJwt?.verifiedAuthorities, [`${moduleId}:caixa`, `${moduleId}:garcom`]);
});

test('via nora is trusted only from a message request, never from http, test or a made-up value', () => {
  assert.equal(trustedVia({ source: 'message', via: 'nora' }), 'nora');
  assert.equal(trustedVia({ source: 'http', via: 'nora' }), undefined);
  assert.equal(trustedVia({ source: 'test', via: 'nora' }), undefined);
  assert.equal(trustedVia({ via: 'nora' }), undefined);
  assert.equal(trustedVia({ source: 'message' }), undefined);
  assert.equal(trustedVia({ source: 'message', via: 'other' as never }), undefined);
  assert.equal(trustedVia(undefined), undefined);
});

test('the session context keeps via only as nora, and drops it when the request does not carry it', () => {
  assert.equal(createSessionContext({ via: 'nora' }).via, 'nora');
  assert.equal('via' in createSessionContext({ via: 'other' as never }), false);
  const inherited = createSessionContext({ via: 'nora' });
  assert.equal('via' in createSessionContext({ ...inherited, via: trustedVia({ source: 'http', via: 'nora' }) }), false);
});

test('the agent author is trusted only from a message request, never from http, test or another value', () => {
  assert.equal(trustedActorType({ source: 'message', actorType: 'agent' }), 'agent');
  assert.equal(trustedActorType({ source: 'http', actorType: 'agent' }), undefined);
  assert.equal(trustedActorType({ source: 'test', actorType: 'agent' }), undefined);
  assert.equal(trustedActorType({ actorType: 'agent' }), undefined);
  assert.equal(trustedActorType({ source: 'message' }), undefined);
  assert.equal(trustedActorType({ source: 'message', actorType: 'system' as never }), undefined);
  assert.equal(trustedActorType(undefined), undefined);
});

test('the member of an agent reaches the session only from a message that says it is the agent', () => {
  const base = { source: 'message' as const, actorType: 'agent' as const, agentMdmId: 'member-1', agentName: 'Ana' };
  assert.deepEqual(trustedAgentMember(base), { mdmId: 'member-1', email: '', name: 'Ana' });
  assert.equal(trustedAgentMember({ ...base, source: 'http' }), undefined);
  assert.equal(trustedAgentMember({ ...base, source: 'test' }), undefined);
  assert.equal(trustedAgentMember({ ...base, actorType: undefined }), undefined);
  assert.equal(trustedAgentMember({ ...base, agentMdmId: '' }), undefined);
  assert.equal(trustedAgentMember({ source: 'message', agentMdmId: 'member-1', agentName: 'Ana' }), undefined);
  assert.equal(trustedAgentMember(undefined), undefined);
});

test('normalizeRequest keeps what a server-side caller said about the agent, for execBff to trust or drop by the source', () => {
  const meta = normalizeRequest({ routine: 'm.p.c', params: {}, meta: { source: 'message', actorType: 'agent', agentMdmId: 'member-1', agentName: 'Ana' } }).meta;
  assert.equal(meta?.actorType, 'agent');
  assert.equal(meta?.agentMdmId, 'member-1');
  assert.equal(meta?.agentName, 'Ana');
});
