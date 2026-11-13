/// <mls fileReference="_102034_/l1/server/layer_2_controllers/execBff.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionContext, trustedVia, withAlphaAuthorities, type AlphaAuthorityDeps } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
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
