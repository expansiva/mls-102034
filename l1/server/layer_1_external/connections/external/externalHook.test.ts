/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/externalHook.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import Fastify from 'fastify';
import type { ConnectionCatalog } from '/_102034_/l1/server/layer_1_external/connections/catalogs/types.js';
import type { BffResponse } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { ExternalCallRow, ExternalNoticeKey } from '/_102034_/l1/server/layer_1_external/connections/external/externalCallStore.js';
import { allowExternalHookRate, handleExternalHook, type ExternalHookDeps } from '/_102034_/l1/server/layer_1_external/connections/external/externalHook.js';
import { releaseDeclarationOf } from '/_102034_/l1/server/layer_1_external/connections/external/productionExternalSender.js';
import type { ExternalSystemDeclaration } from '/_102034_/l1/server/layer_1_external/connections/external/types.js';
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
      deliver: (input) => serve(input),
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
    const raw = records[0];
    assert.equal(raw?.outcome, 'accepted');
    assert.equal(JSON.stringify(records).includes(SECRET), false);
    assert.equal(JSON.stringify(records).includes(body), false);

    const again = await app.inject({ method: 'POST', url, headers, payload: body });
    assert.equal(again.statusCode, 409);
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
    assert.equal(third.status, 409);
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
});
