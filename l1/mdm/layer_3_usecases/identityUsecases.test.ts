/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/identityUsecases.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyVerifiedEmailToSession,
  createRequestContext,
  execBff,
} from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { moduleAuthorities } from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { CacheRuntimeMemory } from '/_102034_/l1/server/layer_1_external/cache/CacheRuntimeMemory.js';
import { CacheRuntimeRedis } from '/_102034_/l1/server/layer_1_external/cache/CacheRuntimeRedis.js';
import { createIdentityCache, identityCacheKey } from '/_102034_/l1/server/layer_1_external/cache/identityCache.js';
import type { ICacheRuntime } from '/_102034_/l1/server/layer_1_external/cache/CacheRuntimeMemory.js';
import type { ITableRuntime } from '/_102034_/l1/server/layer_1_external/data/runtime.js';
import type { MdmTagRecord } from '/_102034_/l1/mdm/module.js';

async function createPerson(ctx: ReturnType<typeof createRequestContext>, name: string) {
  return ctx.mdm.entity.create({
    details: {
      subtype: 'Person',
      name,
      status: 'Active',
    },
  });
}

function withTagLookupCounter(ctx: ReturnType<typeof createRequestContext>): { count: number } {
  const lookups = { count: 0 };
  const original = ctx.data.mdmTag.findMany.bind(ctx.data.mdmTag);
  ctx.data.mdmTag.findMany = (async (input?: Parameters<ITableRuntime<MdmTagRecord>['findMany']>[0]) => {
    lookups.count += 1;
    return original(input);
  }) as ITableRuntime<MdmTagRecord>['findMany'];
  return lookups;
}

