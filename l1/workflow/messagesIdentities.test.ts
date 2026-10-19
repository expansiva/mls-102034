/// <mls fileReference="_102034_/l1/workflow/messagesIdentities.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { ServerMessagesClient } from '/_102034_/l1/server/layer_1_external/collabMessages/client.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { MDM_ORGANIZATION_MODULE_ID, type MdmTagRecord } from '/_102034_/l1/mdm/module.js';
import { createMessagesWorkflowIdentities } from '/_102034_/l1/workflow/messagesIdentities.js';

type IdentityClient = Pick<ServerMessagesClient, 'linkModulePerson' | 'resolveModulePeople'>;
type Person = { mdmId?: string; cmUserId?: string; state: 'linked' | 'unlinked' | 'removed' };

function ctxOf(projectId?: string): RequestContext {
  const ctx = createRequestContext();
  ctx.requestMeta = { ...(ctx.requestMeta ?? {}), userId: 'decoy@telemetry.test' };
  ctx.sessionContext.activeCompanyId = 'company-decoy';
  if (projectId !== undefined) ctx.sessionContext.project.projectId = projectId;
  return ctx;
}

async function person(ctx: RequestContext, email: string): Promise<string> {
  const created = await ctx.mdm.entity.create({
    details: { subtype: 'Person', name: 'Aluno Identidade', status: 'Active' },
  });
  await ctx.mdm.identity.setLogin(created.mdmId, email);
  return created.mdmId;
}

