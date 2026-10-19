/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/identityLoginRead.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { MDM_ORGANIZATION_MODULE_ID, type MdmTagRecord } from '/_102034_/l1/mdm/module.js';
import { createMdmRouter } from '/_102034_/l1/mdm/layer_2_controllers/router.js';
import { lookupLoginEmail } from '/_102034_/l1/mdm/layer_3_usecases/identityUsecases.js';

async function createPerson(ctx: ReturnType<typeof createRequestContext>, name: string) {
  return ctx.mdm.entity.create({
    details: {
      subtype: 'Person',
      name,
      status: 'Active',
    },
  });
}

async function insertTag(
  ctx: ReturnType<typeof createRequestContext>,
  record: Pick<MdmTagRecord, 'entityId' | 'tag'> & Partial<MdmTagRecord>,
): Promise<void> {
  await ctx.data.mdmTag.insert({
    record: {
      id: ctx.idGenerator.newId(),
      entityType: 'MdmEntity',
      namespace: 'login',
      module: MDM_ORGANIZATION_MODULE_ID,
      createdBy: 'fixture',
      createdByType: 'system',
      createdAt: ctx.clock.nowIso(),
      ...record,
    },
  });
}

function watchWrites(ctx: ReturnType<typeof createRequestContext>): { count: number } {
  const writes = { count: 0 };
  const tag = ctx.data.mdmTag;
  const insert = tag.insert.bind(tag);
  const update = tag.update.bind(tag);
  const remove = tag.delete.bind(tag);
  tag.insert = async (input) => {
    writes.count += 1;
    return insert(input);
  };
  tag.update = async (input) => {
    writes.count += 1;
    return update(input);
  };
  tag.delete = async (input) => {
    writes.count += 1;
    return remove(input);
  };
  const cache = ctx.cache;
  const set = cache.set.bind(cache);
  const del = cache.del.bind(cache);
  cache.set = (async (...args: Parameters<typeof cache.set>) => {
    writes.count += 1;
    return set(...args);
  }) as typeof cache.set;
  cache.del = (async (...args: Parameters<typeof cache.del>) => {
    writes.count += 1;
    return del(...args);
  }) as typeof cache.del;
  return writes;
}

test('lookupLoginEmail reads the normalized login and ignores other tags and people', async () => {
  const ctx = createRequestContext();
  ctx.requestMeta = { ...(ctx.requestMeta ?? {}), userId: 'operator@academia.test' };
  const aluno = await createPerson(ctx, 'Aluno Leitura');
  const outro = await createPerson(ctx, 'Outra Pessoa');
  assert.equal(await lookupLoginEmail(ctx, aluno.mdmId), null);

  await ctx.mdm.identity.setLogin(aluno.mdmId, '  Aluno@Academia.Test ');
  await ctx.mdm.identity.setLogin(outro.mdmId, 'outro@academia.test');
  await insertTag(ctx, {
    entityId: aluno.mdmId,
    tag: 'contato@academia.test',
    namespace: 'contact',
  });
  await insertTag(ctx, {
    entityId: aluno.mdmId,
    tag: 'modulo@academia.test',
    namespace: 'login',
    module: 'outro-modulo',
  });

  const writes = watchWrites(ctx);
  assert.equal(await lookupLoginEmail(ctx, aluno.mdmId), 'aluno@academia.test');
  assert.equal(await lookupLoginEmail(ctx, outro.mdmId), 'outro@academia.test');
  assert.equal(writes.count, 0);
  assert.equal('lookupLoginEmail' in ctx.mdm.identity, false);

  await ctx.mdm.identity.setLogin(aluno.mdmId, 'aluno.novo@academia.test');
  assert.equal(await lookupLoginEmail(ctx, aluno.mdmId), 'aluno.novo@academia.test');
});

test('lookupLoginEmail collapses duplicate e-mails and rejects ambiguity, malformed links and a blank id', async () => {
  const ctx = createRequestContext();
  const aluno = await createPerson(ctx, 'Aluno Duplicata');
  await insertTag(ctx, { entityId: aluno.mdmId, tag: 'Dup@Academia.Test' });
  await insertTag(ctx, { entityId: aluno.mdmId, tag: 'dup@academia.test' });
  assert.equal(await lookupLoginEmail(ctx, aluno.mdmId), 'dup@academia.test');

  const ambiguo = await createPerson(ctx, 'Aluno Ambiguo');
  await insertTag(ctx, { entityId: ambiguo.mdmId, tag: 'um@academia.test' });
  await insertTag(ctx, { entityId: ambiguo.mdmId, tag: 'dois@academia.test' });
  await assert.rejects(
    () => lookupLoginEmail(ctx, ambiguo.mdmId),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'MDM_LOGIN_AMBIGUOUS');
      assert.equal(error.statusCode, 409);
      const text = `${error.message} ${JSON.stringify(error.details ?? {})}`;
      assert.equal(text.includes('um@academia.test'), false);
      assert.equal(text.includes('dois@academia.test'), false);
      assert.equal(text.includes('entityId'), false);
      return true;
    },
  );

  const invalido = await createPerson(ctx, 'Aluno Invalido');
  await insertTag(ctx, { entityId: invalido.mdmId, tag: 'sem-arroba' });
  await assert.rejects(
    () => lookupLoginEmail(ctx, invalido.mdmId),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'MDM_LOGIN_INVALID');
      assert.equal(error.statusCode, 409);
      assert.equal(`${error.message} ${JSON.stringify(error.details ?? {})}`.includes('sem-arroba'), false);
      return true;
    },
  );

  await assert.rejects(
    () => lookupLoginEmail(ctx, '   '),
    (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR' && error.statusCode === 400,
  );
});

test('createMdmRouter does not publish a login lookup route', () => {
  const names = [...createMdmRouter().keys()];
  assert.equal(names.some(name => name.includes('lookup') || name.includes('login')), false);
});
