/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/externalHookModuleSystem.test.ts" enhancement="_blank"/>
// rt319 s2: the arrival at the hook of a system a MODULE declared (the shape of the `telegram` of mls-102047), end to end:
// the real Fastify handler, the real declaration loader, the real serve index (read from the defs in the release folder) and the real
// `createConnectionServer`, wired to the module catalogs the way `assistantRuntime` wires them. Only `execMessage` is a double.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import Fastify from 'fastify';
import type { BffRequest, BffResponse } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { ExternalCallRow, ExternalNoticeKey } from '/_102034_/l1/server/layer_1_external/connections/external/externalCallStore.js';
import type { ExternalHookDeps } from '/_102034_/l1/server/layer_1_external/connections/external/externalHook.js';
import { releaseDeclarationOf } from '/_102034_/l1/server/layer_1_external/connections/external/productionExternalSender.js';
import { catalogOfDeclaration } from '/_102034_/l1/server/layer_1_external/connections/moduleSystemsIndex.js';
import { connectionCatalogs } from '/_102034_/l1/server/layer_1_external/connections/connectionCatalogs.js';
import { registerExternalHookRoutes } from '/_102034_/l1/server/layer_1_external/transport/http/externalHookHttp.js';
import { distDefsReader } from '/_102034_/l1/workflow/assistantCatalogDefs.js';
import { buildServeIndex, createConnectionServer } from '/_102034_/l1/workflow/connectionServe.js';

const PROJECT = '900282';
const MODULE = 'telegram';
const SYSTEM = 'telegram';
const SECRET = 'incoming-secret-123';
const ROUTE = 'telegram.telegram.messageArrived';
const root = mkdtempSync(path.join(tmpdir(), 'hook-module-system-'));
let previousCwd = '';

const declaration = {
  schemaVersion: 'external-system-v1',
  systemId: SYSTEM,
  title: 'Telegram',
  description: 'Messaging service.',
  hosts: [{ host: 'api.telegram.org' }],
  settings: [{ id: 'incomingMessageSecret', secret: true }],
  operations: [{
    operationId: 'messageArrived',
    direction: 'serve',
    kind: 'command',
    description: 'A message arrived.',
    inputType: 'MessageArrivedInput',
    outputType: 'MessageArrivedOutput',
    verify: { scheme: 'token', secret: 'incomingMessageSecret', header: 'X-Telegram-Bot-Api-Secret-Token' },
    noticeId: { jsonPointer: '/update_id' },
  }],
};

before(() => {
  const dist = path.join(root, 'dist', 'local', `_${PROJECT}_`, 'l1', MODULE);
  mkdirSync(path.join(dist, 'layer_1_external', 'connections'), { recursive: true });
  mkdirSync(path.join(dist, 'layer_2_application', 'requests'), { recursive: true });
  writeFileSync(path.join(dist, 'layer_1_external', 'connections', `${SYSTEM}.js`), `export default ${JSON.stringify(declaration)};\n`);
  writeFileSync(path.join(dist, 'layer_2_application', 'requests', 'telegram.defs.js'), `export const definition = ${JSON.stringify({
    data: { requests: [{ route: ROUTE, kind: 'cmd', serves: `${SYSTEM}.messageArrived` }] },
  })};\n`);
  writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    defaultProjectId: PROJECT,
    projects: {
      [PROJECT]: { root: '.', type: 'client' },
      '102033': { root: '.', type: 'master frontend' },
      '102034': { root: '.', type: 'master backend' },
    },
  }));
  previousCwd = process.cwd();
  process.chdir(root);
});

after(() => {
  process.chdir(previousCwd);
  rmSync(root, { recursive: true, force: true });
});

function build(execMessage: (request: BffRequest) => Promise<{ response: BffResponse; statusCode: number }>) {
  const seen = new Set<string>();
  const forgotten: string[] = [];
  const records: ExternalCallRow[] = [];
  const serve = createConnectionServer({
    catalogOf: connectionCatalogs(),
    moduleCatalogOf: async (connectionId, moduleId) => {
      const loaded = await releaseDeclarationOf({ projectId: PROJECT, moduleId, systemId: connectionId });
      return loaded ? catalogOfDeclaration(loaded) : undefined;
    },
    index: () => buildServeIndex(distDefsReader(PROJECT), [MODULE]),
    execMessage,
    newContext: () => ({}) as never,
    log: () => undefined,
  });
  const deps: ExternalHookDeps = {
    declarationOf: releaseDeclarationOf,
    secretOf: async (_ref, id) => (id === 'incomingMessageSecret' ? SECRET : null),
    seen: async (notice: ExternalNoticeKey) => {
      if (seen.has(notice.noticeId)) return false;
      seen.add(notice.noticeId);
      return true;
    },
    forget: async (notice) => { forgotten.push(notice.noticeId); seen.delete(notice.noticeId); },
    organizationOf: () => 'org-1',
    record: async (row) => { records.push(row); },
    deliver: (input) => serve(input),
    now: () => new Date('2026-11-26T12:00:00.000Z'),
    allow: () => true,
    log: () => undefined,
  };
  const app = Fastify({ logger: false });
  registerExternalHookRoutes(app, deps);
  return { app, forgotten, records };
}

