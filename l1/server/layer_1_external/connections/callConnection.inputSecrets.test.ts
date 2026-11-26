/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/callConnection.inputSecrets.test.ts" enhancement="_blank"/>
// rt318: a credential that arrives in the input of an operation (`uses.inputSecrets`) stays out of every record, error, log and output.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { ConnectionContext } from '/_102034_/l2/shared/contracts/connections/types.js';
import { createConnectionCaller } from '/_102034_/l1/server/layer_1_external/connections/callConnection.js';
import {
  createExternalSender,
  type ExternalRecordEvent,
  type ExternalTransportCall,
  type ExternalTransportResponse,
} from '/_102034_/l1/server/layer_1_external/connections/external/sendExternal.js';

const PROJECT = '900271';
const OWNER = 'botMod';
const KEY = '123456:ABC-def_ghi';
const KEY_ENCODED = encodeURIComponent(KEY);
const root = mkdtempSync(path.join(tmpdir(), 'connection-input-secrets-'));
const context: ConnectionContext = { organizationId: 'org' };
let previousCwd = '';

function writeText(relative: string, text: string): void {
  const file = path.join(root, 'dist', 'local', `_${PROJECT}_`, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function call(operationId: string, inputSecrets?: string[]): unknown {
  return {
    operationId, direction: 'call', kind: 'command', description: operationId,
    inputType: 'In', outputType: 'Out', methods: ['POST'],
    uses: { settings: [], secrets: [], ...(inputSecrets ? { inputSecrets } : {}) }, reply: 'now',
  };
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
  writeText(`l4/${OWNER}/integration.defs.js`, `export default ${JSON.stringify({ externalSystems: [{ id: 'botSystem', title: 'Bot', description: 'Bot.', settings: [], operations: [] }] })};\n`);
  writeText(`l1/${OWNER}/layer_1_external/connections/botSystem.js`, `export default ${JSON.stringify({
    schemaVersion: 'external-system-v1',
    systemId: 'botSystem',
    title: 'Bot',
    description: 'Bot.',
    hosts: [{ host: 'api.bot.test' }],
    settings: [],
    operations: [
      call('sendText', ['accessKey']),
      call('plain'),
      call('echoMessage', ['accessKey']),
      call('echoOutput', ['accessKey']),
    ],
  })};\n`);
  writeText(`l1/${OWNER}/layer_1_external/connections/botSystemAdapter.js`, `
    const send = (id, input, ctx) => ctx.send(id, { method: 'POST', path: '/bot' + encodeURIComponent(input.accessKey) + '/sendMessage' });
    export default {
      async sendText(input, ctx) { return send('sendText', input, ctx); },
      async plain(input, ctx) { return ctx.send('plain', { method: 'POST', path: '/bot' + encodeURIComponent(input.accessKey) + '/sendMessage' }); },
      async echoMessage(input) { return { ok: false, code: 'invalid', message: 'bad key ' + input.accessKey + ' / ' + encodeURIComponent(input.accessKey) }; },
      async echoOutput(input) { return { ok: true, output: { echoed: input.accessKey } }; },
    };
  `);
  previousCwd = process.cwd();
  process.chdir(root);
});

after(() => {
  process.chdir(previousCwd);
  rmSync(root, { recursive: true, force: true });
});

function harness(transport?: (call: ExternalTransportCall) => Promise<ExternalTransportResponse>) {
  const calls: ExternalTransportCall[] = [];
  const records: ExternalRecordEvent[] = [];
  const lines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  const sender = createExternalSender({
    declarationOf: async (ref) => (await import('/_102034_/l1/server/layer_1_external/connections/external/productionExternalSender.js')).releaseDeclarationOf(ref),
    settingOf: () => null,
    secretOf: () => null,
    record: (event) => { records.push(event); },
    resolveHost: async () => ['8.8.8.8'],
    transport: async (sent) => {
      calls.push(sent);
      return transport ? transport(sent) : { status: 200, headers: {}, body: '{"ok":true}' };
    },
  });
  const caller = createConnectionCaller({
    projectId: PROJECT,
    catalogOf: async () => undefined,
    transports: {},
    sender,
    log: (line: string) => { lines.push(line); },
  });
  return { calls, records, lines, caller, restore: () => { console.log = originalLog; console.error = originalError; } };
}

function clean(...values: unknown[]): void {
  const text = JSON.stringify(values);
  assert.equal(text.includes(KEY), false, 'the raw key is in the output');
  assert.equal(text.includes(KEY_ENCODED), false, 'the encoded key is in the output');
}

describe('rt318: inputSecrets', () => {
  it('ok: the transport gets the real key; the record, the result and the log do not carry it', async () => {
    const box = harness();
    try {
      const result = await box.caller('botSystem', 'sendText', { accessKey: KEY, text: 'hi' }, context);
      assert.equal(result.ok, true);
      assert.equal(box.calls[0]?.url, `https://api.bot.test/bot${KEY_ENCODED}/sendMessage`);
      assert.equal(box.records[0]?.path, '/bot***/sendMessage');
      clean(result, box.records, box.lines);
    } finally { box.restore(); }
  });

  it('http 401 (refused) and a transport timeout (unavailable) leave no key in the record', async () => {
    for (const mode of ['401', 'timeout'] as const) {
      const box = harness(async () => {
        if (mode === '401') return { status: 401, headers: {}, body: `{"description":"bad ${KEY}"}` };
        throw Object.assign(new Error(`timed out ${KEY}`), { name: 'TimeoutError' });
      });
      try {
        const result = await box.caller('botSystem', 'sendText', { accessKey: KEY }, context);
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.code, mode === '401' ? 'refused' : 'unavailable');
        assert.equal(box.records[0]?.path, '/bot***/sendMessage');
        clean(result, box.records, box.lines);
      } finally { box.restore(); }
    }
  });

  it('a response that echoes the key is redacted in the body', async () => {
    const box = harness(async () => ({ status: 200, headers: { 'x-echo': KEY }, body: `{"k":"${KEY}","e":"${KEY_ENCODED}"}` }));
    try {
      const result = await box.caller('botSystem', 'sendText', { accessKey: KEY }, context);
      assert.equal(result.ok, true);
      clean(result, box.records, box.lines);
    } finally { box.restore(); }
  });

  it('an adapter that answers invalid with the key in the message leaves with ***', async () => {
    const box = harness();
    try {
      const result = await box.caller('botSystem', 'echoMessage', { accessKey: KEY }, context);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.message, 'bad key *** / ***');
      clean(result, box.lines);
    } finally { box.restore(); }
  });

  it('an adapter that puts the key in the output is invalid, and the output is not returned', async () => {
    const box = harness();
    try {
      const result = await box.caller('botSystem', 'echoOutput', { accessKey: KEY }, context);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, 'invalid');
        assert.match(result.message, /output carries an input secret/);
      }
      clean(result, box.lines);
    } finally { box.restore(); }
  });

  it('a value of 5 characters, or one that is not text, is refused and nothing is sent', async () => {
    for (const accessKey of ['12345', 42]) {
      const box = harness();
      try {
        const result = await box.caller('botSystem', 'sendText', { accessKey }, context);
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.equal(result.code, 'invalid');
          assert.match(result.message, /input secret accessKey is not a secret value/);
        }
        assert.equal(box.calls.length, 0);
        assert.equal(box.records.length, 0);
      } finally { box.restore(); }
    }
  });

  it('an absent field is ignored, and an operation without inputSecrets is not touched', async () => {
    const box = harness();
    try {
      const absent = await box.caller('botSystem', 'sendText', { accessKey: undefined, text: 'x' }, context);
      assert.equal(absent.ok, true);
      const plain = await box.caller('botSystem', 'plain', { accessKey: 'short' }, context);
      assert.equal(plain.ok, true);
      assert.equal(box.records[1]?.path, '/botshort/sendMessage');
    } finally { box.restore(); }
  });
});
