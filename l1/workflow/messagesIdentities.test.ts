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

test('an inconsistent record is an incomplete link in both directions, and identity_too_large keeps its status', async () => {
  const ctx = ctxOf('app-a');
  const mdmId = await person(ctx, 'inconsistente@academia.test');
  let links = 0;
  const inconsistent = routed((call) => {
    if (call.method === 'link') links += 1;
    if (call.input.cmUserIds !== undefined) return ok({ people: [{ mdmId: 'mdm-outro', cmUserId: 'cm-x', state: 'inconsistent' }] });
    return ok({ people: [{ mdmId, cmUserId: 'cm-x', state: 'inconsistent' }] });
  });
  const identities = createMessagesWorkflowIdentities({ projectId: 'app-a', client: inconsistent });
  await assert.rejects(
    () => identities.toCmUserId(ctx, mdmId),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_IDENTITY_INCOMPLETE' && error.statusCode === 503,
  );
  await assert.rejects(
    () => identities.toMdmId(ctx, 'cm-x'),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_IDENTITY_INCOMPLETE' && error.statusCode === 503,
  );
  assert.equal(links, 0);

  const tooLarge = routed((call) => {
    if (call.method === 'link') return { httpStatus: 507, body: { statusCode: 507, msg: 'identity_too_large' } };
    return ok({ people: [{ mdmId, state: 'unlinked' }] });
  });
  await assert.rejects(
    () => createMessagesWorkflowIdentities({ projectId: 'app-a', client: tooLarge }).toCmUserId(ctx, mdmId),
    (error: unknown) => error instanceof AppError && error.statusCode === 507 && !error.message.includes('@'),
  );
});

// --- grouped translation: `toMdmIds` -------------------------------------------------------------------------------

type Row = { mdmId: string; state: 'linked' | 'removed' | 'unlinked' | 'inconsistent'; confirmAs?: Person[] };

/** A cm with a book of users: `resolveModulePeople` answers `mdmIds` first and `cmUserIds` after, one entry per id. */
function bookClient(book: Record<string, Row>, options: { reverse?: boolean } = {}): IdentityClient & { calls: RoutedCall[] } {
  const byMdm = new Map(Object.entries(book).map(([cmUserId, row]) => [row.mdmId, { cmUserId, row }]));
  return routed((call) => {
    assert.equal(call.method, 'resolve');
    const mdmIds = (call.input.mdmIds as string[] | undefined) ?? [];
    const cmUserIds = (call.input.cmUserIds as string[] | undefined) ?? [];
    const people: Person[] = [];
    for (const id of mdmIds) {
      const hit = byMdm.get(id);
      if (!hit) throw new Error(`unscripted mdm ${id}`);
      people.push(hit.row.state === 'unlinked' ? { mdmId: id, state: 'unlinked' } : { mdmId: id, cmUserId: hit.cmUserId, state: hit.row.state as Person['state'] });
    }
    for (const id of cmUserIds) {
      const row = book[id];
      if (!row) throw new Error(`unscripted cm ${id}`);
      people.push(row.state === 'unlinked' ? { cmUserId: id, state: 'unlinked' } : { mdmId: row.mdmId, cmUserId: id, state: row.state as Person['state'] });
    }
    if (mdmIds.length > 0 && cmUserIds.length > 0) {
      // Confirmation call: a row may answer something else for its own pair.
      for (const [index, id] of mdmIds.entries()) {
        const hit = byMdm.get(id);
        if (hit?.row.confirmAs) people[index] = hit.row.confirmAs[0];
      }
      for (const [index, id] of cmUserIds.entries()) {
        const row = book[id];
        if (row?.confirmAs) people[mdmIds.length + index] = row.confirmAs[1];
      }
    }
    return ok({ people: options.reverse ? [...people.slice(0, mdmIds.length).reverse(), ...people.slice(mdmIds.length).reverse()] : people }) as never;
  }) as IdentityClient & { calls: RoutedCall[] };
}

