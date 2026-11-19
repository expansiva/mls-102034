/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/externalCallRecord.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConnectionContext } from '/_102034_/l1/server/layer_1_external/connections/catalogs/types.js';
import {
  EXTERNAL_CALL_AUDIT_TABLE,
  EXTERNAL_CALL_LOG_TABLE,
  externalCallWriteFailureCount,
  writeExternalCallPair,
  type ExternalCallDb,
} from '/_102034_/l1/server/layer_1_external/connections/external/externalCallStore.js';
import {
  createProductionExternalSender,
  externalCallRowFromEvent,
} from '/_102034_/l1/server/layer_1_external/connections/external/productionExternalSender.js';
import { createExternalSender } from '/_102034_/l1/server/layer_1_external/connections/external/sendExternal.js';
import { exampleExternalSystem } from '/_102034_/testing/connections/externalFixtures.js';

const SECRET = 'sk_live_class_secret';
const BODY = 'body-class-secret-payload';
const SETTING = 'account-value-class';
const context: ConnectionContext = { organizationId: 'org' };

function capturingDb(): ExternalCallDb & { params: unknown[][]; tables: string[] } {
  const params: unknown[][] = [];
  const tables: string[] = [];
  return {
    params,
    tables,
    async query(sql, values) {
      tables.push(sql);
      params.push([...(values ?? [])]);
      return { rows: [] };
    },
  };
}

describe('external call record', () => {
  it('the production record writes the log and the audit', async () => {
    const db = capturingDb();
    const sender = createProductionExternalSender(db);
    const lines: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
      const result = await sender.sendExternal(
        { projectId: '900264', moduleId: 'missing', systemId: 'example' },
        'notify',
        { method: 'POST', path: '/notify', body: BODY, headers: { authorization: SECRET } },
        context,
      );
      assert.equal(result.ok, false);
    } finally {
      console.log = log;
    }
    assert.equal(db.tables.length, 2);
    assert.match(db.tables[0] ?? '', new RegExp(EXTERNAL_CALL_LOG_TABLE));
    assert.match(db.tables[1] ?? '', new RegExp(EXTERNAL_CALL_AUDIT_TABLE));
    const stored = JSON.stringify(db.params);
    assert.equal(stored.includes(SECRET), false);
    assert.equal(stored.includes(BODY), false);
    assert.equal(lines.join('\n').includes(SECRET), false);
  });

  it('a stored row has no body, header or setting value, and a failed write does not drop the call', async () => {
    const db = capturingDb();
    const sender = createExternalSender({
      declarationOf: () => exampleExternalSystem,
      settingOf: () => SETTING,
      secretOf: () => SECRET,
      record: async (event) => {
        await writeExternalCallPair(db, externalCallRowFromEvent(event));
      },
      resolveHost: async () => ['8.8.8.8'],
      transport: async () => ({ status: 200, headers: { 'x-echo': SECRET }, body: `{"echo":"${SECRET}","body":"${BODY}","setting":"${SETTING}"}` }),
    });
    const log = console.log;
    console.log = () => {};
    let result: Awaited<ReturnType<typeof sender.sendExternal>>;
    try {
      result = await sender.sendExternal(
        { projectId: '900264', moduleId: 'orders', systemId: 'example' },
        'notify',
        {
          method: 'POST',
          path: '/notify',
          headers: { authorization: `Bearer ${SECRET}` },
          body: JSON.stringify({ text: BODY, key: SECRET, account: SETTING }),
        },
        context,
      );
    } finally {
      console.log = log;
    }
    assert.equal(result.ok, true);
    const stored = JSON.stringify(db.params);
    assert.equal(stored.includes(SECRET), false);
    assert.equal(stored.includes(BODY), false);
    assert.equal(stored.includes(SETTING), false);
    assert.match(stored, /example\.test/);
    assert.match(stored, /\/notify/);

    const failing: ExternalCallDb = {
      query: async () => { throw new Error('insert down'); },
    };
    const before = externalCallWriteFailureCount();
    const error = console.error;
    console.error = () => {};
    console.log = () => {};
    try {
      const again = await createExternalSender({
        declarationOf: () => exampleExternalSystem,
        settingOf: () => null,
        secretOf: () => null,
        record: async (event) => { await writeExternalCallPair(failing, externalCallRowFromEvent(event)); },
        resolveHost: async () => ['8.8.8.8'],
        transport: async () => ({ status: 200, headers: {}, body: '{"ok":true}' }),
      }).sendExternal(
        { projectId: '900264', moduleId: 'orders', systemId: 'example' },
        'lookup',
        { method: 'GET', path: '/lookup' },
        context,
      );
      assert.equal(again.ok, true);
    } finally {
      console.error = error;
      console.log = log;
    }
    assert.equal(externalCallWriteFailureCount() - before, 2);
  });

  it('the event carries the time, the bytes, the reason and the person, and still no body, header or value', async () => {
    const events: Array<Parameters<typeof externalCallRowFromEvent>[0]> = [];
    const sender = createExternalSender({
      declarationOf: () => exampleExternalSystem,
      settingOf: (_ref, id) => (id === 'account' ? SETTING : null),
      secretOf: () => SECRET,
      record: (event) => { events.push(event); },
      resolveHost: async () => ['8.8.8.8'],
      transport: async () => ({ status: 200, headers: {}, body: `{"echo":"${BODY}"}` }),
    });
    const ref = { projectId: 'p', moduleId: 'module', systemId: 'example' };
    const ok = await sender.sendExternal(ref, 'lookup', { method: 'GET', path: '/lookup', query: { key: '{{setting:account}}' } }, { ...context, actorUserId: 'person-9' });
    assert.equal(ok.ok, true);
    const denied = await sender.sendExternal(ref, 'lookup', { method: 'DELETE', path: '/lookup' }, { ...context, agentId: 'agent-3' });
    assert.equal(denied.ok, false);
    assert.equal(events.length, 2);
    const [done, refused] = events;
    assert.equal(done?.actorKind, 'person');
    assert.equal(done?.actorId, 'person-9');
    assert.equal(done?.denialReason, null);
    assert.ok((done?.bytes ?? 0) >= BODY.length);
    assert.ok((done?.durationMs ?? -1) >= 0);
    assert.equal(refused?.actorKind, 'agent');
    assert.equal(refused?.actorId, 'agent-3');
    assert.match(refused?.denialReason ?? '', /method is not declared/);
    const stored = JSON.stringify(events.map(externalCallRowFromEvent));
    for (const known of [SECRET, BODY, SETTING]) assert.equal(stored.includes(known), false, known);
  });
});
