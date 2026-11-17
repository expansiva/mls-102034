/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/callConnection.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createCmTransport, createConnectionCaller, type CallConnection } from '/_102034_/l1/server/layer_1_external/connections/callConnection.js';
import { distConnectionCatalogs } from '/_102034_/l1/server/layer_1_external/connections/connectionCatalogs.js';
import { CONNECTION_CODES, exampleCatalog } from '/_102034_/testing/connections/connectionFixtures.js';
import cm from '/_102034_/l4/ontology/connections/cm.defs.js';
import type { ConnectionCatalog, ConnectionContext } from '/_102034_/l4/ontology/connections/types.defs.js';

const APP = '102077';
const TOKEN = 'sentinel-rt234-token';
const ORG = 'org-rt234';
const CONTEXT: ConnectionContext = { organizationId: ORG, actorUserId: 'cm-user-1' };

type Seen = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

let dir = '';
let savedDir: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rt234-'));
  savedDir = process.env.CBE_PROJECT_FILES_DIR;
  process.env.CBE_PROJECT_FILES_DIR = dir;
  writeFileSync(join(dir, `${APP}.json`), JSON.stringify({
    schema: 1,
    generatedAt: '2026-11-17T00:00:00.000Z',
    org: { orgId: ORG, slug: 'x', name: 'X', createdAt: '2026-11-17T00:00:00.000Z' },
    project: { projectId: APP, domain: 'app.test', appEnv: null, language: null, type: 'app', createdAt: '2026-11-17T00:00:00.000Z' },
    collabMessages: { token: TOKEN },
  }));
});

afterEach(() => {
  if (savedDir === undefined) delete process.env.CBE_PROJECT_FILES_DIR;
  else process.env.CBE_PROJECT_FILES_DIR = savedDir;
  rmSync(dir, { recursive: true, force: true });
});

