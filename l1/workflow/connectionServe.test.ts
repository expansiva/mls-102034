/// <mls fileReference="_102034_/l1/workflow/connectionServe.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test from 'node:test';
import type { BffRequest, BffResponse, RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { DefsReader } from '/_102034_/l1/workflow/assistantCatalogDefs.js';
import { buildServeIndex, createConnectionServer, type ConnectionServerDeps, type ServeIndex } from '/_102034_/l1/workflow/connectionServe.js';
import { exampleCatalog } from '/_102034_/testing/connections/connectionFixtures.js';
import { createGeneratedRoute } from '/_102034_/testing/connections/generatedRoute.js';
import cm from '/_102034_/l4/ontology/connections/cm.defs.js';
import type { ConnectionCatalog, ConnectionContext } from '/_102034_/l4/ontology/connections/types.defs.js';

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