const url = `/hook/${PROJECT}/${MODULE}/${SYSTEM}/messageArrived?b=bot-7`;
const payload = JSON.stringify({ update_id: 4242, message: { message_id: 1, date: 1, chat: { id: 5, type: 'private' }, from: { id: 5 }, text: 'oi' } });
const headers = (secret = SECRET) => ({ 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret });

describe('rt319 s2: arrival at the hook of a system declared by a module', () => {
  it('200: the route of the module runs under connection:<system>, with the hookParams and the idempotency key', async () => {
    const requests: BffRequest[] = [];
    const { app } = build(async (request) => {
      requests.push(request);
      return { response: { ok: true, data: {} } as BffResponse, statusCode: 200 };
    });
    const response = await app.inject({ method: 'POST', url, headers: headers(), payload });
    assert.equal(response.statusCode, 200);
    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request?.routine, ROUTE);
    assert.deepEqual(request?.meta?.connection?.context.hookParams, { b: 'bot-7' });
    assert.equal(typeof request?.meta?.connection?.idempotencyKey, 'string');
    assert.deepEqual(request?.meta?.verifiedAuthorities, [`${MODULE}:connection:${SYSTEM}`], 'the authorize of the route accepts it: it ends with the actorRef of grant connection_telegram');
    await app.close();
  });

  it('rt330: a route that answers 422 (refused) is a 200 `refused`: the notice is kept, the record says refused, and the same notice again is a duplicate', async () => {
    let calls = 0;
    const { app, forgotten, records } = build(async () => {
      calls += 1;
      return { response: { ok: false, data: null, error: { code: 'CM_REFUSED', message: 'blocked' } } as BffResponse, statusCode: 422 };
    });
    const first = await app.inject({ method: 'POST', url, headers: headers(), payload });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(JSON.parse(first.body), { ok: true, message: 'refused' });
    assert.equal(records.at(-1)?.outcome, 'refused');
    assert.match(records.at(-1)?.denialReason ?? '', /^refused: blocked$/u);
    assert.deepEqual(forgotten, [], 'the notice stays seen');
    const again = await app.inject({ method: 'POST', url, headers: headers(), payload });
    assert.equal(again.statusCode, 200);
    assert.deepEqual(JSON.parse(again.body), { ok: true, message: 'already received' });
    assert.equal(calls, 1, 'the route is not asked again');
    await app.close();
  });

  it('503 when the route fails: the notice is given back and, sent again, it is delivered again (not duplicate)', async () => {
    let fail = true;
    const calls: string[] = [];
    const { app, forgotten } = build(async (request) => {
      calls.push(request.routine);
      if (fail) throw new Error('route down');
      return { response: { ok: true, data: {} } as BffResponse, statusCode: 200 };
    });
    const first = await app.inject({ method: 'POST', url, headers: headers(), payload });
    assert.equal(first.statusCode, 503);
    assert.deepEqual(forgotten, ['4242?b=bot-7'], 'the key the notice was recorded with: id and bot parameter');
    fail = false;
    const again = await app.inject({ method: 'POST', url, headers: headers(), payload });
    assert.equal(again.statusCode, 200);
    assert.notDeepEqual(again.json(), { ok: true, message: 'already received' });
    assert.equal(calls.length, 2);
    await app.close();
  });

  it('401 with the wrong secret, and the route is not called', async () => {
    const calls: string[] = [];
    const { app } = build(async (request) => {
      calls.push(request.routine);
      return { response: { ok: true, data: {} } as BffResponse, statusCode: 200 };
    });
    const response = await app.inject({ method: 'POST', url, headers: headers('wrong-secret'), payload });
    assert.equal(response.statusCode, 401);
    assert.equal(calls.length, 0);
    await app.close();
  });
});
