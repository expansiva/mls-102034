/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/callConnection.module.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import tls from 'node:tls';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { ConnectionContext } from '/_102034_/l2/shared/contracts/connections/types.js';
import { connectionCatalogs } from '/_102034_/l1/server/layer_1_external/connections/connectionCatalogs.js';
import { createConnectionCaller } from '/_102034_/l1/server/layer_1_external/connections/callConnection.js';
import { nodeExternalTransport } from '/_102034_/l1/server/layer_1_external/connections/external/nodeExternalTransport.js';
import { releaseDeclarationOf } from '/_102034_/l1/server/layer_1_external/connections/external/productionExternalSender.js';
import { createExternalSender, type ExternalRef } from '/_102034_/l1/server/layer_1_external/connections/external/sendExternal.js';
import { exampleExternalAdapter, exampleExternalSystem } from '/_102034_/testing/connections/externalFixtures.js';

const PROJECT = '900261';
const E2E = '900262';
const ODD = '900263';
const OWNER = 'ownerMod';
const CALLER = 'callerMod';
const root = mkdtempSync(path.join(tmpdir(), 'connection-module-'));
const context: ConnectionContext = { organizationId: 'org', actorUserId: 'person' };
let previousCwd = '';

function distOf(projectId: string): string {
  return path.join(root, 'dist', 'local', `_${projectId}_`);
}

function writeText(projectId: string, relative: string, text: string): void {
  const file = path.join(distOf(projectId), relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function writeJs(projectId: string, relative: string, body: unknown): void {
  writeText(projectId, relative, `export default ${JSON.stringify(body)};\n`);
}

function declaration(systemId: string, operations: unknown[], settings: unknown[] = []): unknown {
  return {
    schemaVersion: 'external-system-v1',
    systemId,
    title: 'Sibling',
    description: 'Declared by the owner module.',
    hosts: [{ host: 'sibling.test' }],
    settings,
    operations,
  };
}

const ping = {
  operationId: 'ping', direction: 'call', kind: 'query', description: 'Ping.',
  inputType: 'PingInput', outputType: 'PingOutput', methods: ['GET'], uses: { settings: [], secrets: [] }, reply: 'now',
};
const receive = {
  operationId: 'receive', direction: 'serve', kind: 'command', description: 'Inbound.',
  inputType: 'In', outputType: 'Out',
};
/** A `settingOf` that has a value for the non-secret `account` and, to prove it is never asked, also for the secret `signingKey`. */
function settingsOf(values: Record<string, string>, asked: string[] = []) {
  return async (_ref: ExternalRef, id: string): Promise<string | undefined> => {
    asked.push(id);
    return values[id];
  };
}

const boom = {
  operationId: 'boom', direction: 'call', kind: 'query', description: 'Throws.',
  inputType: 'In', outputType: 'Out', methods: ['GET'], uses: { settings: [], secrets: [] }, reply: 'now',
};

before(() => {
  writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    defaultProjectId: PROJECT,
    projects: {
      [PROJECT]: { root: '.', type: 'client' },
      [E2E]: { root: '.', type: 'client' },
      '102033': { root: '.', type: 'master frontend' },
      '102034': { root: '.', type: 'master backend' },
    },
  }));
  writeJs(PROJECT, `l4/${CALLER}/integration.defs.js`, { externalSystems: [] });
  writeJs(PROJECT, `l4/${OWNER}/integration.defs.js`, {
    externalSystems: [
      { id: 'siblingSystem', title: 'Sibling', description: 'Owned next door.', settings: [], operations: [] },
      { id: 'throwSystem', title: 'Throw', description: 'Adapter throws.', settings: [], operations: [] },
      { id: 'hangSystem', title: 'Hang', description: 'Adapter never answers.', settings: [], operations: [] },
    ],
  });
  writeJs(PROJECT, `l1/${OWNER}/layer_1_external/connections/siblingSystem.js`, declaration('siblingSystem', [ping, receive], [{ id: 'account', secret: false }, { id: 'signingKey', secret: true }]));
  writeJs(PROJECT, `l1/${OWNER}/layer_1_external/connections/throwSystem.js`, declaration('throwSystem', [boom]));
  writeText(PROJECT, `l1/${OWNER}/layer_1_external/connections/siblingSystemAdapter.js`, `
    export default {
      async ping(input, ctx) {
        const sent = await ctx.send('ping', { method: 'GET', path: '/ping' });
        return { ok: true, output: { input, setting: ctx.setting('account'), secret: ctx.setting('signingKey'), organizationId: ctx.connection.organizationId, actorUserId: ctx.connection.actorUserId, sent } };
      },
    };
  `);
  writeJs(PROJECT, `l1/${OWNER}/layer_1_external/connections/hangSystem.js`, declaration('hangSystem', [{ ...boom, operationId: 'hang', timeoutMs: 30 }]));
  writeText(PROJECT, `l1/${OWNER}/layer_1_external/connections/hangSystemAdapter.js`, `
    export default { async hang() { return new Promise(() => {}); } };
  `);
  writeText(PROJECT, `l1/${OWNER}/layer_1_external/connections/throwSystemAdapter.js`, `
    export default { async boom() { throw new Error('BODY secret payload'); } };
  `);
  previousCwd = process.cwd();
  process.chdir(root);
});

