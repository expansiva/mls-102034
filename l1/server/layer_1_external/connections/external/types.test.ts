/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/types.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  externalSystemAdapterFile,
  externalSystemDeclarationFile,
  validateExternalSystemAdapter,
  validateExternalSystemDeclaration,
  type ExternalSystemDeclaration,
} from '/_102034_/l1/server/layer_1_external/connections/external/types.js';

function declaration(patch: Record<string, unknown> = {}): ExternalSystemDeclaration {
  return {
    schemaVersion: 'external-system-v1',
    systemId: 'billingApi',
    title: 'Billing',
    description: 'Reads invoices.',
    hosts: [{ host: 'billing.example.com' }],
    settings: [
      { id: 'baseUrl', secret: false },
      { id: 'apiKey', secret: true },
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
        uses: { settings: ['baseUrl'], secrets: ['apiKey'] },
        reply: 'now',
      },
    ],
    ...patch,
  } as ExternalSystemDeclaration;
}

function messages(value: unknown): string[] {
  return validateExternalSystemDeclaration(value).map((item) => item.message);
}

describe('validateExternalSystemDeclaration', () => {
  it('accepts a declaration and names the generated file', () => {
    assert.deepEqual(validateExternalSystemDeclaration(declaration()), []);
    assert.equal(externalSystemDeclarationFile('invoices', 'billingApi'), 'l1/invoices/layer_1_external/connections/billingApi.ts');
    assert.equal(externalSystemAdapterFile('invoices', 'billingApi'), 'l1/invoices/layer_1_external/connections/billingApiAdapter.ts');
  });

  it('rejects an id that is not lowerCamel', () => {
    assert.match(messages(declaration({ systemId: 'Billing-api' })).join('\n'), /systemId is not lowerCamel/);
  });

  it('rejects a wildcard, an ip, http and a port', () => {
    const hosts = [
      { host: '*.example.com' },
      { host: '10.1.2.3' },
      { host: 'http://example.com' },
      { host: 'example.com:443' },
    ];
    const text = messages(declaration({ hosts })).join('\n');
    assert.match(text, /wildcard/);
    assert.match(text, /ip/);
    assert.match(text, /http/);
    assert.match(text, /port/);
  });

  it('rejects fromSetting that is not in settings', () => {
    assert.match(messages(declaration({ hosts: [{ fromSetting: 'missingHost' }] })).join('\n'), /fromSetting missingHost is not in settings/);
  });

  it('rejects uses of an unknown setting and a secret that is not secret', () => {
    const value = declaration();
    value.operations[0] = {
      ...value.operations[0],
      direction: 'call',
      methods: ['GET'],
      reply: 'now',
      uses: { settings: ['nope'], secrets: ['baseUrl'] },
    } as ExternalSystemDeclaration['operations'][number];
    const text = messages(value).join('\n');
    assert.match(text, /unknown setting nope/);
    assert.match(text, /baseUrl but the setting is not secret/);
  });

  it('rejects a call without methods', () => {
    const value = declaration();
    const operation = { ...value.operations[0] } as { methods?: string[] };
    delete operation.methods;
    value.operations[0] = operation as ExternalSystemDeclaration['operations'][number];
    assert.match(messages(value).join('\n'), /call has no methods/);
  });

  function serveWith(verify: unknown): ExternalSystemDeclaration {
    return declaration({
      operations: [
        {
          operationId: 'onEvent',
          direction: 'serve',
          kind: 'command',
          description: 'Accepts one event.',
          inputType: 'EventInput',
          outputType: 'EventOutput',
          verify,
        },
      ],
    });
  }

  it('accepts the hmac and the token members of verify', () => {
    const hmac = {
      scheme: 'hmac', algorithm: 'sha256', secret: 'apiKey',
      signature: { header: 'x-signature', prefix: 'sha256=', encoding: 'hex' },
      signed: [{ header: 'x-timestamp' }, { literal: '.' }, 'body'],
      timestamp: { header: 'x-timestamp', toleranceSeconds: 300 },
    };
    assert.deepEqual(messages(serveWith(hmac)), []);
    assert.deepEqual(messages(serveWith({ scheme: 'hmac', algorithm: 'sha512', secret: 'apiKey', signature: { header: 'x-sig', encoding: 'base64' }, signed: ['body'], separator: '' })), []);
    assert.deepEqual(messages(serveWith({ scheme: 'token', secret: 'apiKey', header: 'x-token', prefix: 'Bearer ' })), []);
  });

  it('rejects an unknown scheme with a clear message', () => {
    const text = messages(serveWith({ scheme: 'mtls', secret: 'apiKey' })).join('\n');
    assert.match(text, /verify scheme mtls is unknown \(known: hmac, token\)/);
    assert.match(messages(serveWith({ secret: 'apiKey' })).join('\n'), /scheme undefined is unknown/);
  });

  it('rejects verify that does not cite a secret setting', () => {
    assert.match(messages(serveWith({ scheme: 'token', secret: 'baseUrl', header: 'x-token' })).join('\n'), /verify secret baseUrl is not a secret setting/);
    assert.match(messages(serveWith({ scheme: 'token', secret: 'nope', header: 'x-token' })).join('\n'), /verify secret nope is not a secret setting/);
  });

  it('rejects an hmac that is incomplete', () => {
    const text = messages(serveWith({
      scheme: 'hmac', algorithm: 'md5', secret: 'apiKey',
      signature: { header: '', encoding: 'hex' }, signed: [], timestamp: { header: 'x-t', toleranceSeconds: 0 },
    })).join('\n');
    assert.match(text, /algorithm is not sha256 or sha512/);
    assert.match(text, /signature needs a header and an encoding/);
    assert.match(text, /signs nothing/);
    assert.match(text, /timestamp needs a header and a positive toleranceSeconds/);
    assert.match(messages(serveWith({ scheme: 'token', secret: 'apiKey' })).join('\n'), /token has no header/);
  });

  it('rejects a repeated operation', () => {
    const value = declaration();
    value.operations.push({ ...value.operations[0] });
    assert.match(messages(value).join('\n'), /readInvoice is repeated/);
  });

  it('returns problems for a non-object and does not throw', () => {
    assert.equal(messages(null).length, 1);
    assert.equal(messages('nope').length, 1);
  });
});

describe('validateExternalSystemAdapter', () => {
  const ok = async () => ({ ok: true as const, output: {} });
  it('wants one function for each call and none more', () => {
    const value = declaration();
    assert.deepEqual(validateExternalSystemAdapter(value, { readInvoice: ok }).map((item) => item.message), []);
    assert.match(validateExternalSystemAdapter(value, {}).map((item) => item.message).join('\n'), /no function for call readInvoice/);
    assert.match(validateExternalSystemAdapter(value, { readInvoice: ok, extra: ok }).map((item) => item.message).join('\n'), /adapter has extra, which is not a call of billingApi/);
    assert.match(validateExternalSystemAdapter(value, { readInvoice: 1 }).map((item) => item.message).join('\n'), /no function for call readInvoice/);
  });

  it('does not take a serve operation as a call, and does not throw on a non-object', () => {
    const value = declaration({
      operations: [
        { operationId: 'onEvent', direction: 'serve', kind: 'command', description: 'x', inputType: 'A', outputType: 'B' },
      ],
    });
    assert.match(validateExternalSystemAdapter(value, { onEvent: ok }).map((item) => item.message).join('\n'), /onEvent, which is not a call/);
    assert.equal(validateExternalSystemAdapter(value, null).length, 1);
  });
});