function manyUsers(count: number): Record<string, Row> {
  const book: Record<string, Row> = {};
  for (let index = 0; index < count; index += 1) book[`cm-${index}`] = { mdmId: `mdm-${index}`, state: 'linked' };
  return book;
}

test('toMdmIds: 1, 4 and 10 users take two calls each, repeated ids count once, and none takes none', async () => {
  for (const count of [1, 4, 10]) {
    const book = manyUsers(count);
    const client = bookClient(book);
    const ids = createMessagesWorkflowIdentities({ projectId: 'app-a', client });
    const asked = Object.keys(book).flatMap((id) => [id, id]);
    const out = await ids.toMdmIds(ctxOf('app-a'), asked);
    assert.deepEqual([...out.entries()], Object.entries(book).map(([cm, row]) => [cm, row.mdmId]));
    assert.equal(client.calls.length, 2, `${count} users`);
    assert.deepEqual(client.calls[0].input, { cmUserIds: Object.keys(book) });
    assert.deepEqual(client.calls[1].input, { mdmIds: Object.values(book).map((row) => row.mdmId), cmUserIds: Object.keys(book) });
  }
  const idle = bookClient({});
  assert.equal((await createMessagesWorkflowIdentities({ projectId: 'app-a', client: idle }).toMdmIds(ctxOf('app-a'), [])).size, 0);
  assert.equal(idle.calls.length, 0);
});

test('toMdmIds: an answer out of order gives the same result', async () => {
  const book = manyUsers(5);
  const ordered = await createMessagesWorkflowIdentities({ projectId: 'app-a', client: bookClient(book) }).toMdmIds(ctxOf('app-a'), Object.keys(book));
  const reversed = await createMessagesWorkflowIdentities({ projectId: 'app-a', client: bookClient(book, { reverse: true }) }).toMdmIds(ctxOf('app-a'), Object.keys(book));
  assert.deepEqual([...reversed.entries()], [...ordered.entries()]);
});

test('toMdmIds: a removed person is accepted as history, like toMdmId', async () => {
  const book: Record<string, Row> = { 'cm-1': { mdmId: 'mdm-1', state: 'linked' }, 'cm-2': { mdmId: 'mdm-2', state: 'removed' } };
  const ids = createMessagesWorkflowIdentities({ projectId: 'app-a', client: bookClient(book) });
  const out = await ids.toMdmIds(ctxOf('app-a'), ['cm-1', 'cm-2']);
  assert.deepEqual([...out.entries()], [['cm-1', 'mdm-1'], ['cm-2', 'mdm-2']]);
  assert.equal(await ids.toMdmId(ctxOf('app-a'), 'cm-2'), 'mdm-2');
});

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    assert.ok(error instanceof AppError);
    return error.code;
  }
  return 'none';
}

test('toMdmIds: one bad person in the middle fails the whole reading with the code toMdmId gives, never a partial map', async () => {
  const wrongPair = (cm: string): Person[] => [
    { mdmId: 'mdm-b', cmUserId: 'cm-other', state: 'linked' },
    { mdmId: 'mdm-other', cmUserId: cm, state: 'linked' },
  ];
  const cases: Array<[string, Row, string]> = [
    ['inconsistent', { mdmId: 'mdm-b', state: 'inconsistent' }, 'WORKFLOW_IDENTITY_INCOMPLETE'],
    ['unlinked', { mdmId: 'mdm-b', state: 'unlinked' }, 'WORKFLOW_IDENTITY_UNLINKED'],
    ['swapped pair', { mdmId: 'mdm-b', state: 'linked', confirmAs: wrongPair('cm-b') }, 'WORKFLOW_IDENTITY_INCOMPLETE'],
  ];
  for (const [label, bad, code] of cases) {
    const book: Record<string, Row> = {
      'cm-a': { mdmId: 'mdm-a', state: 'linked' },
      'cm-b': bad,
      'cm-c': { mdmId: 'mdm-c', state: 'linked' },
    };
    const client = bookClient(book);
    const ids = createMessagesWorkflowIdentities({ projectId: 'app-a', client });
    assert.equal(await codeOf(ids.toMdmIds(ctxOf('app-a'), ['cm-a', 'cm-b', 'cm-c'])), code, label);
    assert.equal(client.calls.length <= 2, true, label);
    // The one-person path says the same for that person.
    assert.equal(await codeOf(createMessagesWorkflowIdentities({ projectId: 'app-a', client: bookClient(book) }).toMdmId(ctxOf('app-a'), 'cm-b')), code, label);
  }
});