test('setLogin refuses the same e-mail on a second person and replaces the row of the same person', async () => {
  const ctx = createRequestContext();
  const aluno = await createPerson(ctx, 'Aluno Um');
  const outro = await createPerson(ctx, 'Aluno Dois');

  await ctx.mdm.identity.setLogin(aluno.mdmId, 'aluno@academia.test');
  assert.equal(await ctx.mdm.identity.findByLogin('aluno@academia.test'), aluno.mdmId);

  await assert.rejects(
    () => ctx.mdm.identity.setLogin(outro.mdmId, 'aluno@academia.test'),
    (error: unknown) => error instanceof AppError && error.code === 'MDM_LOGIN_TAKEN',
  );

  await ctx.mdm.identity.setLogin(aluno.mdmId, 'aluno.novo@academia.test');
  assert.equal(await ctx.mdm.identity.findByLogin('aluno@academia.test'), null);
  assert.equal(await ctx.mdm.identity.findByLogin('aluno.novo@academia.test'), aluno.mdmId);

  const rows = await ctx.data.mdmTag.findMany({
    where: { entityType: 'MdmEntity', entityId: aluno.mdmId, namespace: 'login' },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.tag, 'aluno.novo@academia.test');
});

test('invite writes the login row, returns a token, and findByLogin matches', async () => {
  const ctx = createRequestContext(undefined, {
    collabAuthInvite: {
      async createInvite(input) {
        assert.equal(input.email, 'convidado@academia.test');
        assert.equal(input.moduleId, 'mensalidadesAcademia');
        assert.equal(input.actorId, 'aluno');
        return {
          token: 'a'.repeat(64),
          expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          teamIds: ['team-mensalidadesAcademia-aluno'],
        };
      },
    },
  });
  const aluno = await createPerson(ctx, 'Aluno Convite');
  const result = await ctx.mdm.identity.invite({
    mdmId: aluno.mdmId,
    email: 'convidado@academia.test',
    moduleId: 'mensalidadesAcademia',
    actorId: 'aluno',
  });
  assert.equal(result.token.length, 64);
  assert.deepEqual(result.teamIds, ['team-mensalidadesAcademia-aluno']);
  assert.equal(await ctx.mdm.identity.findByLogin('convidado@academia.test'), aluno.mdmId);
});

test('execBff with a verified e-mail fills session.person and actorId from the MDM', async () => {
  const ctx = createRequestContext();
  const aluno = await createPerson(ctx, 'Aluno Sessao');
  await ctx.mdm.identity.setLogin(aluno.mdmId, 'sessao@academia.test');

  const session = await applyVerifiedEmailToSession(
    ctx,
    ctx.sessionContext,
    'sessao@academia.test',
  );
  assert.equal(session.actorId, aluno.mdmId);
  assert.deepEqual(session.person, {
    mdmId: aluno.mdmId,
    email: 'sessao@academia.test',
    name: 'Aluno Sessao',
  });

  const result = await execBff({
    routine: 'mdm.entity.get',
    params: { mdmId: aluno.mdmId },
    meta: {
      source: 'http',
      verifiedUserId: 'auth-sub-aluno',
      verifiedEmail: 'sessao@academia.test',
    },
  }, ctx);
  assert.equal(result.statusCode, 200);
  const cached = await ctx.cache.get<{ mdmId: string; name: string }>(
    identityCacheKey('sessao@academia.test'),
  );
  assert.equal(cached?.mdmId, aluno.mdmId);
  assert.equal(cached?.name, 'Aluno Sessao');
});

test('JWT active_org roles become actorScope and person stays the mdmId', async () => {
  const ctx = createRequestContext();
  const aluno = await createPerson(ctx, 'Aluno Papel');
  await ctx.mdm.identity.setLogin(aluno.mdmId, 'papel@academia.test');

  const claims = {
    sub: 'auth-sub-papel',
    email: 'papel@academia.test',
    active_org: {
      teams: [{ id: 't1', name: 'mensalidadesAcademia:aluno', roles: ['mensalidadesAcademia:aluno'] }],
    },
  };
  const actorScope = moduleAuthorities(claims, 'mensalidadesAcademia');
  assert.deepEqual(actorScope, ['mensalidadesAcademia:aluno']);

  const session = await applyVerifiedEmailToSession(
    ctx,
    { ...ctx.sessionContext, actorScope },
    claims.email,
  );
  assert.deepEqual(session.actorScope, ['mensalidadesAcademia:aluno']);
  assert.equal(session.person?.mdmId, aluno.mdmId);

  const result = await execBff({
    routine: 'mdm.entity.get',
    params: { mdmId: aluno.mdmId },
    meta: {
      source: 'http',
      verifiedUserId: claims.sub,
      verifiedEmail: claims.email,
      verifiedAuthorities: actorScope,
    },
  }, ctx);
  assert.equal(result.statusCode, 200);
});

async function runCacheContract(label: string, cache: ICacheRuntime): Promise<void> {
  const ctx = createRequestContext(undefined, { cache });
  const lookups = withTagLookupCounter(ctx);
  const aluno = await createPerson(ctx, `Aluno ${label}`);
  const email = `cache.${label}@academia.test`;
  await ctx.mdm.identity.setLogin(aluno.mdmId, email);
  await cache.del(identityCacheKey(email));
  lookups.count = 0;

  assert.equal(await ctx.mdm.identity.findByLogin(email), aluno.mdmId);
  const afterFirst = lookups.count;
  assert.ok(afterFirst >= 1, `${label}: first findByLogin consults mdm_tag`);
  assert.equal(await ctx.mdm.identity.findByLogin(email), aluno.mdmId);
  assert.equal(lookups.count, afterFirst, `${label}: second findByLogin must not hit mdm_tag`);
}

test('identity cache: memory always; Redis only when REDIS_URL is set', async () => {
  await runCacheContract('memory', new CacheRuntimeMemory(300));
  assert.equal(createIdentityCache(undefined) instanceof CacheRuntimeMemory, true);

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;

  const redis = new CacheRuntimeRedis(redisUrl, 300);
  try {
    await runCacheContract('redis', redis);
    assert.equal(createIdentityCache(redisUrl) instanceof CacheRuntimeRedis, true);
  } finally {
    await redis.close();
  }
});

test('without a login row, person is absent and actorId stays as today', async () => {
  process.env.ACTOR_ID = 'env-actor';
  try {
    const ctx = createRequestContext();
    const session = await applyVerifiedEmailToSession(
      ctx,
      ctx.sessionContext,
      'sem-login@academia.test',
    );
    assert.equal(session.person, undefined);
    assert.equal(session.actorId, 'env-actor');
  } finally {
    delete process.env.ACTOR_ID;
  }
});