after(() => {
  process.chdir(previousCwd);
  rmSync(root, { recursive: true, force: true });
});

describe('a module calls a system its sibling declared', () => {
  it('calls the sibling adapter with the sibling send and the context as it arrived', async () => {
    const seen: ExternalRef[] = [];
    const asked: string[] = [];
    const call = createConnectionCaller({
      projectId: PROJECT,
      catalogOf: connectionCatalogs(),
      transports: {},
      settingOf: settingsOf({ account: 'acme', signingKey: 'LEAK' }, asked),
      sender: {
        async sendExternal(ref) {
          seen.push(ref);
          return { ok: true, output: { status: 200, headers: {}, body: '{}' } };
        },
      },
      log: () => undefined,
    });
    const result = await call('siblingSystem', 'ping', { n: 1 }, context);
    assert.equal(result.ok, true);
    if (result.ok) {
      const output = result.output as { setting: unknown; secret: unknown; organizationId: string; actorUserId: string; sent: { ok: boolean } };
      assert.equal(output.organizationId, 'org');
      assert.equal(output.actorUserId, 'person');
      assert.equal(output.setting, 'acme');
      assert.equal(output.secret, undefined);
      assert.equal(output.sent.ok, true);
    }
    assert.deepEqual(asked, ['account']);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.projectId, PROJECT);
    assert.equal(seen[0]?.moduleId, OWNER);
    assert.equal(seen[0]?.systemId, 'siblingSystem');
  });

  it('the requestId of the request reaches the send of the module, apart from the context', async () => {
    const traces: Array<{ requestId?: string } | undefined> = [];
    const contexts: unknown[] = [];
    const call = createConnectionCaller({
      projectId: PROJECT,
      catalogOf: async () => undefined,
      transports: {},
      settingOf: settingsOf({}),
      sender: {
        async sendExternal(_ref, _operationId, _request, sentContext, trace) {
          traces.push(trace);
          contexts.push(sentContext);
          return { ok: true, output: { status: 200, headers: {}, body: '{}' } };
        },
      },
      log: () => undefined,
    });
    await call('siblingSystem', 'ping', {}, context, { requestId: 'req-42' });
    assert.deepEqual(traces, [{ requestId: 'req-42' }]);
    assert.equal(JSON.stringify(contexts).includes('req-42'), false);
  });

  it('a setting that is absent or empty reaches the adapter as undefined', async () => {
    for (const values of [{}, { account: '' }] as Array<Record<string, string>>) {
      const call = createConnectionCaller({
        projectId: PROJECT,
        catalogOf: async () => undefined,
        transports: {},
        settingOf: settingsOf(values),
        sender: { async sendExternal() { return { ok: true, output: { status: 200, headers: {}, body: '{}' } }; } },
        log: () => undefined,
      });
      const result = await call('siblingSystem', 'ping', {}, context);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal((result.output as { setting: unknown }).setting, undefined);
    }
  });

  it('a settingOf that throws is unavailable, the adapter is not called and the log names no value', async () => {
    const lines: string[] = [];
    let sends = 0;
    const call = createConnectionCaller({
      projectId: PROJECT,
      catalogOf: async () => undefined,
      transports: {},
      settingOf: async () => { throw new Error('db down with SECRET-VALUE'); },
      sender: { async sendExternal() { sends += 1; return { ok: true, output: { status: 200, headers: {}, body: '{}' } }; } },
      log: (line) => { lines.push(line); },
    });
    const result = await call('siblingSystem', 'ping', {}, context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'unavailable');
    assert.equal(sends, 0);
    const text = lines.join('\n');
    assert.match(text, /siblingSystem\.ping ok=false code=unavailable reason=settings/);
    assert.equal(text.includes('SECRET-VALUE'), false);
  });

  it('a serve operation through callConnection is forbidden and the adapter is not called', async () => {
    let sends = 0;
    const call = createConnectionCaller({
      projectId: PROJECT,
      catalogOf: async () => undefined,
      transports: {},
      sender: { async sendExternal() { sends += 1; return { ok: true, output: { status: 200, headers: {}, body: '' } }; } },
      log: () => undefined,
    });
    const result = await call('siblingSystem', 'receive', {}, context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'forbidden');
    assert.equal(sends, 0);
  });

  it('an adapter that throws is unavailable and the log names the operation, not the body', async () => {
    const lines: string[] = [];
    const call = createConnectionCaller({
      projectId: PROJECT,
      catalogOf: async () => undefined,
      transports: {},
      log: (line) => { lines.push(line); },
    });
    const result = await call('throwSystem', 'boom', { body: 'BODY secret payload' }, context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'unavailable');
    const text = lines.join('\n');
    assert.match(text, /throwSystem\.boom/);
    assert.equal(text.includes('BODY secret payload'), false);
  });

  it('an adapter that never answers is cut at the operation time and is unavailable', async () => {
    const call = createConnectionCaller({
      projectId: PROJECT,
      catalogOf: async () => undefined,
      transports: {},
      log: () => {},
    });
    const started = Date.now();
    const result = await call('hangSystem', 'hang', {}, context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'unavailable');
    assert.ok(Date.now() - started < 2000);
  });

  it('an answer outside the envelope is invalid', async () => {
    writeText(ODD, `l1/${OWNER}/layer_1_external/connections/oddSystemAdapter.js`, `
      export default { async ping() { return { ok: true }; } };
    `);
    const call = createConnectionCaller({
      projectId: ODD,
      catalogOf: async () => undefined,
      transports: {},
      moduleSystemsOf: async () => new Map([['oddSystem', OWNER]]),
      declarationOf: async () => declaration('oddSystem', [ping]) as never,
      log: () => undefined,
    });
    const result = await call('oddSystem', 'ping', {}, context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'invalid');
  });
});

