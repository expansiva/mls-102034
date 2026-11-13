/// <mls fileReference="_102034_/l1/workflow/assistantExec.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError, type BffRequest, type BffResponse, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { getMdmKv, putMdmKv, reserveMdmKv } from '/_102034_/l1/mdm/layer_3_usecases/kvUsecases.js';
import { createAssistantCatalogSource, ASSISTANT_CATALOG_SCHEMA, type AssistantCatalogItem } from '/_102034_/l1/workflow/assistantCatalog.js';
import { execAssistantAction, mapBffResult, type AssistantExecDeps, type AssistantExecInput } from '/_102034_/l1/workflow/assistantExec.js';

function item(actionId: string, kind: 'cmd' | 'qry', actors: string[], assistant: 'included' | 'excluded' = 'included'): AssistantCatalogItem {
  return { route: `modA.page.${actionId}`, routes: [`modA.page.${actionId}`], kind, actionId, title: actionId, actors, assistant };
}

const CATALOG = {
  schemaVersion: ASSISTANT_CATALOG_SCHEMA, module: 'modA', lookups: [], entities: [], issues: [],
  commands: [item('modA.accept', 'cmd', ['boss'])],
  queries: [item('modA.list', 'qry', ['boss', 'worker']), item('modA.hidden', 'qry', ['boss'], 'excluded')],
};

interface Calls { requests: BffRequest[] }

function setup(answer: (request: BffRequest) => { response: BffResponse; statusCode: number } | Promise<{ response: BffResponse; statusCode: number }> = () => ({ response: { ok: true, data: { rows: 2 }, error: null }, statusCode: 200 }), extra: Partial<AssistantExecDeps> = {}): { ctx: RequestContext; deps: AssistantExecDeps; calls: Calls } {
  const ctx = createRequestContext(createMemoryDataRuntime());
  const calls: Calls = { requests: [] };
  const deps: AssistantExecDeps = {
    projectId: '102047',
    modules: [{ moduleId: 'modA' }, { moduleId: 'modB' }],
    identities: { toMdmId: async (_c, cmUserId) => { if (cmUserId === 'cm-1') return 'person-1'; if (cmUserId === 'cm-2') return 'person-2'; throw new AppError('WORKFLOW_IDENTITY_UNLINKED', 'u', 409); } },
    withAlpha: async (meta) => meta,
    catalogs: createAssistantCatalogSource({ projectId: '102047', releaseId: () => 'r1', importCatalog: async (moduleId) => (moduleId === 'modA' ? CATALOG : undefined) }),
    loginEmailOf: async (_c, id) => (id === 'person-1' ? 'ana@example.test' : id === 'person-2' ? 'bia@example.test' : null),
    execMessage: async (request) => { calls.requests.push(request); return answer(request); },
    kv: { reserve: reserveMdmKv, put: putMdmKv },
    ...extra,
  };
  return { ctx, deps, calls };
}

const input = (over: Partial<AssistantExecInput> = {}, authorities = ['modA:worker']): AssistantExecInput => ({
  onBehalfOf: { cmUserId: 'cm-1', authorities, snapshotAt: '2026-11-13T10:00:00.000Z', via: 'nora' },
  actionId: 'modA.list', input: { page: 1 }, commandId: 'cmd-1', ...over,
});

test('a query runs as the person, with the login e-mail and the module authorities, and answers done', async () => {
  const { ctx, deps, calls } = setup();
  const result = await execAssistantAction(ctx, deps, input({}, ['modA:worker', 'modB:other']));
  assert.deepEqual(result, { outcome: 'done', data: { rows: 2 } });
  assert.equal(calls.requests.length, 1);
  assert.deepEqual(calls.requests[0], {
    routine: 'modA.page.modA.list',
    params: { page: 1 },
    meta: { requestId: 'cmd-1', verifiedEmail: 'ana@example.test', userId: 'ana@example.test', actorScope: ['modA:worker'] },
  });
  const kept = (await getMdmKv(ctx, { key: 'assistant:cmd-1' }))?.value as Record<string, unknown>;
  assert.equal(kept.state, 'done');
  assert.equal(kept.outcome, 'done');
});

test('repeating the commandId returns the kept result and the operation runs once', async () => {
  const { ctx, deps, calls } = setup();
  const first = await execAssistantAction(ctx, deps, input());
  const again = await execAssistantAction(ctx, deps, input());
  assert.deepEqual(again, first);
  assert.equal(calls.requests.length, 1);
});

test('two requests at once with one commandId run the operation once', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { ctx, deps, calls } = setup(async () => { await gate; return { response: { ok: true, data: { n: 1 }, error: null }, statusCode: 200 }; });
  const a = execAssistantAction(ctx, deps, input());
  const b = execAssistantAction(ctx, deps, input());
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const [first, second] = await Promise.all([a, b]);
  assert.equal(calls.requests.length, 1);
  assert.equal([first, second].filter((result) => result.outcome === 'done').length, 1);
  const other = [first, second].find((result) => result.outcome !== 'done')!;
  assert.equal(other.outcome, 'unavailable');
  assert.equal(other.error?.code, 'ASSISTANT_COMMAND_UNRESOLVED');
});

test('a command is refused before anything is reserved or run', async () => {
  const { ctx, deps, calls } = setup();
  const result = await execAssistantAction(ctx, deps, input({ actionId: 'modA.accept' }, ['modA:boss']));
  assert.deepEqual(result, { outcome: 'invalid_input', error: { code: 'ASSISTANT_COMMAND_NOT_YET', message: 'commands arrive in R3' } });
  assert.equal(calls.requests.length, 0);
  assert.equal(await getMdmKv(ctx, { key: 'assistant:cmd-1' }), null);
});