/** The cm behind a fake fetch: `answer` decides the response of each request. */
function fakeCm(answer: (seen: Seen) => { status?: number; body?: unknown; raw?: string; hang?: boolean }) {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string; signal: AbortSignal }) => {
    const request: Seen = { url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> };
    seen.push(request);
    const reply = answer(request);
    if (reply.hang) {
      return await new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      });
    }
    return new Response(reply.raw ?? JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

function callerOver(fetchImpl: typeof fetch, extra: { catalog?: ConnectionCatalog; toCmUserId?: (mdmId: string) => Promise<string>; defaultTimeoutMs?: number; log?: (line: string) => void } = {}): CallConnection {
  const catalogs: Record<string, ConnectionCatalog> = { cm, example: exampleCatalog };
  if (extra.catalog) catalogs[extra.catalog.connectionId] = extra.catalog;
  return createConnectionCaller({
    catalogOf: async (id) => catalogs[id],
    transports: {
      cm: createCmTransport({ projectId: APP, env: { MSG_PROXY_TARGET: 'http://cm.test' }, fetchImpl }),
      example: createCmTransport({ projectId: APP, env: { MSG_PROXY_TARGET: 'http://cm.test' }, fetchImpl }),
    },
    toCmUserId: extra.toCmUserId,
    defaultTimeoutMs: extra.defaultTimeoutMs,
    log: extra.log ?? (() => undefined),
  });
}

describe('callConnection: the transport to the cm', () => {
  it('posts one connectionCall as the app: token and x-app-id, no x-user-id, the context apart from the input', async () => {
    const { seen, fetchImpl } = fakeCm(() => ({ body: { statusCode: 200, ok: true, output: { agents: [] } } }));
    const result = await callerOver(fetchImpl)('cm', 'listAgents', { includeDrafts: true }, CONTEXT);
    assert.deepEqual(result, { ok: true, output: { agents: [] } });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, 'http://cm.test/msg');
    assert.equal(seen[0].headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(seen[0].headers['x-app-id'], APP);
    assert.equal(seen[0].headers['x-org-id'], ORG);
    assert.equal('x-user-id' in seen[0].headers, false);
    assert.deepEqual(seen[0].body, { action: 'connectionCall', connectionId: 'cm', operationId: 'listAgents', input: { includeDrafts: true }, context: CONTEXT });
  });

  it('passes idempotencyKey (only for a command) and expectVersion', async () => {
    const { seen, fetchImpl } = fakeCm(() => ({ body: { statusCode: 200, ok: true, output: {} } }));
    const call = callerOver(fetchImpl);
    await call('cm', 'updateAgent', { agentId: 'a' }, CONTEXT, { idempotencyKey: 'k-1', expectVersion: 'v7' });
    await call('cm', 'readAgent', { agentId: 'a' }, CONTEXT, { idempotencyKey: 'k-2', expectVersion: 3 });
    assert.equal(seen[0].body.idempotencyKey, 'k-1');
    assert.equal(seen[0].body.expectVersion, 'v7');
    assert.equal('idempotencyKey' in seen[1].body, false, 'a query takes no idempotency key');
    assert.equal(seen[1].body.expectVersion, 3);
  });
});

describe('callConnection: the seven codes', () => {
  for (const code of CONNECTION_CODES) {
    it(`${code}: decided by the code of the body, whatever the HTTP status`, async () => {
      for (const status of [200, 400, 403, 404, 409, 422, 503]) {
        const { fetchImpl } = fakeCm(() => ({ status, body: { statusCode: status, ok: false, code, message: `said ${code}` } }));
        const result = await callerOver(fetchImpl)('cm', 'readAgent', { agentId: 'a' }, CONTEXT);
        assert.deepEqual(result, { ok: false, code, message: `said ${code}` }, `http ${status}`);
      }
    });
  }

  it('an answer outside the envelope is unavailable: not JSON, no ok, an unknown code, a status with no valid body', async () => {
    const bodies: Array<{ status?: number; body?: unknown; raw?: string }> = [
      { raw: 'not json at all' },
      { body: { statusCode: 200 } },
      { body: { statusCode: 200, ok: 'yes' } },
      { body: { statusCode: 200, ok: false, code: 'exploded', message: 'x' } },
      { body: { statusCode: 200, ok: false, code: 'conflict' } },
      { status: 502, raw: '<html>bad gateway</html>' },
      { status: 500, body: { message: 'no envelope' } },
      { status: 302, raw: '' },
    ];
    for (const reply of bodies) {
      const logs: string[] = [];
      const { fetchImpl } = fakeCm(() => reply);
      const result = await callerOver(fetchImpl, { log: (line) => logs.push(line) })('cm', 'readAgent', { agentId: 'a' }, CONTEXT);
      assert.equal(result.ok, false, JSON.stringify(reply));
      if (!result.ok) assert.equal(result.code, 'unavailable', JSON.stringify(reply));
      assert.equal(logs.length, 1);
      assert.match(logs[0], /code=unavailable reason=/);
    }
  });

  it('the cm that does not answer in time is unavailable: the time of the operation, or the default', async () => {
    const quick: ConnectionCatalog = { ...exampleCatalog, operations: exampleCatalog.operations.map((op) => (op.operationId === 'notify' ? { ...op, timeoutMs: 30 } : op)) };
    const { fetchImpl } = fakeCm(() => ({ hang: true }));
    const started = Date.now();
    const byOperation = await callerOver(fetchImpl, { catalog: quick })('example', 'notify', { to: 'x', text: 'y' }, CONTEXT);
    assert.equal(byOperation.ok === false && byOperation.code, 'unavailable');
    assert.ok(Date.now() - started < 1500);
    const byDefault = await callerOver(fetchImpl, { defaultTimeoutMs: 30 })('example', 'lookup', { key: 'k' }, CONTEXT);
    assert.equal(byDefault.ok === false && byDefault.code, 'unavailable');
  });

  it('the cm that cannot be reached is unavailable', async () => {
    const fetchImpl = (async () => { throw new Error('connect ECONNREFUSED'); }) as unknown as typeof fetch;
    const result = await callerOver(fetchImpl)('cm', 'readAgent', { agentId: 'a' }, CONTEXT);
    assert.equal(result.ok === false && result.code, 'unavailable');
  });
});

describe('callConnection: the catalog decides before anything is sent', () => {
  it('an operation that does not exist, a serve operation and an unknown connection are invalid, and the cm is not called', async () => {
    const { seen, fetchImpl } = fakeCm(() => ({ body: { statusCode: 200, ok: true, output: {} } }));
    const call = callerOver(fetchImpl);
    for (const [connectionId, operationId] of [['cm', 'nope'], ['cm', 'describe'], ['cm', 'record'], ['example', 'receive'], ['nowhere', 'x'], ['', 'x'], ['cm', '']]) {
      const result = await call(connectionId, operationId, {}, CONTEXT);
      assert.equal(result.ok === false && result.code, 'invalid', `${connectionId}.${operationId}`);
    }
    assert.equal(seen.length, 0);
  });

  it('a context with no organization is invalid', async () => {
    const { seen, fetchImpl } = fakeCm(() => ({ body: { statusCode: 200, ok: true, output: {} } }));
    const result = await callerOver(fetchImpl)('cm', 'listAgents', {}, { organizationId: '' });
    assert.equal(result.ok === false && result.code, 'invalid');
    assert.equal(seen.length, 0);
  });

  it('a catalog that cannot be read is unavailable, a connection with no transport is unavailable', async () => {
    const broken = createConnectionCaller({ catalogOf: async () => { throw new Error('boom'); }, transports: {}, log: () => undefined });
    assert.equal((await broken('cm', 'listAgents', {}, CONTEXT)).ok, false);
    const noTransport = createConnectionCaller({ catalogOf: async () => cm, transports: {}, log: () => undefined });
    const result = await noTransport('cm', 'listAgents', {}, CONTEXT);
    assert.equal(result.ok === false && result.code, 'unavailable');
  });
});

describe('callConnection: the people', () => {
  const OK = () => ({ body: { statusCode: 200, ok: true, output: {} } });

  it('with actorMdmId and no actorUserId the connector translates by the link, and the mdm id never reaches the cm', async () => {
    const { seen, fetchImpl } = fakeCm(OK);
    const asked: string[] = [];
    const call = callerOver(fetchImpl, { toCmUserId: async (mdmId) => { asked.push(mdmId); return 'cm-user-9'; } });
    const result = await call('cm', 'listAgents', {}, { organizationId: ORG, actorMdmId: 'mdm-5' });
    assert.equal(result.ok, true);
    assert.deepEqual(asked, ['mdm-5']);
    assert.deepEqual(seen[0].body.context, { organizationId: ORG, actorUserId: 'cm-user-9' });
    assert.equal(JSON.stringify(seen[0].body).includes('mdm-5'), false);
  });

  it('with no link the answer is forbidden and the cm is not called', async () => {
    for (const toCmUserId of [async () => { throw new Error('no link'); }, undefined]) {
      const { seen, fetchImpl } = fakeCm(OK);
      const result = await callerOver(fetchImpl, { toCmUserId })('cm', 'listAgents', {}, { organizationId: ORG, actorMdmId: 'mdm-5' });
      assert.equal(result.ok === false && result.code, 'forbidden');
      assert.equal(seen.length, 0);
    }
  });

  it('with actorUserId already there (a context handed on from a serve) it goes as it is, without the mdm id and without asking the link', async () => {
    const { seen, fetchImpl } = fakeCm(OK);
    let asked = 0;
    const call = callerOver(fetchImpl, { toCmUserId: async () => { asked += 1; return 'other'; } });
    await call('cm', 'listAgents', {}, { organizationId: ORG, actorUserId: 'cm-user-1', actorMdmId: 'mdm-5' });
    assert.equal(asked, 0);
    assert.deepEqual(seen[0].body.context, { organizationId: ORG, actorUserId: 'cm-user-1' });
  });

  it('a person input declared by the operation (simulateAgent: asMdmId -> as) is translated and the original taken out; no link is forbidden', async () => {
    const { seen, fetchImpl } = fakeCm(OK);
    const call = callerOver(fetchImpl, { toCmUserId: async (mdmId) => `cm-of-${mdmId}` });
    await call('cm', 'simulateAgent', { agentId: 'a', level: 'canDo', asMdmId: 'mdm-7' }, CONTEXT);
    assert.deepEqual(seen[0].body.input, { agentId: 'a', level: 'canDo', as: 'cm-of-mdm-7' });
    // a role goes as it is
    await call('cm', 'simulateAgent', { agentId: 'a', level: 'canDo', as: 'modA:member' }, CONTEXT);
    assert.deepEqual(seen[1].body.input, { agentId: 'a', level: 'canDo', as: 'modA:member' });
    const refused = callerOver(fetchImpl, { toCmUserId: async () => { throw new Error('no link'); } });
    const result = await refused('cm', 'simulateAgent', { agentId: 'a', level: 'canDo', asMdmId: 'mdm-7' }, CONTEXT);
    assert.equal(result.ok === false && result.code, 'forbidden');
    assert.equal(seen.length, 2, 'not sent without the link');
  });

  it('the connector names no operation: another operation that declares personInputs gets the same treatment', async () => {
    const custom: ConnectionCatalog = {
      ...exampleCatalog,
      connectionId: 'example',
      operations: exampleCatalog.operations.map((op) => (op.operationId === 'notify' ? { ...op, personInputs: [{ from: 'toMdmId', to: 'to' }] } : op)),
    };
    const { seen, fetchImpl } = fakeCm(OK);
    const call = callerOver(fetchImpl, { catalog: custom, toCmUserId: async (mdmId) => `cm-${mdmId}` });
    await call('example', 'notify', { toMdmId: 'm1', text: 'hi' }, CONTEXT);
    assert.deepEqual(seen[0].body.input, { text: 'hi', to: 'cm-m1' });
  });
});

describe('callConnection: the log', () => {
  it('one line per call with the connection, the operation, the result and the time; never the input or the context', async () => {
    const logs: string[] = [];
    const { fetchImpl } = fakeCm((request) => (request.body.operationId === 'readAgent'
      ? { body: { statusCode: 404, ok: false, code: 'not_found', message: 'gone' } }
      : { body: { statusCode: 200, ok: true, output: {} } }));
    const call = callerOver(fetchImpl, { log: (line) => logs.push(line) });
    await call('cm', 'listAgents', { secretInput: 'input-sentinel' }, { organizationId: ORG, actorUserId: 'context-sentinel' });
    await call('cm', 'readAgent', { agentId: 'input-sentinel' }, { organizationId: ORG, actorUserId: 'context-sentinel' });
    await call('cm', 'nope', {}, CONTEXT);
    assert.equal(logs.length, 3);
    assert.match(logs[0], /^\[connection\] cm\.listAgents ok=true ms=\d+$/);
    assert.match(logs[1], /^\[connection\] cm\.readAgent ok=false code=not_found ms=\d+$/);
    assert.match(logs[2], /^\[connection\] cm\.nope ok=false code=invalid reason=unknown-operation ms=\d+$/);
    for (const line of logs) assert.equal(/sentinel|secret/.test(line), false);
  });
});

describe('the catalog of the release', () => {
  it('reads the connection catalogs the release carries, once, and refuses a file that is not a catalog', async () => {
    let reads = 0;
    const reader = {
      list: () => [] as string[],
      json: () => undefined,
      text: () => undefined,
      async read(file: string) {
        reads += 1;
        if (file.endsWith('/cm.defs.js')) return cm;
        if (file.endsWith('/broken.defs.js')) return { schemaVersion: 'other' };
        return undefined;
      },
    };
    const catalogOf = distConnectionCatalogs(reader);
    assert.equal((await catalogOf('cm'))?.connectionId, 'cm');
    await catalogOf('cm');
    assert.equal(reads, 1);
    assert.equal(await catalogOf('missing'), undefined);
    await assert.rejects(() => catalogOf('broken'), /not valid/);
    assert.equal(await catalogOf('../../etc/passwd'), undefined, 'the id is not a path');
  });
});