test('toMdmIds: the first refusal in the order given decides, as the sequential reading did', async () => {
  const book: Record<string, Row> = {
    'cm-a': { mdmId: 'mdm-a', state: 'linked', confirmAs: [{ mdmId: 'mdm-a', cmUserId: 'cm-x', state: 'linked' }, { mdmId: 'mdm-a', cmUserId: 'cm-x', state: 'linked' }] },
    'cm-b': { mdmId: 'mdm-b', state: 'unlinked' },
  };
  const ids = createMessagesWorkflowIdentities({ projectId: 'app-a', client: bookClient(book) });
  assert.equal(await codeOf(ids.toMdmIds(ctxOf('app-a'), ['cm-a', 'cm-b'])), 'WORKFLOW_IDENTITY_INCOMPLETE');
  assert.equal(await codeOf(ids.toMdmIds(ctxOf('app-a'), ['cm-b', 'cm-a'])), 'WORKFLOW_IDENTITY_UNLINKED');
});

test('toMdmIds: an answer that does not match the question is a protocol error and a bad id stops before any call', async () => {
  const short = routed(() => ok({ people: [{ mdmId: 'mdm-1', cmUserId: 'cm-1', state: 'linked' }] }) as never);
  const ids = createMessagesWorkflowIdentities({ projectId: 'app-a', client: short });
  assert.equal(await codeOf(ids.toMdmIds(ctxOf('app-a'), ['cm-1', 'cm-2'])), 'WORKFLOW_CM_PROTOCOL_ERROR');
  const before = short.calls.length;
  assert.equal(await codeOf(ids.toMdmIds(ctxOf('app-a'), ['cm-1', ' '])), 'WORKFLOW_CM_PROTOCOL_ERROR');
  assert.equal(short.calls.length, before);
  assert.equal(await codeOf(ids.toMdmIds(ctxOf('app-b'), ['cm-1'])), 'MSG_APP_SCOPE_INVALID');
});

// --- grouped translation of the write: `toCmUserIds` ---------------------------------------------------------------

/** A cm whose book is keyed by mdmId; answers `mdmIds` then `cmUserIds`, one entry per id, like the producer. */
function writeBook(book: Record<string, Row & { cmUserId: string }>): IdentityClient & { calls: RoutedCall[] } {
  const byCm = new Map(Object.values(book).map((row) => [row.cmUserId, { mdmId: row.mdmId, row }]));
  return routed((call) => {
    assert.equal(call.method, 'resolve');
    const mdmIds = (call.input.mdmIds as string[] | undefined) ?? [];
    const cmUserIds = (call.input.cmUserIds as string[] | undefined) ?? [];
    const people: Person[] = [];
    for (const id of mdmIds) {
      const row = book[id];
      if (!row) throw new Error(`unscripted ${id}`);
      people.push(row.state === 'unlinked' ? { mdmId: id, state: 'unlinked' } : { mdmId: id, cmUserId: row.cmUserId, state: row.state as Person['state'] });
    }
    for (const id of cmUserIds) {
      const hit = byCm.get(id);
      if (!hit) throw new Error(`unscripted ${id}`);
      people.push({ mdmId: hit.mdmId, cmUserId: id, state: hit.row.state as Person['state'] });
    }
    if (mdmIds.length > 0 && cmUserIds.length > 0) {
      for (const [index, id] of mdmIds.entries()) if (book[id]?.confirmAs) people[index] = book[id].confirmAs![0];
      for (const [index, id] of cmUserIds.entries()) {
        const hit = byCm.get(id);
        if (hit?.row.confirmAs) people[mdmIds.length + index] = hit.row.confirmAs[1];
      }
    }
    return ok({ people }) as never;
  }) as IdentityClient & { calls: RoutedCall[] };
}

