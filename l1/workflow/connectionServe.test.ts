/// <mls fileReference="_102034_/l1/workflow/connectionServe.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test from 'node:test';
import type { BffRequest, BffResponse, RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { DefsReader } from '/_102034_/l1/workflow/assistantCatalogDefs.js';
import { buildServeIndex, createConnectionServer, type ConnectionServerDeps, type ServeIndex } from '/_102034_/l1/workflow/connectionServe.js';
import { exampleCatalog } from '/_102034_/testing/connections/connectionFixtures.js';
import { createGeneratedRoute } from '/_102034_/testing/connections/generatedRoute.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { findAgentMember } from '/_102034_/l1/mdm/layer_3_usecases/agentMember.js';
import { mdmPlatformServes } from '/_102034_/l1/mdm/layer_3_usecases/platformServes.js';
import cm from '/_102034_/l2/shared/contracts/connections/cm.js';
import type { ConnectionCatalog, ConnectionContext } from '/_102034_/l2/shared/contracts/connections/types.js';

const CTX = {} as RequestContext;
const CONTEXT: ConnectionContext = { organizationId: 'org-1', actorUserId: 'cm-1' };

type Files = Record<string, unknown>;

function reader(files: Files): DefsReader {
  return {
    list: (folder) => Object.keys(files).filter((file) => file.startsWith(`${folder}/`)).map((file) => file.slice(folder.length + 1)).sort(),
    async read(file) {
      const value = files[file];
      if (value instanceof Error) throw value;
      return value;
    },
    json: () => undefined,
    text: () => undefined,
  };
}

const defs = (requests: unknown[]): { data: { requests: unknown[] } } => ({ data: { requests } });
const REQ = 'layer_2_application/requests';

function index(entries: Record<string, Array<{ moduleId: string; route: string }>>): ServeIndex {
  return { byOperation: new Map(Object.entries(entries)), issues: [] };
}

function harness(over: Partial<ConnectionServerDeps> & { served?: ServeIndex; answer?: { response: BffResponse; statusCode: number } | Error } = {}) {
  const requests: Array<{ request: BffRequest; ctx: RequestContext }> = [];
  const logs: string[] = [];
  const catalogs: Record<string, ConnectionCatalog> = { cm, example: exampleCatalog };
  const serve = createConnectionServer({
    catalogOf: async (id) => catalogs[id],
    moduleCatalogOf: over.moduleCatalogOf,
    index: async () => over.served ?? index({ 'cm.describe': [{ moduleId: 'modA', route: 'modA.agents.describe' }] }),
    execMessage: async (request, ctx) => {
      requests.push({ request, ctx });
      const answer = over.answer ?? { response: { ok: true, data: { version: 'v1' } } as BffResponse, statusCode: 200 };
      if (answer instanceof Error) throw answer;
      return answer;
    },
    newContext: () => CTX,
    toMdmId: over.toMdmId,
    log: (line) => logs.push(line),
  });
  return { serve, requests, logs };
}

const call = (operationId = 'describe', context: ConnectionContext = CONTEXT, extra: Record<string, unknown> = {}) =>
  ({ connectionId: 'cm', operationId, input: { agentId: 'nora' }, context, ...extra });

test('the marks come from the request defs of the modules of the release, and a duplicate or a def that cannot be read is said, never silent', async () => {
  const built = await buildServeIndex(reader({
    [`l1/modA/${REQ}/agents.defs.js`]: defs([
      { route: 'modA.agents.describe', serves: 'cm.describe' },
      { route: 'modA.agents.list', kind: 'qry' },
      { route: 'modA.agents.bad', serves: 'not a mark' },
    ]),
    [`l1/modB/${REQ}/other.defs.js`]: defs([{ route: 'modB.other.describe', serves: 'cm.describe' }, { route: 'modB.other.record', serves: 'cm.record' }]),
    [`l1/modC/${REQ}/broken.defs.js`]: new Error('old shape'),
  }), ['modA', 'modB', 'modC']);
  assert.deepEqual(built.byOperation.get('cm.record'), [{ moduleId: 'modB', route: 'modB.other.record' }]);
  assert.equal(built.byOperation.get('cm.describe')?.length, 2);
  assert.ok(built.issues.some((issue) => issue.startsWith('SERVES_DUPLICATE: cm.describe')));
  assert.ok(built.issues.includes('SERVES_INVALID: modA.agents.bad'));
  assert.ok(built.issues.some((issue) => issue.startsWith('DEF_UNREADABLE: l1/modC/')));
  assert.equal(built.byOperation.has('not a mark'), false);
});

test('the operation goes to the route with the mark, under the technical identity, with the context and the key in the request, and the route keeps its own authorization', async () => {
  const h = harness();
  const result = await h.serve(call('describe', CONTEXT, { idempotencyKey: 'key-1' }));
  assert.deepEqual(result, { ok: true, output: { version: 'v1' } });
  assert.equal(h.requests.length, 1);
  const { request, ctx } = h.requests[0];
  assert.equal(ctx, CTX);
  assert.equal(request.routine, 'modA.agents.describe');
  assert.deepEqual(request.params, { agentId: 'nora' });
  assert.equal(request.meta?.userId, 'connection:cm');
  assert.equal(request.meta?.actorId, 'connection:cm');
  assert.deepEqual(request.meta?.actorScope, ['modA:connection:cm'], 'the technical actor the route has to allow; nothing wider');
  assert.equal(request.meta?.requestId, 'key-1');
  assert.deepEqual(request.meta?.connection, { connectionId: 'cm', operationId: 'describe', context: CONTEXT, idempotencyKey: 'key-1' });
  assert.equal(request.meta?.verifiedEmail, undefined, 'no person is the caller');
});

test('not_found without a mark (a normal answer), invalid with a duplicate mark, a call direction or an unknown operation; nothing runs', async () => {
  const none = harness({ served: index({}) });
  assert.deepEqual(await none.serve(call('describe')), { ok: false, code: 'not_found', message: 'no route of this release serves cm.describe' });
  const twice = harness({ served: index({ 'cm.describe': [{ moduleId: 'a', route: 'a.x.d' }, { moduleId: 'b', route: 'b.x.d' }] }) });
  assert.equal((await twice.serve(call('describe'))).ok, false);
  const wrongWay = harness();
  for (const operationId of ['listAgents', 'nope']) {
    const result = await wrongWay.serve(call(operationId));
    assert.equal(result.ok === false && result.code, 'invalid', operationId);
  }
  assert.equal((await wrongWay.serve({ ...call('describe'), connectionId: 'nowhere' })).ok, false);
  assert.equal(none.requests.length + twice.requests.length + wrongWay.requests.length, 0);
  assert.equal((await wrongWay.serve(call('describe', { organizationId: '' }))).ok, false);
});

test('what the route answers becomes one of the seven codes: done, 403, 404, a version conflict, validation, another 4xx and a failure', async () => {
  const cases: Array<[{ response: BffResponse; statusCode: number } | Error, string | null]> = [
    [{ response: { ok: false, error: { code: 'FORBIDDEN_ACTOR', message: 'no' } } as BffResponse, statusCode: 403 }, 'forbidden'],
    [{ response: { ok: false, error: { code: 'NOT_FOUND', message: 'gone' } } as BffResponse, statusCode: 404 }, 'not_found'],
    [{ response: { ok: false, error: { code: 'VERSION_CONFLICT', message: 'stale' } } as BffResponse, statusCode: 409 }, 'conflict'],
    [{ response: { ok: false, error: { code: 'VALIDATION_ERROR', message: 'bad' } } as BffResponse, statusCode: 400 }, 'invalid'],
    [{ response: { ok: false, error: { code: 'RULE', message: 'rule says no' } } as BffResponse, statusCode: 422 }, 'refused'],
    [{ response: { ok: false, error: { code: 'BOOM', message: 'x' } } as BffResponse, statusCode: 500 }, 'unavailable'],
    [new Error('crash'), 'unavailable'],
  ];
  for (const [answer, code] of cases) {
    const result = await harness({ answer }).serve(call());
    assert.equal(result.ok === false && result.code, code);
  }
});

test('the person: the mdm id is filled by the link and the one in the body is never believed; without the link it goes on without it', async () => {
  const linked = harness({ toMdmId: async (_ctx, cmUserId) => `mdm-of-${cmUserId}` });
  await linked.serve(call('describe', { organizationId: 'org-1', actorUserId: 'cm-1', actorMdmId: 'forged' }));
  assert.deepEqual(linked.requests[0].request.meta?.connection?.context, { organizationId: 'org-1', actorUserId: 'cm-1', actorMdmId: 'mdm-of-cm-1' });

  const unlinked = harness({ toMdmId: async () => { throw new Error('no link'); } });
  const result = await unlinked.serve(call('describe', { organizationId: 'org-1', actorUserId: 'cm-1', actorMdmId: 'forged' }));
  assert.equal(result.ok, true, 'never refused for this');
  assert.deepEqual(unlinked.requests[0].request.meta?.connection?.context, { organizationId: 'org-1', actorUserId: 'cm-1' });

  const noPerson = harness({ toMdmId: async () => 'should-not-be-asked' });
  await noPerson.serve(call('describe', { organizationId: 'org-1' }));
  assert.deepEqual(noPerson.requests[0].request.meta?.connection?.context, { organizationId: 'org-1' });
});

test('one log line per call, with no input and no context', async () => {
  const h = harness();
  await h.serve({ ...call('describe', { organizationId: 'org-1', actorUserId: 'context-sentinel' }), input: { secret: 'input-sentinel' } });
  await h.serve(call('nope'));
  assert.equal(h.logs.length, 2);
  assert.match(h.logs[0], /^\[connection\] serve cm\.describe ok=true ms=\d+$/);
  assert.match(h.logs[1], /^\[connection\] serve cm\.nope ok=false code=invalid reason=unknown-operation ms=\d+$/);
  for (const line of h.logs) assert.equal(/sentinel/.test(line), false);
});

test('the person who asked an agent (requestedBy) arrives by the mdm id too, from the link, and the one in the body is never believed', async () => {
  const linked = harness({ toMdmId: async (_ctx, cmUserId) => `mdm-of-${cmUserId}` });
  await linked.serve(call('describe', { organizationId: 'org-1', agentId: 'agent-1', requestedBy: 'cm-boss', requestedByMdmId: 'forged' }));
  assert.deepEqual(linked.requests[0].request.meta?.connection?.context, { organizationId: 'org-1', agentId: 'agent-1', requestedBy: 'cm-boss', requestedByMdmId: 'mdm-of-cm-boss' });

  const both = harness({ toMdmId: async (_ctx, cmUserId) => `mdm-of-${cmUserId}` });
  await both.serve(call('describe', { organizationId: 'org-1', actorUserId: 'cm-1', requestedBy: 'cm-boss' }));
  assert.deepEqual(both.requests[0].request.meta?.connection?.context, { organizationId: 'org-1', actorUserId: 'cm-1', requestedBy: 'cm-boss', actorMdmId: 'mdm-of-cm-1', requestedByMdmId: 'mdm-of-cm-boss' });

  const unlinked = harness({ toMdmId: async (_ctx, cmUserId) => { if (cmUserId === 'cm-boss') throw new Error('no link'); return 'mdm-of-other'; } });
  const result = await unlinked.serve(call('describe', { organizationId: 'org-1', agentId: 'agent-1', requestedBy: 'cm-boss', requestedByMdmId: 'forged' }));
  assert.equal(result.ok, true, 'never refused for this');
  assert.deepEqual(unlinked.requests[0].request.meta?.connection?.context, { organizationId: 'org-1', agentId: 'agent-1', requestedBy: 'cm-boss' });
});

test('the technical actor goes in verifiedAuthorities too, where the route confirms: a route that lists connection:<id> answers, one that does not is forbidden', async () => {
  const listed = createGeneratedRoute(['connection:cm'], { version: 'v1' });
  const lets = harness();
  const served = createConnectionServer({
    catalogOf: async () => cm,
    index: async () => index({ 'cm.describe': [{ moduleId: 'modA', route: 'modA.agents.describe' }] }),
    execMessage: async (request) => { lets.requests.push({ request, ctx: CTX }); return listed(request); },
    newContext: () => CTX,
    log: () => undefined,
  });
  assert.deepEqual(await served(call()), { ok: true, output: { version: 'v1' } });
  assert.deepEqual(lets.requests[0].request.meta?.verifiedAuthorities, ['modA:connection:cm']);
  assert.deepEqual(lets.requests[0].request.meta?.verifiedAuthorities, lets.requests[0].request.meta?.actorScope);

  // a route that does not list the technical actor: 403 from the route, `forbidden` for the caller
  const unlisted = createGeneratedRoute(['member']);
  const refuses = createConnectionServer({
    catalogOf: async () => cm,
    index: async () => index({ 'cm.describe': [{ moduleId: 'modA', route: 'modA.agents.describe' }] }),
    execMessage: async (request) => unlisted(request),
    newContext: () => CTX,
    log: () => undefined,
  });
  const result = await refuses(call());
  assert.equal(result.ok === false && result.code, 'forbidden');

  // the hole this closes: without verifiedAuthorities the same route lets any server call through
  const withoutIt = await unlisted({ routine: 'modA.agents.describe', params: {}, meta: { source: 'message', actorScope: ['modA:connection:cm'] } });
  assert.equal(withoutIt.statusCode, 200);
});

function platformHarness(over: { platform?: ConnectionServerDeps['platform']; served?: ServeIndex } = {}) {
  const ctx = createRequestContext(createMemoryDataRuntime());
  const served = over.served ?? index({});
  const executed: BffRequest[] = [];
  const serve = createConnectionServer({
    catalogOf: async (id) => (id === 'cm' ? cm : undefined),
    index: async () => served,
    execMessage: async (request) => {
      executed.push(request);
      return { response: { ok: true, data: {} } as BffResponse, statusCode: 200 };
    },
    newContext: () => ctx,
    ...(over.platform ? { platform: over.platform } : {}),
    log: () => undefined,
  });
  return { serve, ctx, served, executed };
}

const ensure = (agentId: string, name = 'Ana', active = true) => ({ connectionId: 'cm', operationId: 'ensureAgentMember', input: { agentId, name, active }, context: CONTEXT });

test('platform operation: the call creates the member and answers { mdmId }; repeating answers the same one', async () => {
  const { serve, ctx, executed } = platformHarness({ platform: mdmPlatformServes });
  const first = await serve(ensure('agent-serve-1'));
  assert.equal(first.ok, true);
  const mdmId = (first as { ok: true; output: { mdmId: string } }).output.mdmId;
  assert.ok(mdmId);
  assert.equal((await findAgentMember(ctx, 'agent-serve-1'))?.mdmId, mdmId);
  assert.deepEqual(await serve(ensure('agent-serve-1')), { ok: true, output: { mdmId } });
  const off = await serve(ensure('agent-serve-1', 'Ana', false));
  assert.deepEqual(off, { ok: true, output: { mdmId } });
  assert.equal((await findAgentMember(ctx, 'agent-serve-1'))?.active, false);
  assert.deepEqual(executed, [], 'no route of a module ran');
});

test('platform operation: a body out of the shape is invalid', async () => {
  const { serve } = platformHarness({ platform: mdmPlatformServes });
  for (const input of [{}, { agentId: 'a', name: 'n' }, { agentId: 'a', name: 'n', active: 'yes' }, { agentId: ' ', name: 'n', active: true }]) {
    const answer = await serve({ connectionId: 'cm', operationId: 'ensureAgentMember', input, context: CONTEXT });
    assert.equal(answer.ok, false);
    assert.equal((answer as { code: string }).code, 'invalid');
  }
});

test('platform operation without an answer registered: unavailable, with a line in the issues', async () => {
  const { serve, served, executed } = platformHarness();
  const answer = await serve(ensure('agent-serve-2'));
  assert.deepEqual(answer.ok ? null : answer.code, 'unavailable');
  assert.ok(served.issues.includes('PLATFORM_ANSWER_MISSING: cm.ensureAgentMember'));
  assert.deepEqual(executed, []);
});

test('platform operation: a route of a module that carries the mark is ignored and said in the issues', async () => {
  const { serve, served, executed, ctx } = platformHarness({
    platform: mdmPlatformServes,
    served: index({ 'cm.ensureAgentMember': [{ moduleId: 'modA', route: 'modA.agents.ensureMember' }] }),
  });
  const answer = await serve(ensure('agent-serve-3'));
  assert.equal(answer.ok, true);
  assert.deepEqual(executed, [], 'the route of the module never ran');
  assert.ok(served.issues.includes('SERVES_INVALID: modA.agents.ensureMember: cm.ensureAgentMember is answered by the platform'));
  assert.ok(await findAgentMember(ctx, 'agent-serve-3'));
});

test('rt315: two modules serve cm.sendChannelMessage; with targetModuleId only the route of that module runs, a module that does not serve it is not_found, and without it the answer is invalid as before', async () => {
  const served = index({ 'cm.sendChannelMessage': [{ moduleId: 'telegram', route: 'telegram.channel.send' }, { moduleId: 'whatsapp', route: 'whatsapp.channel.send' }] });
  const both = harness({ served });
  const send = (extra: Record<string, unknown> = {}) => both.serve({ ...call('sendChannelMessage'), ...extra } as never);
  assert.equal((await send({ targetModuleId: 'telegram' })).ok, true);
  assert.deepEqual(both.requests.map((entry) => entry.request.routine), ['telegram.channel.send']);
  assert.equal((await send({ targetModuleId: 'whatsapp' })).ok, true);
  assert.deepEqual(both.requests.map((entry) => entry.request.routine), ['telegram.channel.send', 'whatsapp.channel.send']);
  const absent = await send({ targetModuleId: 'signal' });
  assert.deepEqual(absent, { ok: false, code: 'not_found', message: 'no route of signal serves cm.sendChannelMessage' });
  const unnamed = await send();
  assert.equal(unnamed.ok === false && unnamed.code, 'invalid');
  assert.equal(both.requests.length, 2);
});

test('rt315: an operation nobody serves stays not_found with or without targetModuleId; a single route answers when it is the named one', async () => {
  const one = harness({ served: index({ 'cm.sendChannelMessage': [{ moduleId: 'telegram', route: 'telegram.channel.send' }] }) });
  assert.equal((await one.serve({ ...call('sendChannelMessage'), targetModuleId: 'telegram' } as never)).ok, true);
  assert.equal((await one.serve(call('sendChannelMessage') as never)).ok, true);
  const none = harness({ served: index({}) });
  const result = await none.serve({ ...call('sendChannelMessage'), targetModuleId: 'telegram' } as never);
  assert.equal(result.ok === false && result.code, 'not_found');
});

// rt319: a system a module declared (not in the platform catalogs) is served through the catalog of the module the delivery names.
const moduleSystem: ConnectionCatalog = {
  schemaVersion: 'connection-catalog-v1',
  connectionId: 'chat',
  title: 'Chat',
  description: 'Declared by a module.',
  operations: [{ operationId: 'arrived', direction: 'serve', kind: 'command', description: 'In.', inputType: 'In', outputType: 'Out', reply: 'now' }],
};
const chatServed = index({ 'chat.arrived': [{ moduleId: 'modX', route: 'modX.chat.arrived' }] });
const chatCall = (extra: Record<string, unknown> = {}) => ({
  connectionId: 'chat', operationId: 'arrived', input: { n: 1 }, context: { organizationId: 'org-1', hookParams: { b: '7' } }, ...extra,
});

test('rt319: a module system with targetModuleId runs the route of the module, with the hookParams intact', async () => {
  const asked: Array<[string, string]> = [];
  const h = harness({ served: chatServed, moduleCatalogOf: async (id, moduleId) => { asked.push([id, moduleId]); return moduleId === 'modX' ? moduleSystem : undefined; } });
  const result = await h.serve(chatCall({ targetModuleId: 'modX' }));
  assert.equal(result.ok, true);
  assert.deepEqual(asked, [['chat', 'modX']]);
  assert.equal(h.requests[0].request.routine, 'modX.chat.arrived');
  assert.deepEqual(h.requests[0].request.meta?.connection?.context, { organizationId: 'org-1', hookParams: { b: '7' } });
});

test('rt319: without targetModuleId, or in a module that does not declare it, the operation is unknown; a catalog that throws is unavailable', async () => {
  const moduleCatalogOf = async (_id: string, moduleId: string) => (moduleId === 'modX' ? moduleSystem : undefined);
  const none = harness({ served: chatServed, moduleCatalogOf });
  const noTarget = await none.serve(chatCall());
  assert.equal(noTarget.ok === false && noTarget.code, 'invalid');
  const other = await none.serve(chatCall({ targetModuleId: 'modY' }));
  assert.equal(other.ok === false && other.code, 'invalid');
  assert.match(none.logs.join('\n'), /reason=unknown-operation/);
  assert.equal(none.requests.length, 0);
  const throwing = harness({ served: chatServed, moduleCatalogOf: async () => { throw new Error('boom'); } });
  const result = await throwing.serve(chatCall({ targetModuleId: 'modX' }));
  assert.equal(result.ok === false && result.code, 'unavailable');
  assert.equal(throwing.requests.length, 0);
});

test('rt319: the catalog of the platform wins over the one of a module', async () => {
  const h = harness({ moduleCatalogOf: async () => { throw new Error('must not be asked'); } });
  const result = await h.serve(call('describe', CONTEXT, { targetModuleId: 'modA' }));
  assert.equal(result.ok, true);
});