test('without authority in the module and alpha off it is forbidden with the required actors; alpha on lets it through', async () => {
  const { ctx, deps, calls } = setup();
  const denied = await execAssistantAction(ctx, deps, input({}, ['modB:worker']));
  assert.equal(denied.outcome, 'forbidden');
  assert.deepEqual(denied.error?.required, ['boss', 'worker']);
  assert.equal(calls.requests.length, 0);
  assert.equal(await getMdmKv(ctx, { key: 'assistant:cmd-1' }), null);
  const alpha = setup(undefined, { withAlpha: async (meta, moduleId) => ({ ...meta, verifiedAuthorities: [...(meta?.verifiedAuthorities ?? []), `${moduleId}:worker`] }) });
  assert.equal((await execAssistantAction(alpha.ctx, alpha.deps, input({}, []))).outcome, 'done');
});

test('a person without a link is no_person; an unknown, excluded or catalog-less action is invalid_input or unavailable', async () => {
  const { ctx, deps } = setup();
  assert.deepEqual(await execAssistantAction(ctx, deps, { ...input(), onBehalfOf: { ...input().onBehalfOf, cmUserId: 'cm-unknown' } }), { outcome: 'no_person' });
  assert.equal((await execAssistantAction(ctx, deps, input({ actionId: 'modA.nothing' }))).error?.code, 'ASSISTANT_CATALOG_UNAVAILABLE');
  const only = setup(undefined, { modules: [{ moduleId: 'modA' }] });
  assert.equal((await execAssistantAction(only.ctx, only.deps, input({ actionId: 'modA.nothing' }))).error?.code, 'ASSISTANT_ACTION_UNKNOWN');
  assert.equal((await execAssistantAction(only.ctx, only.deps, input({ actionId: 'modA.hidden' }, ['modA:boss']))).error?.code, 'ASSISTANT_ACTION_EXCLUDED');
  const noLogin = setup(undefined, { modules: [{ moduleId: 'modA' }], loginEmailOf: async () => null });
  assert.deepEqual(await execAssistantAction(noLogin.ctx, noLogin.deps, input()), { outcome: 'no_person' });
});

test('the module answers map to the contract: forbidden, not_found, invalid_input, stale_version, refused_rule, unavailable', () => {
  const fail = (code: string, message: string): BffResponse => ({ ok: false, data: null, error: { code, message } });
  const actors = { actors: ['boss'] };
  assert.equal(mapBffResult(fail('FORBIDDEN_ACTOR', 'no'), 403, actors).outcome, 'forbidden');
  assert.deepEqual(mapBffResult(fail('FORBIDDEN_ACTOR', 'no'), 403, actors).error?.required, ['boss']);
  assert.equal(mapBffResult(fail('NOT_FOUND', 'x'), 404, actors).outcome, 'not_found');
  assert.equal(mapBffResult(fail('ROUTINE_NOT_FOUND', 'x'), 404, actors).outcome, 'unavailable');
  assert.equal(mapBffResult(fail('MODULE_NOT_REGISTERED', 'x'), 404, actors).outcome, 'unavailable');
  assert.equal(mapBffResult(fail('VALIDATION_ERROR', 'x'), 400, actors).outcome, 'invalid_input');
  assert.equal(mapBffResult(fail('CONCURRENCY_CONFLICT', 'x'), 409, actors).outcome, 'stale_version');
  const rule = mapBffResult(fail('SOLICITACAO_FECHADA', 'a regra do módulo'), 409, actors);
  assert.deepEqual(rule, { outcome: 'refused_rule', error: { code: 'SOLICITACAO_FECHADA', message: 'a regra do módulo' } });
  const down = mapBffResult(fail('INTERNAL_ERROR', 'secret stack detail'), 500, actors);
  assert.equal(down.outcome, 'unavailable');
  assert.equal(JSON.stringify(down).includes('secret'), false);
});

test('a rule that refuses is kept and returned as refused_rule with the module code; a throw is unavailable and not run again', async () => {
  const refuse = setup(() => ({ response: { ok: false, data: null, error: { code: 'REGRA_X', message: 'não pode' } }, statusCode: 409 }));
  const refused = await execAssistantAction(refuse.ctx, refuse.deps, input());
  assert.deepEqual(refused, { outcome: 'refused_rule', error: { code: 'REGRA_X', message: 'não pode' } });
  assert.deepEqual(await execAssistantAction(refuse.ctx, refuse.deps, input()), refused);
  assert.equal(refuse.calls.requests.length, 1);
  const boom = setup(() => { throw new Error('secret boom'); });
  const down = await execAssistantAction(boom.ctx, boom.deps, input());
  assert.equal(down.outcome, 'unavailable');
  assert.equal(JSON.stringify(down).includes('secret'), false);
  await execAssistantAction(boom.ctx, boom.deps, input());
  assert.equal(boom.calls.requests.length, 1);
});

test('a commandId used by another person or for another action is not answered with that result', async () => {
  const { ctx, deps, calls } = setup();
  await execAssistantAction(ctx, deps, input());
  const other = await execAssistantAction(ctx, deps, { ...input(), onBehalfOf: { ...input().onBehalfOf, cmUserId: 'cm-2' } });
  assert.equal(other.error?.code, 'ASSISTANT_COMMAND_ID_REUSED');
  const sameKeyOtherAction = await execAssistantAction(ctx, deps, input({ actionId: 'modA.hidden' }, ['modA:boss']));
  assert.notEqual(sameKeyOtherAction.outcome, 'done');
  assert.equal(calls.requests.length, 1);
});
