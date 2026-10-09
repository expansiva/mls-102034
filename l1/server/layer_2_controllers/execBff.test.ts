/// <mls fileReference="_102034_/l1/server/layer_2_controllers/execBff.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { withAlphaAuthorities, type AlphaAuthorityDeps } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
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
