/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/testsContext.test.ts" enhancement="_blank" />
// rt126 s1 — the session a declared actor's cases run with: the seeded Person of THAT module, found in the
// run's own sandbox runtime, with the one qualified authority `<moduleId>:<actorRef>` and the public
// PlatformSessionPerson shape. Absent/ambiguous/inconsistent fixtures block the cases instead of running
// them anonymous. The handler below is a stub with the generated controllers' gate shape (authorize by
// meta.verifiedAuthorities, enforceActors by sessionContext.actorScope, then a business rule): it proves
// the session reaches the rule, not that a real module's controller does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { actorSessionKey, resolveActorSession } from '/_102034_/l1/monitor/layer_3_usecases/testsUsecases.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import type { BffRequest, RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { IDataRuntime } from '/_102034_/l1/server/layer_1_external/data/runtime.js';
import type { MdmEntityIndexRecord } from '/_102034_/l1/mdm/module.js';

const NOW = '2026-10-22T00:00:00.000Z';

test.beforeEach(() => {
  delete process.env.ACTOR_ID;
  delete process.env.ACTOR_SCOPE;
  delete process.env.ACTIVE_COMPANY_ID;
});

function indexRow(mdmId: string, moduleName: string, actorRef: string, subtype: MdmEntityIndexRecord['subtype'] = 'Person'): MdmEntityIndexRecord {
  return {
    mdmId,
    subtype,
    name: `${moduleName} ${actorRef}`,
    status: 'Active',
    countryCode: 'BR',
    tags: [`${moduleName}.Person`, moduleName, 'actor', actorRef],
    searchVector: '',
    dynamoPk: mdmId,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function seedPerson(data: IDataRuntime, row: MdmEntityIndexRecord, documentSubtype: 'Person' | 'Company' = 'Person'): Promise<void> {
  await data.mdmEntityIndex.insert({ record: row });
  const common = {
    name: row.name,
    status: 'Active' as const,
    countryCode: 'BR',
    tags: row.tags,
    aliases: [],
    contacts: [],
    relationshipRefs: {},
    addresses: [],
  };
  await data.mdmDocument.put({
    record: {
      mdmId: row.mdmId,
      version: 1,
      details: documentSubtype === 'Person'
        ? { ...common, subtype: 'Person' }
        : { ...common, subtype: 'Company', companyKind: 'LegalEntity' },
    },
  });
}

/** Stub with the generated controller's gate order; returns the status the runner would observe. */
function stubHandler(request: BffRequest, ctx: RequestContext, allowed: string): { status: number; code: string } {
  if (request.meta?.source === 'http' && !(request.meta.verifiedAuthorities ?? []).includes(allowed)) return { status: 403, code: 'FORBIDDEN' };
  const scope = ctx.sessionContext.actorScope ?? [];
  if (scope.length > 0 && !scope.includes(allowed)) return { status: 403, code: 'FORBIDDEN_ACTOR' };
  if (!ctx.sessionContext.actorId) return { status: 401, code: 'UNAUTHENTICATED' };
  return { status: 422, code: 'TASK_ALREADY_CLOSED' };
}

test('same actorRef in two modules: distinct Person, distinct qualified scope, distinct cache key', async () => {
  const data = createMemoryDataRuntime({ sandbox: true });
  await seedPerson(data, indexRow('rt126-a-worker', 'rt126ModA', 'worker'));
  await seedPerson(data, indexRow('rt126-b-worker', 'rt126ModB', 'worker'));

  const a = await resolveActorSession(data, { moduleId: 'rt126IdA', moduleName: 'rt126ModA', actorRef: 'worker' });
  const b = await resolveActorSession(data, { moduleId: 'rt126IdB', moduleName: 'rt126ModB', actorRef: 'worker' });
  assert.ok(a.ok && b.ok);
  assert.equal(a.sessionContext.actorId, 'rt126-a-worker');
  assert.equal(b.sessionContext.actorId, 'rt126-b-worker');
  // Authority uses the platform moduleId (as withAlphaAuthorities does), not the seed's module tag.
  assert.deepEqual(a.sessionContext.actorScope, ['rt126IdA:worker']);
  assert.deepEqual(b.sessionContext.actorScope, ['rt126IdB:worker']);
  assert.notEqual(actorSessionKey('rt126IdA', 'worker'), actorSessionKey('rt126IdB', 'worker'));
});

test('person keeps PlatformSessionPerson {mdmId,email,name}; email empty without a login row, the login when declared', async () => {
  const data = createMemoryDataRuntime({ sandbox: true });
  await seedPerson(data, indexRow('rt126-a-owner', 'rt126ModA', 'owner'));
  await seedPerson(data, indexRow('rt126-a-clerk', 'rt126ModA', 'clerk'));
  await data.mdmTag.insert({
    record: {
      id: 'rt126-login', entityType: 'MdmEntity', entityId: 'rt126-a-clerk', tag: 'clerk@example.test',
      namespace: 'login', module: 'organization', createdBy: 'test', createdByType: 'system', createdAt: NOW,
    },
  });

  const owner = await resolveActorSession(data, { moduleId: 'rt126IdA', moduleName: 'rt126ModA', actorRef: 'owner' });
  assert.ok(owner.ok);
  assert.deepEqual(owner.sessionContext.person, { mdmId: 'rt126-a-owner', email: '', name: 'rt126ModA owner' });
  const clerk = await resolveActorSession(data, { moduleId: 'rt126IdA', moduleName: 'rt126ModA', actorRef: 'clerk' });
  assert.ok(clerk.ok);
  assert.equal(clerk.sessionContext.person.email, 'clerk@example.test');
});

test('absent, ambiguous and inconsistent fixtures are blocked with module and actor in the reason', async () => {
  const data = createMemoryDataRuntime({ sandbox: true });
  // Same actorRef seeded only in another module: must NOT leak across modules.
  await seedPerson(data, indexRow('rt126-b-only', 'rt126ModB', 'auditor'));
  await seedPerson(data, indexRow('rt126-a-dup1', 'rt126ModA', 'twin'));
  await seedPerson(data, indexRow('rt126-a-dup2', 'rt126ModA', 'twin'));
  await seedPerson(data, indexRow('rt126-a-company', 'rt126ModA', 'boss', 'Company'), 'Company');
  await data.mdmEntityIndex.insert({ record: indexRow('rt126-a-nodoc', 'rt126ModA', 'ghost') });
  await seedPerson(data, indexRow('rt126-a-mismatch', 'rt126ModA', 'shifty'), 'Company');

  const cases: Array<[string, RegExp]> = [
    ['auditor', /no seeded identity/],
    ['twin', /matches 2 seeded identities/],
    ['boss', /indexed as 'Company'/],
    ['ghost', /no document/],
    ['shifty', /does not match its index row/],
  ];
  for (const [actorRef, expected] of cases) {
    const result = await resolveActorSession(data, { moduleId: 'rt126IdA', moduleName: 'rt126ModA', actorRef });
    assert.equal(result.ok, false, actorRef);
    if (result.ok) continue;
    assert.match(result.reason, expected);
    assert.match(result.reason, new RegExp(`actor '${actorRef}' declared by module 'rt126ModA'`));
  }
});

test('ACTOR_SCOPE in env does not widen the declared actor: the scope is exactly <moduleId>:<actorRef>', async () => {
  process.env.ACTOR_SCOPE = 'rt126IdA:worker,rt126IdA:owner,rt126IdA:admin';
  const data = createMemoryDataRuntime({ sandbox: true });
  await seedPerson(data, indexRow('rt126-a-worker', 'rt126ModA', 'worker'));
  const resolved = await resolveActorSession(data, { moduleId: 'rt126IdA', moduleName: 'rt126ModA', actorRef: 'worker' });
  assert.ok(resolved.ok);
  // The env value IS read where no override exists — so the next assertion is the override winning.
  assert.deepEqual(createRequestContext(data, { sandbox: true }).sessionContext.actorScope, ['rt126IdA:worker', 'rt126IdA:owner', 'rt126IdA:admin']);
  const ctx = createRequestContext(data, { sandbox: true, sessionContext: resolved.sessionContext });
  assert.deepEqual(ctx.sessionContext.actorScope, ['rt126IdA:worker']);
  assert.equal(ctx.sessionContext.actorId, 'rt126-a-worker');
  assert.deepEqual(ctx.sessionContext.person, { mdmId: 'rt126-a-worker', email: '', name: 'rt126ModA worker' });
  assert.equal(ctx.sandbox, true);
});

test('valid Person reaches the business rule (not a 401); a declared negative caller stays denied', async () => {
  const data = createMemoryDataRuntime({ sandbox: true });
  await seedPerson(data, indexRow('rt126-a-worker', 'rt126ModA', 'worker'));
  const resolved = await resolveActorSession(data, { moduleId: 'rt126IdA', moduleName: 'rt126ModA', actorRef: 'worker' });
  assert.ok(resolved.ok);
  const ctx = createRequestContext(data, { sandbox: true, sessionContext: resolved.sessionContext });
  const allowed = 'rt126IdA:worker';

  const asRunner: BffRequest = { routine: 'rt126.task.close', params: {}, meta: { source: 'test' } };
  assert.deepEqual(stubHandler(asRunner, ctx, allowed), { status: 422, code: 'TASK_ALREADY_CLOSED' });

  const negativeCaller: BffRequest = { routine: 'rt126.task.close', params: {}, meta: { source: 'http', verifiedAuthorities: [] } };
  assert.deepEqual(stubHandler(negativeCaller, ctx, allowed), { status: 403, code: 'FORBIDDEN' });

  const otherActor: BffRequest = { routine: 'rt126.task.close', params: {}, meta: { source: 'test' } };
  assert.equal(stubHandler(otherActor, ctx, 'rt126IdA:owner').code, 'FORBIDDEN_ACTOR');

  // Without the seeded identity the same rule would be masked by an earlier 401.
  const anonymous = createRequestContext(data, { sandbox: true });
  assert.equal(stubHandler(asRunner, anonymous, allowed).status, 401);
});
