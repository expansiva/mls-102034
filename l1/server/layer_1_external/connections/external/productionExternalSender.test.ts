/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/productionExternalSender.test.ts" enhancement="_blank"/>
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
import { exampleExternalSystem } from '/_102034_/testing/connections/externalFixtures.js';
import {
  createProductionExternalSender,
  releaseDeclarationOf,
} from '/_102034_/l1/server/layer_1_external/connections/external/productionExternalSender.js';
import { nodeExternalTransport } from '/_102034_/l1/server/layer_1_external/connections/external/nodeExternalTransport.js';
import { createExternalSender, type ExternalRef } from '/_102034_/l1/server/layer_1_external/connections/external/sendExternal.js';

const PROJECT = '900260';
const MODULE = 'exampleModule';
const root = mkdtempSync(path.join(tmpdir(), 'external-release-'));
const dist = path.join(root, 'dist', 'local', `_${PROJECT}_`, 'l1', MODULE, 'layer_1_external', 'connections');
const context: ConnectionContext = { organizationId: 'org' };
let previousCwd = '';

function writeDeclaration(systemId: string, body: unknown): void {
  mkdirSync(dist, { recursive: true });
  writeFileSync(path.join(dist, `${systemId}.js`), `export default ${JSON.stringify(body)};\n`);
}

function ref(systemId: string): ExternalRef {
  return { projectId: PROJECT, moduleId: MODULE, systemId };
}

before(() => {
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

describe('releaseDeclarationOf', () => {
  it('reads and validates the example declaration from the active release', async () => {
    writeDeclaration(exampleExternalSystem.systemId, exampleExternalSystem);
    const found = await releaseDeclarationOf(ref(exampleExternalSystem.systemId));
    assert.deepEqual(found, exampleExternalSystem);
    rmSync(path.join(dist, `${exampleExternalSystem.systemId}.js`));
    const again = await releaseDeclarationOf(ref(exampleExternalSystem.systemId));
    assert.deepEqual(again, exampleExternalSystem);
  });

  it('returns null when the file is absent', async () => {
    assert.equal(await releaseDeclarationOf(ref('missingSystem')), null);
  });

  it('returns null and logs the problems of an invalid declaration', async () => {
    writeDeclaration('brokenSystem', { schemaVersion: 'nope', systemId: 'brokenSystem' });
    const lines: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    try {
      assert.equal(await releaseDeclarationOf(ref('brokenSystem')), null);
    } finally {
      console.warn = warn;
    }
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? '', /brokenSystem/);
    assert.match(lines[0] ?? '', /schemaVersion/);
  });
});

describe('createProductionExternalSender', () => {
  it('answers disabled when the setting is not stored and does not log a secret', async () => {
    writeDeclaration('configuredLater', {
      ...exampleExternalSystem,
      systemId: 'configuredLater',
    });
    const sender = createProductionExternalSender();
    const lines: string[] = [];
    const warn = console.warn;
    const log = console.log;
    console.warn = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    try {
      const request = { method: 'GET', path: '/lookup', query: { key: '{{setting:account}}' } };
      const first = await sender.sendExternal(ref('configuredLater'), 'lookup', request, context);
      assert.equal(first.ok, false);
      if (!first.ok) {
        assert.equal(first.code, 'disabled');
        assert.match(first.message, /account/);
      }
    } finally {
      console.warn = warn;
      console.log = log;
    }
    assert.equal(lines.some((line) => line.includes('sk_')), false);
  });
});

describe('the reader refuses a ref that is not plain ids', () => {
  it('does not import a path outside the module folder', async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      for (const bad of [
        { projectId: PROJECT, moduleId: '../../../etc', systemId: 'x' },
        { projectId: PROJECT, moduleId: MODULE, systemId: '../evil' },
        { projectId: '9/../1', moduleId: MODULE, systemId: 'x' },
        { projectId: PROJECT, moduleId: 'Mod', systemId: 'sys' },
      ]) {
        assert.equal(await releaseDeclarationOf(bad), null, JSON.stringify(bad));
      }
    } finally {
      console.warn = warn;
    }
  });
});

describe('end to end: reader + sender + the real https transport', () => {
  const NAME = 'ping-e2e.invalid';
  const dir = mkdtempSync(path.join(tmpdir(), 'external-e2e-'));
  let server: https.Server;
  let port = 0;
  let previousCas: string[] = [];
  let seenHost = '';

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
    server = https.createServer({ cert: readFileSync(cert), key: readFileSync(key) }, (req, res) => {
      seenHost = String(req.headers.host ?? '');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ pong: req.url }));
    });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => resolve()); });
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    tls.setDefaultCACertificates(previousCas);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('a call with no setting leaves through the real transport and comes back ok', async () => {
    writeDeclaration('pingSystem', {
      schemaVersion: 'external-system-v1',
      systemId: 'pingSystem',
      title: 'Ping',
      description: 'A system with nothing to configure.',
      hosts: [{ host: NAME }],
      settings: [],
      operations: [{
        operationId: 'ping', direction: 'call', kind: 'query', description: 'Ping.',
        inputType: 'PingInput', outputType: 'PingOutput', methods: ['GET'], uses: { settings: [], secrets: [] }, reply: 'now',
      }],
    });
    // The door refuses loopback and a port by design. Only the test moves the connection to the local server:
    // the sender still resolves a public address and builds an https URL without a port.
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
    const result = await sender.sendExternal(ref('pingSystem'), 'ping', { method: 'GET', path: '/ping' }, context);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.output.status, 200);
      assert.equal(result.output.body, '{"pong":"/ping"}');
    }
    assert.equal(seenHost, `${NAME}:${port}`);
  });
});
