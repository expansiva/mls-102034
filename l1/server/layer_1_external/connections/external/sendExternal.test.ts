/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/sendExternal.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConnectionContext } from '/_102034_/l2/shared/contracts/connections/types.js';
import type { ExternalSystemDeclaration } from '/_102034_/l2/shared/contracts/connections/externalSystem.js';
import {
  createExternalSender,
  EXTERNAL_DEFAULT_TIMEOUT_MS,
  EXTERNAL_MAX_REQUEST_BYTES,
  EXTERNAL_MAX_RESPONSE_BYTES,
  EXTERNAL_MAX_TIMEOUT_MS,
  isBlockedAddress,
  type ExternalRecordEvent,
  type ExternalRef,
  type ExternalRequest,
  type ExternalSenderDeps,
  type ExternalTransportCall,
  type ExternalTransportResponse,
} from '/_102034_/l1/server/layer_1_external/connections/external/sendExternal.js';

const SECRET = 'super-secret-value';
const ref: ExternalRef = { projectId: 'p', moduleId: 'invoices', systemId: 'billingApi' };
const context: ConnectionContext = { organizationId: 'org' };

function declaration(): ExternalSystemDeclaration {
  return {
    schemaVersion: 'external-system-v1',
    systemId: 'billingApi',
    title: 'Billing',
    description: 'Reads invoices.',
    hosts: [{ host: 'billing.example.com' }],
    settings: [
      { id: 'account', secret: false },
      { id: 'apiKey', secret: true },
      { id: 'apiHost', secret: false },
    ],
    operations: [
      {
        operationId: 'readInvoice',
        direction: 'call',
        kind: 'query',
        description: 'Reads one invoice.',
        inputType: 'ReadInvoiceInput',
        outputType: 'ReadInvoiceOutput',
        methods: ['GET'],
        uses: { settings: ['account'], secrets: ['apiKey'] },
        reply: 'now',
      },
      {
        operationId: 'takePayment',
        direction: 'serve',
        kind: 'command',
        description: 'Accepts a payment notice.',
        inputType: 'TakePaymentInput',
        outputType: 'TakePaymentOutput',
        verify: { scheme: 'token', secret: 'apiKey', header: 'authorization' },
      },
    ],
  };
}

function harness(patch: Partial<ExternalSenderDeps> & { declaration?: ExternalSystemDeclaration | null } = {}) {
  const calls: ExternalTransportCall[] = [];
  const records: ExternalRecordEvent[] = [];
  const lines: string[] = [];
  const decl = patch.declaration === undefined ? declaration() : patch.declaration;
  const deps: ExternalSenderDeps = {
    declarationOf: () => decl,
    settingOf: (_ref, id) => (id === 'account' ? 'acme' : id === 'apiHost' ? 'billing.example.com' : null),
    secretOf: (_ref, id) => (id === 'apiKey' ? SECRET : null),
    record: (event) => { records.push(event); },
    resolveHost: async () => ['8.8.8.8'],
    transport: async (call) => {
      calls.push(call);
      return { status: 200, headers: { 'content-type': 'application/json' }, body: `{"ok":true,"echo":"${SECRET}"}` };
    },
    ...patch,
  };
  const original = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  const sender = createExternalSender(deps);
  return {
    calls,
    records,
    lines,
    sender,
    restore: () => { console.log = original; console.error = originalError; },
  };
}

async function send(box: ReturnType<typeof harness>, request: ExternalRequest, operationId = 'readInvoice') {
  try {
    return await box.sender.sendExternal(ref, operationId, request, context);
  } finally {
    box.restore();
  }
}

function leaked(value: unknown): boolean {
  return JSON.stringify(value).includes(SECRET);
}

const okRequest: ExternalRequest = {
  method: 'GET',
  path: '/invoices/1',
  query: { account: '{{setting:account}}' },
  headers: { authorization: 'Bearer {{secret:apiKey}}' },
};

