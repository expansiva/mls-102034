/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/nodeExternalTransport.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import https from 'node:https';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { describe, it, after, before } from 'node:test';
import type { AddressInfo } from 'node:net';
import {
  nodeExternalTransport,
  nodeResolveHost,
} from '/_102034_/l1/server/layer_1_external/connections/external/nodeExternalTransport.js';
import type { ExternalTransportCall } from '/_102034_/l1/server/layer_1_external/connections/external/sendExternal.js';

const NAME = 'external-pin.invalid';
const OTHER = 'external-other.invalid';
const dir = mkdtempSync(path.join(tmpdir(), 'external-tls-'));
const caPath = path.join(dir, 'ca.crt');
const certPath = path.join(dir, 'srv.crt');
const keyPath = path.join(dir, 'srv.key');

function openssl(args: string[]): void {
  const result = spawnSync('openssl', args, { stdio: 'pipe' });
  assert.equal(result.status, 0, result.stderr.toString());
}

openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'ca.key'), '-out', caPath, '-subj', '/CN=external-test-ca', '-days', '1']);
openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', path.join(dir, 'srv.csr'), '-subj', `/CN=${NAME}`]);
const ext = path.join(dir, 'san.cnf');
writeFileSync(ext, `subjectAltName=DNS:${NAME}\n`);
openssl(['x509', '-req', '-in', path.join(dir, 'srv.csr'), '-CA', caPath, '-CAkey', path.join(dir, 'ca.key'), '-CAcreateserial', '-out', certPath, '-days', '1', '-extfile', ext]);

const previousCas = tls.getCACertificates('default');
tls.setDefaultCACertificates([...previousCas, readFileSync(caPath, 'utf8')]);

let port = 0;
let hits = 0;
let server: https.Server;

function call(patch: Partial<ExternalTransportCall> = {}): ExternalTransportCall {
  return {
    url: `https://${NAME}:${port}/item`,
    method: 'GET',
    headers: {},
    timeoutMs: 2000,
    maxResponseBytes: 1024,
    address: '127.0.0.1',
    redirect: 'manual',
    ...patch,
  };
}

before(async () => {
  server = https.createServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, (req, res) => {
    hits += 1;
    const url = new URL(req.url ?? '/', 'https://local');
    if (url.pathname === '/redirect') {
      res.writeHead(302, { location: 'https://external-elsewhere.invalid/next' });
      res.end('go');
      return;
    }
    if (url.pathname === '/stall') {
      return;
    }
    if (url.pathname === '/big') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      const block = Buffer.alloc(64, 0x61);
      let sent = 0;
      const write = (): void => {
        while (sent < 200_000) {
          sent += block.length;
          if (!res.write(block)) {
            res.once('drain', write);
            return;
          }
        }
        res.end();
      };
      write();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  port = (server.address() as AddressInfo).port;
});

after(async () => {
  tls.setDefaultCACertificates(previousCas);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

describe('nodeExternalTransport', () => {
  it('connects to the given address when the name does not point there', async () => {
    const resolved = await nodeResolveHost(NAME).catch(() => [] as string[]);
    assert.equal(resolved.includes('127.0.0.1'), false);
    const before = hits;
    const response = await nodeExternalTransport(call());
    assert.equal(response.status, 200);
    assert.equal(response.body, 'ok');
    assert.equal(hits, before + 1);
  });

  it('refuses a certificate issued to another name', async () => {
    await assert.rejects(
      () => nodeExternalTransport(call({ url: `https://${OTHER}:${port}/item` })),
      (error: unknown) => error instanceof Error && error.message === 'tls',
    );
  });

  it('reads at most the ceiling plus one block', async () => {
    const response = await nodeExternalTransport(call({ url: `https://${NAME}:${port}/big`, maxResponseBytes: 100 }));
    assert.equal(response.truncated, true);
    const bytes = Buffer.byteLength(response.body);
    assert.ok(bytes > 100);
    assert.ok(bytes <= 100 + 64);
  });

  it('stops when the deadline passes', async () => {
    await assert.rejects(
      () => nodeExternalTransport(call({ url: `https://${NAME}:${port}/stall`, timeoutMs: 150 })),
      (error: unknown) => error instanceof Error && error.name === 'TimeoutError' && error.message === 'timed out',
    );
  });

  it('returns a 302 without following it', async () => {
    const before = hits;
    const response = await nodeExternalTransport(call({ url: `https://${NAME}:${port}/redirect` }));
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, 'https://external-elsewhere.invalid/next');
    assert.equal(response.body, 'go');
    assert.equal(hits, before + 1);
  });
});

describe('nodeResolveHost', () => {
  it('returns the addresses from dns', async () => {
    const addresses = await nodeResolveHost('localhost');
    assert.ok(addresses.includes('127.0.0.1') || addresses.includes('::1'));
  });
});