function linkedBook(count: number): Record<string, Row & { cmUserId: string }> {
  const book: Record<string, Row & { cmUserId: string }> = {};
  for (let index = 0; index < count; index += 1) book[`mdm-${index}`] = { mdmId: `mdm-${index}`, cmUserId: `cm-${index}`, state: 'linked' };
  return book;
}

test('toCmUserIds: 1, 4 and 10 linked people take two calls each, repeats count once, none takes none', async () => {
  for (const count of [1, 4, 10]) {
    const book = linkedBook(count);
    const client = writeBook(book);
    const ids = createMessagesWorkflowIdentities({ projectId: 'app-a', client });
    const asked = Object.keys(book).flatMap((id) => [id, id]);
    const out = await ids.toCmUserIds(ctxOf('app-a'), asked);
    assert.deepEqual([...out.entries()], Object.values(book).map((row) => [row.mdmId, row.cmUserId]));
    assert.equal(client.calls.length, 2, `${count} people`);
    assert.deepEqual(client.calls[0].input, { mdmIds: Object.keys(book) });
    assert.deepEqual(client.calls[1].input, { mdmIds: Object.keys(book), cmUserIds: Object.values(book).map((row) => row.cmUserId) });
    // Each person gets what `toCmUserId` gives.
    assert.equal(await createMessagesWorkflowIdentities({ projectId: 'app-a', client: writeBook(book) }).toCmUserId(ctxOf('app-a'), 'mdm-0'), 'cm-0');
  }
  const idle = writeBook({});
  assert.equal((await createMessagesWorkflowIdentities({ projectId: 'app-a', client: idle }).toCmUserIds(ctxOf('app-a'), [])).size, 0);
  assert.equal(idle.calls.length, 0);
});

test('toCmUserIds: inconsistent, removed and a swapped pair fail with the code toCmUserId gives, never a partial map', async () => {
  const swapped: Person[] = [
    { mdmId: 'mdm-b', cmUserId: 'cm-other', state: 'linked' },
    { mdmId: 'mdm-other', cmUserId: 'cm-b', state: 'linked' },
  ];
  const cases: Array<[string, Row & { cmUserId: string }, string]> = [
    ['inconsistent', { mdmId: 'mdm-b', cmUserId: 'cm-b', state: 'inconsistent' }, 'WORKFLOW_IDENTITY_INCOMPLETE'],
    ['removed', { mdmId: 'mdm-b', cmUserId: 'cm-b', state: 'removed' }, 'WORKFLOW_IDENTITY_REMOVED'],
    ['swapped pair', { mdmId: 'mdm-b', cmUserId: 'cm-b', state: 'linked', confirmAs: swapped }, 'WORKFLOW_IDENTITY_INCOMPLETE'],
  ];
  for (const [label, bad, code] of cases) {
    const book = {
      'mdm-a': { mdmId: 'mdm-a', cmUserId: 'cm-a', state: 'linked' as const },
      'mdm-b': bad,
      'mdm-c': { mdmId: 'mdm-c', cmUserId: 'cm-c', state: 'linked' as const },
    };
    const client = writeBook(book);
    assert.equal(await codeOf(createMessagesWorkflowIdentities({ projectId: 'app-a', client }).toCmUserIds(ctxOf('app-a'), ['mdm-a', 'mdm-b', 'mdm-c'])), code, label);
    assert.equal(client.calls.length <= 2, true, label);
    assert.equal(await codeOf(createMessagesWorkflowIdentities({ projectId: 'app-a', client: writeBook(book) }).toCmUserId(ctxOf('app-a'), 'mdm-b')), code, label);
  }
});

