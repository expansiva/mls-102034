/// <mls fileReference="_102034_/l1/server/layer_2_application/repositoryRegistry.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { runAsCallerModule } from '/_102034_/l1/server/layer_1_external/connections/callerModule.js';
import { clearRepositories, hasRepository, registerRepository, resolveRepository } from '/_102034_/l1/server/layer_2_application/repositoryRegistry.js';

const CTX = {} as RequestContext;
const named = (name: string) => () => ({ name });

describe('rt324: repository port by module', () => {
  afterEach(() => clearRepositories());

  it('two modules bind the same name: each resolves its own, in any order of registration', () => {
    for (const order of [['agents', 'telegram'], ['telegram', 'agents']]) {
      clearRepositories();
      for (const moduleId of order) registerRepository('CmGateway', named(moduleId), { module: moduleId });
      assert.deepEqual(runAsCallerModule('agents', () => resolveRepository(CTX, 'CmGateway')), { name: 'agents' });
      assert.deepEqual(runAsCallerModule('telegram', () => resolveRepository(CTX, 'CmGateway')), { name: 'telegram' });
    }
  });

  it('outside a module, a name that only modules bind is an explicit error that names them; one that is not bound is the old error', () => {
    registerRepository('CmGateway', named('agents'), { module: 'agents' });
    registerRepository('CmGateway', named('telegram'), { module: 'telegram' });
    assert.throws(() => resolveRepository(CTX, 'CmGateway'), /port "CmGateway" is registered by modules agents, telegram; running module: none/u);
    assert.throws(() => runAsCallerModule('conteudo', () => resolveRepository(CTX, 'CmGateway')), /running module: conteudo/u);
    assert.throws(() => resolveRepository(CTX, 'Nothing'), /no repository registered for port "Nothing"/u);
    assert.equal(hasRepository('CmGateway'), false);
    assert.equal(runAsCallerModule('agents', () => hasRepository('CmGateway')), true);
  });

  it('the old global binding resolves as before, inside and outside a module (the last one wins)', () => {
    registerRepository('Repo', named('first'));
    registerRepository('Repo', named('last'));
    assert.deepEqual(resolveRepository(CTX, 'Repo'), { name: 'last' });
    assert.deepEqual(runAsCallerModule('any', () => resolveRepository(CTX, 'Repo')), { name: 'last' });
    assert.equal(hasRepository('Repo'), true);
  });

  it('module and global with the same name: the module wins inside it and the global holds elsewhere', () => {
    registerRepository('Repo', named('global'));
    registerRepository('Repo', named('own'), { module: 'telegram' });
    assert.deepEqual(runAsCallerModule('telegram', () => resolveRepository(CTX, 'Repo')), { name: 'own' });
    assert.deepEqual(runAsCallerModule('agents', () => resolveRepository(CTX, 'Repo')), { name: 'global' });
    assert.deepEqual(resolveRepository(CTX, 'Repo'), { name: 'global' });
  });
});