describe('sendExternal', () => {
  it('fills a declared reference, pins the checked address and redacts the secret from the output', async () => {
    const box = harness();
    const result = await send(box, okRequest);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.output.status, 200);
    assert.equal(result.output.body.includes(SECRET), false);
    assert.equal(result.output.body.includes('***'), true);
    assert.equal(box.calls.length, 1);
    const call = box.calls[0];
    assert.ok(call);
    assert.equal(call.address, '8.8.8.8');
    assert.equal(call.redirect, 'manual');
    assert.equal(call.url, 'https://billing.example.com/invoices/1?account=acme');
    assert.equal(call.headers.authorization, `Bearer ${SECRET}`);
    assert.equal(call.timeoutMs, EXTERNAL_DEFAULT_TIMEOUT_MS);
    assert.equal(leaked(result), false);
    assert.equal(leaked(box.records), false);
    assert.equal(leaked(box.lines), false);
    assert.equal(box.lines.some((line) => line.startsWith('[external] billingApi.readInvoice ok')), true);
  });

  it('refuses a system, a serve operation, a method or a host the declaration does not list', async () => {
    const missing = harness({ declaration: null });
    const missingResult = await send(missing, okRequest);
    assert.deepEqual(missingResult, { ok: false, code: 'forbidden', message: 'system is not declared' });

    const serve = harness();
    const serveResult = await send(serve, { method: 'POST', path: '/pay' }, 'takePayment');
    assert.equal(serveResult.ok, false);
    if (!serveResult.ok) assert.equal(serveResult.code, 'forbidden');

    const method = harness();
    const methodResult = await send(method, { method: 'POST', path: '/invoices/1' });
    assert.equal(methodResult.ok, false);
    if (!methodResult.ok) assert.equal(methodResult.code, 'forbidden');

    const emptyHost = harness({
      declaration: { ...declaration(), hosts: [{ fromSetting: 'apiHost' }] },
      settingOf: () => null,
    });
    const hostResult = await send(emptyHost, { method: 'GET', path: '/invoices/1' });
    assert.equal(hostResult.ok, false);
    if (!hostResult.ok) assert.equal(hostResult.code, 'forbidden');
    assert.equal(emptyHost.calls.length, 0);
  });

  it('refuses a private, loopback or link-local address after resolution', async () => {
    for (const address of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '192.168.0.5', '172.16.0.1', '::1', 'fe80::1', 'fd00::1']) {
      assert.equal(isBlockedAddress(address), true, address);
    }
    assert.equal(isBlockedAddress('8.8.8.8'), false);
    const box = harness({ resolveHost: async () => ['8.8.8.8', '169.254.169.254'] });
    const result = await send(box, { method: 'GET', path: '/invoices/1' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'forbidden');
    assert.equal(box.calls.length, 0);
    assert.equal(leaked(box.lines), false);
  });

  it('returns a redirect and does not follow it', async () => {
    const box = harness({
      transport: async (call) => {
        box.calls.push(call);
        return { status: 302, headers: { location: 'https://other.example/next' }, body: '' };
      },
    });
    const result = await send(box, { method: 'GET', path: '/invoices/1' });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.output.status, 302);
    assert.equal(box.calls.length, 1);
  });

  it('refuses an undeclared reference and reports a declared one with no value', async () => {
    const foreign = harness();
    const foreignResult = await send(foreign, { method: 'GET', path: '/invoices/1', headers: { authorization: 'Bearer {{secret:other}}' } });
    assert.equal(foreignResult.ok, false);
    if (!foreignResult.ok) assert.equal(foreignResult.code, 'forbidden');
    assert.equal(foreign.calls.length, 0);

    const incomplete = harness({ secretOf: () => null });
    const incompleteResult = await send(incomplete, okRequest);
    assert.deepEqual(incompleteResult, { ok: false, code: 'disabled', message: 'configuração incompleta: apiKey' });
    assert.equal(leaked(incompleteResult), false);
  });

  it('maps the ceiling of time and size, and the http status, without the body', async () => {
    const slow = harness({
      declaration: { ...declaration(), operations: [{ ...declaration().operations[0]!, timeoutMs: 9_999_999 }] } as ExternalSystemDeclaration,
      transport: async (call) => {
        slow.calls.push(call);
        const error = new Error(SECRET);
        error.name = 'TimeoutError';
        throw error;
      },
    });
    const timed = await send(slow, { method: 'GET', path: '/invoices/1' });
    assert.deepEqual(timed, { ok: false, code: 'unavailable', message: 'timed out' });
    assert.equal(slow.calls[0]?.timeoutMs, EXTERNAL_MAX_TIMEOUT_MS);
    assert.equal(leaked(timed), false);
    assert.equal(leaked(slow.lines), false);

    const huge = harness();
    const hugeResult = await send(huge, { method: 'GET', path: '/invoices/1', body: 'x'.repeat(EXTERNAL_MAX_REQUEST_BYTES + 1) });
    assert.equal(hugeResult.ok, false);
    if (!hugeResult.ok) assert.equal(hugeResult.code, 'invalid');
    assert.equal(huge.calls.length, 0);

    const marker = `body-${SECRET}-tail`;
    const over = harness({
      transport: async () => ({ status: 200, headers: {}, body: marker, truncated: true } satisfies ExternalTransportResponse),
    });
    const overResult = await send(over, { method: 'GET', path: '/invoices/1' });
    assert.deepEqual(overResult, { ok: false, code: 'unavailable', message: 'response is above the size ceiling' });
    assert.equal(JSON.stringify(overResult).includes(marker), false);
    assert.equal(leaked(overResult), false);

    const codes: Array<[number, string]> = [[400, 'invalid'], [422, 'invalid'], [401, 'refused'], [403, 'refused'], [404, 'not_found'], [409, 'conflict'], [412, 'conflict'], [429, 'unavailable'], [503, 'unavailable']];
    for (const [status, code] of codes) {
      const box = harness({
        transport: async () => ({ status, headers: {}, body: marker }),
      });
      const result = await send(box, { method: 'GET', path: '/invoices/1' });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, code);
        assert.equal(result.message, `http ${status}`);
      }
      assert.equal(JSON.stringify(result).includes('body-'), false);
      assert.equal(leaked(result), false);
    }
    assert.equal(EXTERNAL_MAX_RESPONSE_BYTES > 0, true);
  });

  it('refuses reserved ranges that embed or hide an internal address', () => {
    for (const address of ['192.0.2.7', '198.18.0.1', '198.51.100.9', '203.0.113.4', '::1', '::7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fe80::1', 'fd00::1', '169.254.169.254']) {
      assert.equal(isBlockedAddress(address), true, address);
    }
    for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
      assert.equal(isBlockedAddress(address), false, address);
    }
  });

  it('refuses a path with a control character or a fragment, and a method that is not text', async () => {
    let calls = 0;
    for (const path of ['/a b', '/a\r\nHost: evil', '/a#b']) {
      const h = harness();
      const result = await send(h, { method: 'GET', path });
      assert.equal(result.ok, false, path);
      calls += h.calls.length;
    }
    const h = harness();
    const bad = await send(h, { method: undefined as unknown as string, path: '/x' });
    assert.equal(bad.ok === false && bad.code, 'forbidden');
    assert.equal(calls + h.calls.length, 0);
  });

  it('ends with unavailable when the transport ignores the time ceiling', async () => {
    const decl = declaration();
    (decl.operations[0] as { timeoutMs?: number }).timeoutMs = 20;
    const h = harness({ declaration: decl, transport: () => new Promise(() => {}) });
    const result = await send(h, { method: 'GET', path: '/x' });
    assert.equal(result.ok === false && result.code, 'unavailable');
    assert.equal(result.ok === false && result.message, 'timed out');
  });
});