test('toCmUserIds: the first refusal in the order given decides', async () => {
  const wrong: Person[] = [{ mdmId: 'mdm-a', cmUserId: 'cm-x', state: 'linked' }, { mdmId: 'mdm-a', cmUserId: 'cm-x', state: 'linked' }];
  const book = {
    'mdm-a': { mdmId: 'mdm-a', cmUserId: 'cm-a', state: 'linked' as const, confirmAs: wrong },
    'mdm-b': { mdmId: 'mdm-b', cmUserId: 'cm-b', state: 'removed' as const },
  };
  const ids = createMessagesWorkflowIdentities({ projectId: 'app-a', client: writeBook(book) });
  assert.equal(await codeOf(ids.toCmUserIds(ctxOf('app-a'), ['mdm-a', 'mdm-b'])), 'WORKFLOW_IDENTITY_INCOMPLETE');
  assert.equal(await codeOf(ids.toCmUserIds(ctxOf('app-a'), ['mdm-b', 'mdm-a'])), 'WORKFLOW_IDENTITY_REMOVED');
});

test('toCmUserIds: a person not linked yet in the middle is linked the way toCmUserId does, and the result is the same', async () => {
  const ctx = ctxOf('app-a');
  const lonely = await person(ctx, 'novo@academia.test');
  const book: Record<string, { cmUserId: string; state: 'linked' | 'unlinked'; mdmId: string }> = {
    'mdm-a': { mdmId: 'mdm-a', cmUserId: 'cm-a', state: 'linked' },
    [lonely]: { mdmId: lonely, cmUserId: 'cm-novo', state: 'unlinked' },
    'mdm-c': { mdmId: 'mdm-c', cmUserId: 'cm-c', state: 'linked' },
  };
  const client = routed((call) => {
    if (call.method === 'link') {
      assert.deepEqual(call.input, { mdmId: lonely, loginEmail: 'novo@academia.test' });
      book[lonely].state = 'linked';
      return ok({ cmUserId: 'cm-novo', outcome: 'linked' }) as never;
    }
    const mdmIds = (call.input.mdmIds as string[] | undefined) ?? [];
    const cmUserIds = (call.input.cmUserIds as string[] | undefined) ?? [];
    const byCm = new Map(Object.values(book).map((row) => [row.cmUserId, row]));
    const view = (row: (typeof book)[string], asked: 'mdm' | 'cm'): Person => (row.state === 'unlinked'
      ? (asked === 'mdm' ? { mdmId: row.mdmId, state: 'unlinked' } : { cmUserId: row.cmUserId, state: 'unlinked' })
      : { mdmId: row.mdmId, cmUserId: row.cmUserId, state: 'linked' });
    return ok({ people: [...mdmIds.map((id) => view(book[id], 'mdm')), ...cmUserIds.map((id) => view(byCm.get(id)!, 'cm'))] }) as never;
  });
  const ids = createMessagesWorkflowIdentities({ projectId: 'app-a', client });
  const out = await ids.toCmUserIds(ctx, ['mdm-a', lonely, 'mdm-c']);
  assert.deepEqual([...out.entries()], [['mdm-a', 'cm-a'], [lonely, 'cm-novo'], ['mdm-c', 'cm-c']]);
  assert.equal(client.calls.filter((call) => call.method === 'link').length, 1);
  // Same answer as the person-by-person path over a fresh cm.
  assert.equal(await createMessagesWorkflowIdentities({ projectId: 'app-a', client }).toCmUserId(ctx, 'mdm-a'), 'cm-a');
});

test('toCmUserIds: a bad id stops before any call and the wrong app is refused', async () => {
  const client = writeBook(linkedBook(1));
  const ids = createMessagesWorkflowIdentities({ projectId: 'app-a', client });
  assert.equal(await codeOf(ids.toCmUserIds(ctxOf('app-a'), ['mdm-0', ' '])), 'WORKFLOW_CM_PROTOCOL_ERROR');
  assert.equal(client.calls.length, 0);
  assert.equal(await codeOf(ids.toCmUserIds(ctxOf('app-b'), ['mdm-0'])), 'MSG_APP_SCOPE_INVALID');
});
