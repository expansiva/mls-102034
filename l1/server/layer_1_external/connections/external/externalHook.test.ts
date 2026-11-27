/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/externalHook.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it, mock } from 'node:test';
import Fastify from 'fastify';
import type { ConnectionCatalog } from '/_102034_/l2/shared/contracts/connections/types.js';
import type { BffResponse } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { ExternalCallRow, ExternalNoticeKey } from '/_102034_/l1/server/layer_1_external/connections/external/externalCallStore.js';
import { allowExternalHookRate, DELIVER_MS, handleExternalHook, type ExternalHookDeps } from '/_102034_/l1/server/layer_1_external/connections/external/externalHook.js';
import { releaseDeclarationOf } from '/_102034_/l1/server/layer_1_external/connections/external/productionExternalSender.js';
import type { ExternalSystemDeclaration } from '/_102034_/l2/shared/contracts/connections/externalSystem.js';
import { clientAddress, registerExternalHookRoutes } from '/_102034_/l1/server/layer_1_external/transport/http/externalHookHttp.js';
import { buildServeIndex, createConnectionServer } from '/_102034_/l1/workflow/connectionServe.js';
import type { DefsReader } from '/_102034_/l1/workflow/assistantCatalogDefs.js';

const PROJECT = '900262';
const MODULE = 'exampleModule';
const SYSTEM = 'example';
const SECRET = 'notice-secret';
const WHEN = new Date('2026-11-19T12:00:00.000Z');

const declaration: ExternalSystemDeclaration = {
  schemaVersion: 'external-system-v1',
  systemId: SYSTEM,
  title: 'Example',
  description: 'Hook test declaration.',
  hosts: [{ host: 'example.test' }],
  settings: [{ id: 'signingKey', secret: true }],
  operations: [
    {
      operationId: 'lookup',
      direction: 'call',
      kind: 'query',
      description: 'Look a value up.',
      inputType: 'In',
      outputType: 'Out',
      methods: ['GET'],
      uses: { settings: [], secrets: [] },
      reply: 'now',
    },
    {
      operationId: 'receive',
      direction: 'serve',
      kind: 'command',
      description: 'Accept a notice.',
      inputType: 'In',
      outputType: 'Out',
      verify: {
        scheme: 'hmac',
        algorithm: 'sha256',
        secret: 'signingKey',
        signature: { header: 'x-signature', encoding: 'hex' },
        signed: ['body'],
      },
      noticeId: { header: 'x-notice-id' },
    },
  ],
};

const root = mkdtempSync(path.join(tmpdir(), 'external-hook-'));
const dist = path.join(root, 'dist', 'local', `_${PROJECT}_`, 'l1', MODULE, 'layer_1_external', 'connections');
let previousCwd = '';

function sign(body: Buffer): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