async function insertTag(ctx: RequestContext, record: Pick<MdmTagRecord, 'entityId' | 'tag'>): Promise<void> {
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

function spyReads(ctx: RequestContext): { count: number } {
  const reads = { count: 0 };
  const findMany = ctx.data.mdmTag.findMany.bind(ctx.data.mdmTag);
  ctx.data.mdmTag.findMany = async (input) => {
    reads.count += 1;
    return findMany(input);
  };
  return reads;
}

function ok<T extends Record<string, unknown>>(body: T) {
  return { httpStatus: 200, body: { statusCode: 200, ...body } };
}

type RoutedCall = { method: 'resolve' | 'link'; asUserId: string; input: Record<string, unknown> };

function routed(script: (call: RoutedCall) => { httpStatus: number; body: { statusCode: number } } | never): IdentityClient & { calls: RoutedCall[] } {
  const calls: RoutedCall[] = [];
  return {
    calls,
    async resolveModulePeople(asUserId, input) {
      const recorded: RoutedCall = { method: 'resolve', asUserId, input: { ...input } };
      calls.push(recorded);
      return script(recorded) as Awaited<ReturnType<IdentityClient['resolveModulePeople']>>;
    },
    async linkModulePerson(asUserId, input) {
      const recorded: RoutedCall = { method: 'link', asUserId, input: { ...input } };
      calls.push(recorded);
      return script(recorded) as Awaited<ReturnType<IdentityClient['linkModulePerson']>>;
    },
  };
}

function pair(mdmId: string, cmUserId: string, state: Person['state']): Person[] {
  const personState = { mdmId, cmUserId, state };
  return [personState, { ...personState }];
}

test('first link uses the server login, then a new provider repeats the canonical pair', async () => {
  const ctx = ctxOf('app-a');
  const mdmId = await person(ctx, '  Aluno@Academia.Test ');
  const reads = spyReads(ctx);
  let stored: Person | undefined;
  const client = routed((call) => {
    assert.equal(call.asUserId, 'app:app-a');
    assert.equal(JSON.stringify(call.input).includes('decoy'), false);
    if (call.method === 'link') {
      assert.deepEqual(call.input, { mdmId, loginEmail: 'aluno@academia.test' });
      stored = { mdmId, cmUserId: 'cm-aluno', state: 'linked' };
      return ok({ cmUserId: 'cm-aluno', outcome: 'linked' });
    }
    const mdmIds = call.input.mdmIds as string[] | undefined;
    const cmUserIds = call.input.cmUserIds as string[] | undefined;
    if (!stored) return ok({ people: [{ mdmId, state: 'unlinked' }] });
    if (mdmIds && cmUserIds) return ok({ people: pair(mdmId, 'cm-aluno', 'linked') });
    return ok({ people: [{ ...stored }] });
  });
  const first = createMessagesWorkflowIdentities({ projectId: 'app-a', client });
  assert.equal(await first.toCmUserId(ctx, mdmId), 'cm-aluno');
  assert.equal(reads.count, 1);
  const links = client.calls.filter((call) => call.method === 'link');
  assert.equal(links.length, 1);

  const again = createMessagesWorkflowIdentities({ projectId: 'app-a', client });
  const before = client.calls.length;
  assert.equal(await again.toCmUserId(ctx, mdmId), 'cm-aluno');
  assert.equal(reads.count, 1);
  assert.equal(client.calls.slice(before).some((call) => call.method === 'link'), false);
});

test('an existing link ignores a changed server login', async () => {
  const ctx = ctxOf('app-a');
  const mdmId = await person(ctx, 'antes@academia.test');
  await ctx.mdm.identity.setLogin(mdmId, 'depois@academia.test');
  const reads = spyReads(ctx);
  const client = routed((call) => {
    assert.equal(call.method, 'resolve');
    const both = call.input.cmUserIds !== undefined;
    return ok({ people: both ? pair(mdmId, 'cm-estavel', 'linked') : [{ mdmId, cmUserId: 'cm-estavel', state: 'linked' }] });
  });
  const identities = createMessagesWorkflowIdentities({ projectId: 'app-a', client });
  assert.equal(await identities.toCmUserId(ctx, mdmId), 'cm-estavel');
  assert.equal(reads.count, 0);
  assert.equal(client.calls.some((call) => call.method === 'link'), false);
});

test('unknown reverse stays unlinked and does not read the login', async () => {
  const ctx = ctxOf('app-a');
  const reads = spyReads(ctx);
  const client = routed(() => ok({ people: [{ cmUserId: 'cm-desconhecido', state: 'unlinked' }] }));
  const identities = createMessagesWorkflowIdentities({ projectId: 'app-a', client });
  await assert.rejects(
    () => identities.toMdmId(ctx, 'cm-desconhecido'),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_IDENTITY_UNLINKED' && error.statusCode === 409 && !error.message.includes('@'),
  );
  assert.equal(reads.count, 0);
  assert.equal(client.calls.length, 1);
});

test('removed history translates back and forward refuses a new assignment', async () => {
  const ctx = ctxOf('app-a');
  const mdmId = await person(ctx, 'removido@academia.test');
  const reads = spyReads(ctx);
  const client = routed((call) => {
    assert.equal(call.method, 'resolve');
    const both = call.input.mdmIds !== undefined && call.input.cmUserIds !== undefined;
    return ok({ people: both ? pair(mdmId, 'cm-removido', 'removed') : [{ mdmId, cmUserId: 'cm-removido', state: 'removed' }] });
  });
  const identities = createMessagesWorkflowIdentities({ projectId: 'app-a', client });
  assert.equal(await identities.toMdmId(ctx, 'cm-removido'), mdmId);
  await assert.rejects(
    () => identities.toCmUserId(ctx, mdmId),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_IDENTITY_REMOVED' && error.statusCode === 409,
  );
  assert.equal(reads.count, 0);
  assert.equal(client.calls.some((call) => call.method === 'link'), false);
});

test('ambiguity and link collision stop without a local pair', async () => {
  const ctx = ctxOf('app-a');
  const mdmId = await person(ctx, 'um@academia.test');
  await insertTag(ctx, { entityId: mdmId, tag: 'dois@academia.test' });
  const ambiguous = routed(() => ok({ people: [{ mdmId, state: 'unlinked' }] }));
  await assert.rejects(
    () => createMessagesWorkflowIdentities({ projectId: 'app-a', client: ambiguous }).toCmUserId(ctx, mdmId),
    (error: unknown) => error instanceof AppError && error.code === 'MDM_LOGIN_AMBIGUOUS' && error.statusCode === 409,
  );
  assert.equal(ambiguous.calls.some((call) => call.method === 'link'), false);

  const other = await person(ctx, 'colisao@academia.test');
  const collision = routed((call) => {
    if (call.method === 'link') {
      return { httpStatus: 409, body: { statusCode: 409, code: 'link_conflict', msg: 'secret aluno@academia.test token' } };
    }
    const asked = (call.input.mdmIds as string[])[0];
    return ok({ people: [{ mdmId: asked, state: 'unlinked' }] });
  });
  await assert.rejects(
    () => createMessagesWorkflowIdentities({ projectId: 'app-a', client: collision }).toCmUserId(ctx, other),
    (error: unknown) => error instanceof AppError
      && error.code === 'WORKFLOW_CM_PROTOCOL_ERROR'
      && error.statusCode === 409
      && !error.message.includes('@')
      && !error.message.includes('token'),
  );
});

test('partial pair, incompatible inverse and the wrong id are refused', async () => {
  const ctx = ctxOf('app-a');
  const mdmId = await person(ctx, 'parcial@academia.test');
  const partial = routed((call) => {
    if (call.input.cmUserIds !== undefined) return ok({ people: [{ mdmId, cmUserId: 'cm-parcial', state: 'linked' }] });
    return ok({ people: [{ mdmId, cmUserId: 'cm-parcial', state: 'linked' }] });
  });
  await assert.rejects(
    () => createMessagesWorkflowIdentities({ projectId: 'app-a', client: partial }).toCmUserId(ctx, mdmId),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_IDENTITY_INCOMPLETE' && error.statusCode === 503,
  );

  const inverse = routed((call) => {
    if (call.input.cmUserIds !== undefined) {
      return ok({ people: [
        { mdmId, cmUserId: 'cm-parcial', state: 'linked' },
        { mdmId: 'mdm-outro', cmUserId: 'cm-parcial', state: 'linked' },
      ] });
    }
    return ok({ people: [{ mdmId, cmUserId: 'cm-parcial', state: 'linked' }] });
  });
  await assert.rejects(
    () => createMessagesWorkflowIdentities({ projectId: 'app-a', client: inverse }).toCmUserId(ctx, mdmId),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_IDENTITY_INCOMPLETE',
  );

  const wrong = routed(() => ok({ people: [{ mdmId: 'mdm-errado', cmUserId: 'cm-x', state: 'linked' }] }));
  await assert.rejects(
    () => createMessagesWorkflowIdentities({ projectId: 'app-a', client: wrong }).toCmUserId(ctx, mdmId),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_CM_PROTOCOL_ERROR' && error.statusCode === 502,
  );

  const removedBare = routed(() => ok({ people: [{ cmUserId: 'cm-sem-par', state: 'removed' }] }));
  await assert.rejects(
    () => createMessagesWorkflowIdentities({ projectId: 'app-a', client: removedBare }).toMdmId(ctx, 'cm-sem-par'),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_CM_PROTOCOL_ERROR' && error.statusCode === 502,
  );
});

test('timeout after link is not retried; the next call uses the canonical pair', async () => {
  const ctx = ctxOf('app-a');
  const mdmId = await person(ctx, 'timeout@academia.test');
  const reads = spyReads(ctx);
  let stage = 0;
  const client = routed((call) => {
    if (call.method === 'link') {
      assert.equal(call.input.loginEmail, 'timeout@academia.test');
      stage = 1;
      return ok({ cmUserId: 'cm-timeout', outcome: 'existing' });
    }
    if (stage === 0) return ok({ people: [{ mdmId, state: 'unlinked' }] });
    if (stage === 1) {
      stage = 2;
      throw new AppError('MSG_SERVICE_TIMEOUT', 'collab-messages resolveModulePeople timed out', 504);
    }
    const both = call.input.cmUserIds !== undefined;
    return ok({ people: both ? pair(mdmId, 'cm-timeout', 'linked') : [{ mdmId, cmUserId: 'cm-timeout', state: 'linked' }] });
  });
  const identities = createMessagesWorkflowIdentities({ projectId: 'app-a', client });
  await assert.rejects(
    () => identities.toCmUserId(ctx, mdmId),
    (error: unknown) => error instanceof AppError && error.code === 'MSG_SERVICE_TIMEOUT' && error.statusCode === 504,
  );
  assert.equal(client.calls.filter((call) => call.method === 'link').length, 1);
  assert.equal(await identities.toCmUserId(ctx, mdmId), 'cm-timeout');
  assert.equal(client.calls.filter((call) => call.method === 'link').length, 1);
  assert.equal(reads.count, 1);
});

test('a second context or app does not reuse the other binding', async () => {
  const home = ctxOf('app-a');
  const mdmId = await person(home, 'app@academia.test');
  const calls: string[] = [];
  const client = routed((call) => {
    calls.push(call.asUserId);
    if (call.asUserId !== 'app:app-a') return ok({ people: [{ mdmId, state: 'unlinked' }] });
    const both = call.input.cmUserIds !== undefined;
    return ok({ people: both ? pair(mdmId, 'cm-app-a', 'linked') : [{ mdmId, cmUserId: 'cm-app-a', state: 'linked' }] });
  });
  const onA = createMessagesWorkflowIdentities({ projectId: 'app-a', client });
  assert.equal(await onA.toCmUserId(home, mdmId), 'cm-app-a');
  await assert.rejects(
    () => onA.toCmUserId(ctxOf('app-b'), mdmId),
    (error: unknown) => error instanceof AppError && error.code === 'MSG_APP_SCOPE_INVALID' && error.statusCode === 400,
  );
  const onB = createMessagesWorkflowIdentities({ projectId: 'app-b', client });
  await assert.rejects(
    () => onB.toCmUserId(ctxOf('app-b'), mdmId),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_IDENTITY_UNLINKED',
  );
  assert.deepEqual(calls, ['app:app-a', 'app:app-a', 'app:app-b']);
});