describe('end to end with the example adapter and a local https server', () => {
  const NAME = 'ping-e2e.invalid';
  const dir = mkdtempSync(path.join(tmpdir(), 'connection-e2e-'));
  let server: https.Server;
  let port = 0;
  let previousCas: string[] = [];

  function openssl(args: string[]): void {
    const result = spawnSync('openssl', args, { stdio: 'pipe' });
    assert.equal(result.status, 0, result.stderr.toString());
  }

  before(async () => {
    const ca = path.join(dir, 'ca.crt');
    const cert = path.join(dir, 'srv.crt');
    const key = path.join(dir, 'srv.key');
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'ca.key'), '-out', ca, '-subj', '/CN=e2e-ca', '-days', '1']);
    openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', path.join(dir, 'srv.csr'), '-subj', `/CN=${NAME}`]);
    writeFileSync(path.join(dir, 'san.cnf'), `subjectAltName=DNS:${NAME}\n`);
    openssl(['x509', '-req', '-in', path.join(dir, 'srv.csr'), '-CA', ca, '-CAkey', path.join(dir, 'ca.key'), '-CAcreateserial', '-out', cert, '-days', '1', '-extfile', path.join(dir, 'san.cnf')]);
    previousCas = tls.getCACertificates('default');
    tls.setDefaultCACertificates([...previousCas, readFileSync(ca, 'utf8')]);
    server = https.createServer({ cert: readFileSync(cert), key: readFileSync(key) }, (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ value: 'found' }));
    });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => resolve()); });
    port = (server.address() as AddressInfo).port;

    const declared = {
      ...exampleExternalSystem,
      hosts: [{ host: NAME }],
      operations: exampleExternalSystem.operations.map((operation) => (
        operation.direction === 'call' && operation.operationId === 'lookup'
          ? { ...operation, uses: { settings: [], secrets: [] } }
          : operation
      )),
    };
    writeJs(E2E, `l4/${OWNER}/integration.defs.js`, {
      externalSystems: [{ id: exampleExternalSystem.systemId, title: 'Example', description: 'Example.', settings: [], operations: [] }],
    });
    writeJs(E2E, `l1/${OWNER}/layer_1_external/connections/${exampleExternalSystem.systemId}.js`, declared);
    // The release ships JavaScript. This is exampleExternalAdapter (lookup and notify); a .ts re-export does not load.
    assert.equal(typeof exampleExternalAdapter.lookup, 'function');
    assert.equal(typeof exampleExternalAdapter.notify, 'function');
    writeText(E2E, `l1/${OWNER}/layer_1_external/connections/${exampleExternalSystem.systemId}Adapter.js`, `
      export default {
        async lookup(input, ctx) {
          const account = ctx.setting('account') ?? '';
          const result = await ctx.send('lookup', { method: 'GET', path: '/lookup', query: { key: input.key, account } });
          if (!result.ok) return result;
          return { ok: true, output: JSON.parse(result.output.body) };
        },
        async notify(input, ctx) {
          const result = await ctx.send('notify', {
            method: 'POST',
            path: '/notify',
            headers: { authorization: 'Bearer {{secret:signingKey}}' },
            body: JSON.stringify({ to: input.to, text: input.text }),
          });
          if (!result.ok) return result;
          return { ok: true, output: { sent: true } };
        },
      };
    `);
  });

  after(async () => {
    tls.setDefaultCACertificates(previousCas);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('callConnection of the example lookup with no setting comes back ok', async () => {
    // The production door refuses loopback and a port. The test is the only place that moves the socket,
    // the same way the production sender test does. The adapter and the declaration are the ones in the release.
    const sender = createExternalSender({
      declarationOf: releaseDeclarationOf,
      settingOf: () => null,
      secretOf: () => null,
      record: () => {},
      resolveHost: async () => ['8.8.8.8'],
      transport: (call) => nodeExternalTransport({
        ...call,
        address: '127.0.0.1',
        url: call.url.replace(`https://${NAME}`, `https://${NAME}:${port}`),
      }),
    });
    const call = createConnectionCaller({
      projectId: E2E,
      catalogOf: connectionCatalogs(),
      transports: { cm: async () => { throw new Error('platform'); } },
      sender,
      log: () => undefined,
    });
    const result = await call(exampleExternalSystem.systemId, 'lookup', { key: 'k' }, context);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.ok) assert.deepEqual(result.output, { value: 'found' });
  });
});