before(() => {
  mkdirSync(dist, { recursive: true });
  writeFileSync(path.join(dist, `${SYSTEM}.js`), `export default ${JSON.stringify(declaration)};\n`);
  const defsDir = path.join(root, 'dist', 'local', `_${PROJECT}_`, 'l1', MODULE, 'layer_2_application', 'requests');
  mkdirSync(defsDir, { recursive: true });
  writeFileSync(path.join(defsDir, 'receive.defs.js'), `export default ${JSON.stringify({
    data: { requests: [{ route: `${MODULE}.receive.accept`, serves: `${SYSTEM}.receive` }] },
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

function catalogOf(system: ExternalSystemDeclaration): ConnectionCatalog {
  return {
    schemaVersion: 'connection-catalog-v1',
    connectionId: system.systemId,
    title: system.title,
    description: system.description,
    operations: system.operations.filter((item) => item.direction === 'serve').map((item) => ({
      operationId: item.operationId,
      direction: 'serve' as const,
      kind: item.kind,
      description: item.description,
      inputType: item.inputType,
      outputType: item.outputType,
      reply: 'now' as const,
    })),
  };
}

describe('external hook', () => {
  it('delivers a signed notice once through the serve route and refuses the rest', async () => {
    const loaded = await releaseDeclarationOf({ projectId: PROJECT, moduleId: MODULE, systemId: SYSTEM });
    assert.ok(loaded);
    const seen = new Set<string>();
    const records: ExternalCallRow[] = [];
    const delivered: string[] = [];
    const targets: Array<string | undefined> = [];
    const projects: string[] = [];
    const reader: DefsReader = {
      list: () => ['receive.defs.js'],
      async read() {
        return {
          data: { requests: [{ route: `${MODULE}.receive.accept`, serves: `${SYSTEM}.receive` }] },
        };
      },
      json: () => undefined,
      text: () => undefined,
    };
    const serve = createConnectionServer({
      catalogOf: async (id) => (id === SYSTEM ? catalogOf(loaded) : undefined),
      index: () => buildServeIndex(reader, [MODULE]),
      execMessage: async (request) => {
        delivered.push(String(request.meta?.userId));
        return { response: { ok: true, data: { accepted: true } } as BffResponse, statusCode: 200 };
      },
      newContext: () => ({}) as never,
      log: () => undefined,
    });
    const deps: ExternalHookDeps = {
      declarationOf: releaseDeclarationOf,
      secretOf: async (_ref, id) => (id === 'signingKey' ? SECRET : null),
      seen: async (notice: ExternalNoticeKey) => {
        if (seen.has(notice.noticeId)) return false;
        seen.add(notice.noticeId);
        return true;
      },
      forget: async (notice) => { seen.delete(notice.noticeId); },
      organizationOf: () => 'org-1',
      record: async (row) => { records.push(row); },
      deliver: (input, projectId) => { targets.push(input.targetModuleId); projects.push(projectId); return serve(input); },
      now: () => WHEN,
      allow: () => true,
      log: () => undefined,
    };
    const app = Fastify({ logger: false });
    registerExternalHookRoutes(app, deps);
    const body = JSON.stringify({ id: 'n-1' });
    const headers = { 'content-type': 'application/json', 'x-signature': sign(Buffer.from(body)), 'x-notice-id': 'n-1' };
    const url = `/hook/${PROJECT}/${MODULE}/${SYSTEM}/receive`;
    const first = await app.inject({ method: 'POST', url, headers, payload: body });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json(), { ok: true });
    assert.deepEqual(delivered, [`connection:${SYSTEM}`]);
    assert.deepEqual(targets, [MODULE], 'the hook names the module of the address (rt319)');
    assert.deepEqual(projects, [PROJECT], 'deliver gets the project of the address, not the organization (rt322)');
    const raw = records[0];
    assert.equal(raw?.outcome, 'accepted');
    assert.equal(JSON.stringify(records).includes(SECRET), false);
    assert.equal(JSON.stringify(records).includes(body), false);

    const again = await app.inject({ method: 'POST', url, headers, payload: body });
    assert.equal(again.statusCode, 200);
    assert.deepEqual(again.json(), { ok: true, message: 'already received' });
    assert.equal(records.at(-1)?.outcome, 'duplicate');
    assert.equal(records.at(-1)?.httpStatus, 200);
    assert.equal(delivered.length, 1);

    const bad = await app.inject({
      method: 'POST',
      url,
      headers: { ...headers, 'x-signature': '00', 'x-notice-id': 'n-2' },
      payload: body,
    });
    assert.equal(bad.statusCode, 401);
    assert.equal(delivered.length, 1);

    const call = await app.inject({
      method: 'POST',
      url: `/hook/${PROJECT}/${MODULE}/${SYSTEM}/lookup`,
      headers,
      payload: body,
    });
    assert.equal(call.statusCode, 404);
    await app.close();
  });

  it('a notice identified by a number (the update_id of the Telegram) is delivered once and refused on repeat', async () => {
    const byPointer: ExternalSystemDeclaration = {
      ...declaration,
      operations: declaration.operations.map((item) => item.operationId === 'receive'
        ? { ...item, noticeId: { jsonPointer: '/update_id' } }
        : item),
    };
    const seen = new Set<string>();
    const keys: Array<string | undefined> = [];
    const deps: ExternalHookDeps = {
      declarationOf: async () => byPointer,
      secretOf: async () => SECRET,
      seen: async (notice) => (seen.has(notice.noticeId) ? false : (seen.add(notice.noticeId), true)),
      forget: async (notice) => { seen.delete(notice.noticeId); },
      organizationOf: () => 'org-1',
      record: async () => undefined,
      deliver: async (input) => { keys.push(input.idempotencyKey); return { ok: true, output: {} }; },
      now: () => WHEN,
      allow: () => true,
      log: () => undefined,
    };
    const target = { projectId: PROJECT, moduleId: MODULE, systemId: SYSTEM, operationId: 'receive' };
    const send = (json: string) => {
      const body = Buffer.from(json);
      return handleExternalHook({ target, rawBody: body, headers: { 'x-signature': sign(body) }, remoteAddress: '1.2.3.4' }, deps);
    };
    assert.equal((await send('{"update_id": 123}')).status, 200);
    assert.deepEqual(keys, ['123']);
    assert.equal((await send('{"update_id": 123}')).status, 200);
    assert.equal(keys.length, 1);
    assert.equal((await send('{"update_id": 1.5}')).status, 401);
    assert.equal((await send('{"update_id": true}')).status, 401);
    assert.equal((await send('{"update_id": null}')).status, 401);
    assert.equal((await send('{"update_id": ""}')).status, 401);
    assert.equal(keys.length, 1);
  });

  it('the arrival waits 60 s for the route: a route that answers in 30 s is delivered, one that never answers gives the timeout', async () => {
    assert.equal(DELIVER_MS, 60_000);
    const outcomes: string[] = [];
    const forgotten: string[] = [];
    const make = (deliver: ExternalHookDeps['deliver']): ExternalHookDeps => ({
      declarationOf: async () => declaration,
      secretOf: async () => SECRET,
      seen: async () => true,
      forget: async (notice) => { forgotten.push(notice.noticeId); },
      organizationOf: () => 'org-1',
      record: async (row) => { outcomes.push(row.outcome); },
      deliver,
      now: () => WHEN,
      allow: () => true,
      log: () => undefined,
    });
    const target = { projectId: PROJECT, moduleId: MODULE, systemId: SYSTEM, operationId: 'receive' };
    const body = Buffer.from('{"id":"n-30"}');
    const request = { target, rawBody: body, headers: { 'x-signature': sign(body), 'x-notice-id': 'n-30' }, remoteAddress: '1.2.3.4' };
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const slow = handleExternalHook(request, make(() => new Promise((resolve) => {
        setTimeout(() => resolve({ ok: true, output: {} }), 30_000);
      })));
      await new Promise((resolve) => setImmediate(resolve));
      mock.timers.tick(30_000);
      assert.equal((await slow).status, 200);
      assert.equal(outcomes.at(-1), 'accepted');

      const never = handleExternalHook(request, make(() => new Promise(() => undefined)));
      await new Promise((resolve) => setImmediate(resolve));
      mock.timers.tick(59_999);
      mock.timers.tick(1);
      const late = await never;
      assert.equal(late.status, 503);
      assert.equal(outcomes.at(-1), 'timeout');
      assert.deepEqual(forgotten, ['n-30']);
    } finally {
      mock.timers.reset();
    }
  });

  it('one query parameter of the address reaches the route, tells the senders apart, and any other query is refused', async () => {
    const seen = new Set<string>();
    const delivered: Array<{ hookParams: Record<string, string> | undefined; key: string | undefined }> = [];
    const rateKeys: string[] = [];
    const deps: ExternalHookDeps = {
      declarationOf: async () => declaration,
      secretOf: async () => SECRET,
      seen: async (notice) => (seen.has(notice.noticeId) ? false : (seen.add(notice.noticeId), true)),
      forget: async (notice) => { seen.delete(notice.noticeId); },
      organizationOf: () => 'org-1',
      record: async () => undefined,
      deliver: async (input) => { delivered.push({ hookParams: input.context.hookParams, key: input.idempotencyKey }); return { ok: true, output: {} }; },
      now: () => WHEN,
      allow: (key) => { rateKeys.push(key); return true; },
      log: () => undefined,
    };
    const target = { projectId: PROJECT, moduleId: MODULE, systemId: SYSTEM, operationId: 'receive' };
    const send = (query: Record<string, unknown> | undefined) => {
      const body = Buffer.from('{"update_id":7}');
      return handleExternalHook({
        target, rawBody: body, headers: { 'x-signature': sign(body), 'x-notice-id': '7' }, remoteAddress: '1.2.3.4', ...(query ? { query } : {}),
      }, deps);
    };
    // (1) the parameter reaches the route
    assert.equal((await send({ robo: 'a' })).status, 200);
    assert.deepEqual(delivered[0].hookParams, { robo: 'a' });
    // (2) the same notice id on two bots is two notices; on the same bot it is a repeat
    assert.equal((await send({ robo: 'b' })).status, 200);
    assert.equal(delivered.length, 2);
    assert.notEqual(delivered[0].key, delivered[1].key);
    assert.equal((await send({ robo: 'a' })).status, 200);
    assert.equal(delivered.length, 2);
    // (3) two parameters, or a value or a name out of the form, are 400 and never reach the route
    for (const bad of [{ robo: 'a', other: 'b' }, { robo: 'a b' }, { robo: '' }, { robo: ['a', 'b'] }, { 'ro bo': 'a' }, { robo: 'x'.repeat(65) }]) {
      assert.equal((await send(bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal(delivered.length, 2);
    // (4) without a parameter the keys are the ones of today
    seen.clear();
    delivered.length = 0;
    rateKeys.length = 0;
    assert.equal((await send(undefined)).status, 200);
    assert.equal((await send({})).status, 200);
    assert.deepEqual(delivered, [{ hookParams: undefined, key: '7' }]);
    assert.deepEqual([...seen], ['7']);
    assert.equal(rateKeys[0], `1.2.3.4\0${PROJECT}/${MODULE}/${SYSTEM}/receive`);
  });

  it('the address query is read by the transport: ?robo=a arrives as the parameter, a second one is a 400', async () => {
    const got: Array<Record<string, string> | undefined> = [];
    const deps: ExternalHookDeps = {
      declarationOf: async () => declaration,
      secretOf: async () => SECRET,
      seen: async () => true,
      forget: async () => undefined,
      organizationOf: () => 'org-1',
      record: async () => undefined,
      deliver: async (input) => { got.push(input.context.hookParams); return { ok: true, output: {} }; },
      now: () => WHEN,
      allow: () => true,
      log: () => undefined,
    };
    const app = Fastify({ logger: false });
    registerExternalHookRoutes(app, deps);
    const body = JSON.stringify({ id: 'q-1' });
    const headers = { 'content-type': 'application/json', 'x-signature': sign(Buffer.from(body)), 'x-notice-id': 'q-1' };
    const base = `/hook/${PROJECT}/${MODULE}/${SYSTEM}/receive`;
    assert.equal((await app.inject({ method: 'POST', url: `${base}?robo=a`, headers, payload: body })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: `${base}?robo=a&x=1`, headers, payload: body })).statusCode, 400);
    assert.deepEqual(got, [{ robo: 'a' }]);
    await app.close();
  });

  it('logs once when the serve operation has no noticeId', async () => {
    const lines: string[] = [];
    const open: ExternalSystemDeclaration = {
      ...declaration,
      operations: declaration.operations.map((item) => item.operationId === 'receive'
        ? { ...item, noticeId: undefined }
        : item),
    };
    const deps: ExternalHookDeps = {
      declarationOf: async () => open,
      secretOf: async () => SECRET,
      seen: async () => true,
      forget: async () => undefined,
      organizationOf: () => 'org-1',
      record: async () => undefined,
      deliver: async () => ({ ok: true, output: {} }),
      now: () => WHEN,
      allow: () => true,
      log: (line) => lines.push(line),
    };
    const body = Buffer.from('{}');
    const headers = { 'x-signature': sign(body) };
    const target = { projectId: PROJECT, moduleId: MODULE, systemId: SYSTEM, operationId: 'receive' };
    await handleExternalHook({ target, rawBody: body, headers, remoteAddress: '127.0.0.1' }, deps);
    await handleExternalHook({ target, rawBody: body, headers, remoteAddress: '127.0.0.1' }, deps);
    assert.equal(lines.length, 1);
  });

  it('a delivery that fails gives the notice back, so the sender retry is delivered', async () => {
    const seen = new Set<string>();
    let attempts = 0;
    const deps: ExternalHookDeps = {
      declarationOf: async () => declaration,
      secretOf: async () => SECRET,
      seen: async (notice) => (seen.has(notice.noticeId) ? false : (seen.add(notice.noticeId), true)),
      forget: async (notice) => { seen.delete(notice.noticeId); },
      organizationOf: () => 'org-1',
      record: async () => undefined,
      deliver: async () => {
        attempts += 1;
        return attempts === 1 ? { ok: false, code: 'unavailable', message: 'down' } : { ok: true, output: {} };
      },
      now: () => WHEN,
      allow: () => true,
      log: () => undefined,
    };
    const body = Buffer.from('{"id":"n-9"}');
    const headers = { 'x-signature': sign(body), 'x-notice-id': 'n-9' };
    const target = { projectId: PROJECT, moduleId: MODULE, systemId: SYSTEM, operationId: 'receive' };
    const first = await handleExternalHook({ target, rawBody: body, headers, remoteAddress: '1.2.3.4' }, deps);
    assert.equal(first.status, 503);
    const retry = await handleExternalHook({ target, rawBody: body, headers, remoteAddress: '1.2.3.4' }, deps);
    assert.equal(retry.status, 200);
    const third = await handleExternalHook({ target, rawBody: body, headers, remoteAddress: '1.2.3.4' }, deps);
    assert.equal(third.status, 200);
    assert.deepEqual(third.body, { ok: true, message: 'already received' });
    assert.equal(attempts, 2);
  });

  it('delivers in the organization of the app, and answers 503 when the app has none', async () => {
    const orgs: string[] = [];
    const base: ExternalHookDeps = {
      declarationOf: async () => declaration,
      secretOf: async () => SECRET,
      seen: async () => true,
      forget: async () => undefined,
      organizationOf: () => 'org-77',
      record: async () => undefined,
      deliver: async (input) => { orgs.push(input.context.organizationId); return { ok: true, output: {} }; },
      now: () => WHEN,
      allow: () => true,
      log: () => undefined,
    };
    const body = Buffer.from('{"id":"n-10"}');
    const headers = { 'x-signature': sign(body), 'x-notice-id': 'n-10' };
    const target = { projectId: PROJECT, moduleId: MODULE, systemId: SYSTEM, operationId: 'receive' };
    assert.equal((await handleExternalHook({ target, rawBody: body, headers, remoteAddress: '1.2.3.4' }, base)).status, 200);
    assert.deepEqual(orgs, ['org-77']);
    const none = await handleExternalHook({ target, rawBody: body, headers, remoteAddress: '1.2.3.4' }, { ...base, organizationOf: () => undefined });
    assert.equal(none.status, 503);
  });

  it('the rate map is bounded and the caller address comes from the last X-Forwarded-For hop behind the proxy', () => {
    assert.equal(clientAddress('127.0.0.1', '6.6.6.6, 203.0.113.9'), '203.0.113.9');
    assert.equal(clientAddress('127.0.0.1', undefined), '127.0.0.1');
    assert.equal(clientAddress('198.51.100.7', '6.6.6.6'), '198.51.100.7'); // not from a local proxy: the header is ignored
    assert.equal(clientAddress('127.0.0.1', 'not an ip'), '127.0.0.1');
    let allowed = 0;
    for (let index = 0; index < 10_200; index += 1) {
      if (allowExternalHookRate(`bound-${index}`, 1_000)) allowed += 1;
    }
    assert.ok(allowed <= 10_000);
  });

  it('rt323: a deliver that throws registers its stack and the answer stays 503', async () => {
    const lines: string[] = [];
    const deps: ExternalHookDeps = {
      declarationOf: async () => declaration,
      secretOf: async () => SECRET,
      seen: async () => true,
      forget: async () => undefined,
      organizationOf: () => 'org-1',
      record: async () => undefined,
      deliver: async () => { throw new Error('deliver blew up'); },
      now: () => WHEN,
      allow: () => true,
      log: (line) => lines.push(line),
    };
    const body = Buffer.from('{"id":"n-10"}');
    const target = { projectId: PROJECT, moduleId: MODULE, systemId: SYSTEM, operationId: 'receive' };
    const result = await handleExternalHook({ target, rawBody: body, headers: { 'x-signature': sign(body), 'x-notice-id': 'n-10' }, remoteAddress: '1.2.3.4' }, deps);
    assert.equal(result.status, 503);
    const failed = lines.find((line) => line.includes('hook deliver failed'));
    assert.ok(failed && /Error: deliver blew up\n\s+at /u.test(failed), failed);
  });
});
