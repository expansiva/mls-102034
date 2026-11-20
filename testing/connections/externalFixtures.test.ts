/// <mls fileReference="_102034_/testing/connections/externalFixtures.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ConnectionContext } from '/_102034_/l2/shared/contracts/connections/types.js';
import {
  validateExternalSystemAdapter,
  validateExternalSystemDeclaration,
} from '/_102034_/l2/shared/contracts/connections/externalSystem.js';
import {
  createFakeAdapterContext,
  createFakeExternalSender,
  createFakeHostResolver,
  createFakeTransport,
  exampleExternalAdapter,
  exampleExternalSystem,
} from '/_102034_/testing/connections/externalFixtures.js';

const SECRET = 'super-secret-value';
const context: ConnectionContext = { organizationId: 'org' };
const ref = { projectId: 'p', moduleId: 'module', systemId: 'example' };

/**
 * Files under `l1` that already call `fetch`. A new file must fail this test.
 * `sendExternal.ts` is the only new door; today the transport is a port, so the file does not call `fetch` yet.
 */
const FETCH_ALLOWLIST: Record<string, string> = {
  'identityUsecases.ts': 'the identity host',
  'msgProxy.ts': 'the message proxy',
  's3ObjectStore.ts': 'object storage',
  'cbeAuthJwt.ts': 'auth token exchange',
  'cbeStaticFiles.ts': 'the static cache',
  'cbeLatestJson.ts': 'the release manifest, already in l1',
  'localTestSessionHttp.ts': 'same-origin test session, already in l1',
  'sendExternal.ts': 'the only outbound door',
};

function l1FetchFiles(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '../../l1');
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
      const text = readFileSync(full, 'utf8');
      const calls = text.split('\n').some((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
        return /\bfetch\s*\(/.test(line);
      });
      if (calls) found.push(relative(root, full));
    }
  };
  walk(root);
  return found.sort();
}

describe('external fixtures', () => {
  it('the example declaration and adapter are valid', () => {
    assert.deepEqual(validateExternalSystemDeclaration(exampleExternalSystem), []);
    assert.deepEqual(validateExternalSystemAdapter(exampleExternalSystem, exampleExternalAdapter), []);
  });

  it('an undeclared host is forbidden and the transport is not called', async () => {
    const sender = createFakeExternalSender({
      answers: { 'https://example.test/lookup': { status: 200, headers: {}, body: '{"value":"a"}' } },
      settings: { account: 'acme' },
    });
    const result = await sender.sendExternal(ref, 'lookup', {
      method: 'GET',
      path: '/lookup',
      headers: { host: 'other.test' },
    }, context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'forbidden');
    assert.deepEqual(sender.calls, []);
  });

  it('a recorded call has the secret replaced', async () => {
    const sender = createFakeExternalSender({
      answers: { 'https://example.test/notify': { status: 200, headers: {}, body: '' } },
      secrets: { signingKey: SECRET },
    });
    const result = await sender.sendExternal(ref, 'notify', {
      method: 'POST',
      path: '/notify',
      headers: { authorization: `Bearer {{secret:signingKey}}` },
      body: `key={{secret:signingKey}}`,
    }, context);
    assert.equal(result.ok, true);
    const call = sender.calls[0];
    assert.ok(call);
    assert.equal(call.headers.authorization, 'Bearer ***');
    assert.equal(call.body, 'key=***');
    assert.equal(JSON.stringify(sender.calls).includes(SECRET), false);
    assert.equal(JSON.stringify(sender.records).includes(SECRET), false);
    if (result.ok) assert.equal(JSON.stringify(result.output).includes(SECRET), false);
  });

  it('a missing declared secret is disabled', async () => {
    const sender = createFakeExternalSender({ answers: {} });
    const result = await sender.sendExternal(ref, 'notify', {
      method: 'POST',
      path: '/notify',
      headers: { authorization: 'Bearer {{secret:signingKey}}' },
    }, context);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'disabled');
      assert.match(result.message, /configuration incomplete: signingKey/);
      assert.deepEqual(result.missing, ['signingKey']);
    }
  });

  it('the adapter runs through the fake context', async () => {
    const sender = createFakeExternalSender({
      answers: { 'https://example.test/lookup?key=k&account=acme': { status: 200, headers: {}, body: '{"value":"a"}' } },
      settings: { account: 'acme' },
    });
    const ctx = createFakeAdapterContext({ sender, settings: { account: 'acme' }, secrets: ['signingKey'] });
    assert.equal(ctx.setting('signingKey'), undefined);
    assert.equal(ctx.setting('account'), 'acme');
    const result = await exampleExternalAdapter.lookup?.({ key: 'k' }, ctx);
    assert.deepEqual(result, { ok: true, output: { value: 'a' } });
  });

  it('the transport and the resolver record what they were given', async () => {
    const transport = createFakeTransport({ 'https://example.test/x': { status: 204, headers: {}, body: '' } });
    const response = await transport.transport({
      url: 'https://example.test/x',
      method: 'GET',
      headers: {},
      timeoutMs: 1000,
      maxResponseBytes: 100,
      address: '8.8.8.8',
      redirect: 'manual',
    });
    assert.equal(response.status, 204);
    assert.equal(transport.calls.length, 1);
    const resolve = createFakeHostResolver({ 'example.test': ['10.0.0.1'] });
    assert.deepEqual(await resolve('example.test'), ['10.0.0.1']);
    assert.deepEqual(await resolve('other.test'), ['8.8.8.8']);
  });

  it('a private address is forbidden', async () => {
    const sender = createFakeExternalSender({
      answers: { 'https://example.test/lookup': { status: 200, headers: {}, body: '{}' } },
      settings: { account: 'acme' },
      addresses: { 'example.test': ['10.1.1.1'] },
    });
    const result = await sender.sendExternal(ref, 'lookup', { method: 'GET', path: '/lookup' }, context);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'forbidden');
    assert.deepEqual(sender.calls, []);
  });

  it('l1 fetch stays inside the fixed list', () => {
    const outside = l1FetchFiles().filter((file) => {
      const base = file.split('/').pop() ?? file;
      return FETCH_ALLOWLIST[base] === undefined;
    });
    assert.deepEqual(outside, []);
  });
});
