/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/externalGeneratedSecretTelegram.test.ts" enhancement="_blank" />
// rt331 s2, end to end with the REAL adapter and declaration of the telegram of mls-102047 (only `incomingMessageSecret` is marked `generated`
// here: that is what the New Release will do): `setMessageDelivery` makes the secret and sends it as `secret_token`; the hook checks the same one.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import telegramAdapter from '/_102047_/l1/telegram/layer_1_external/connections/telegramAdapter.js';
import telegramDeclaration from '/_102047_/l1/telegram/layer_1_external/connections/telegram.js';
import { createFakeAdapterContext } from '/_102034_/testing/connections/externalFixtures.js';
import { createExternalSettingsStore, memorySettingsDb } from '/_102034_/l1/server/layer_1_external/connections/external/externalSettingsStore.js';
import { createExternalSender, type ExternalRecordEvent, type ExternalRef } from '/_102034_/l1/server/layer_1_external/connections/external/sendExternal.js';
import { handleExternalHook, type ExternalHookDeps } from '/_102034_/l1/server/layer_1_external/connections/external/externalHook.js';
import type { ExternalSystemDeclaration } from '/_102034_/l2/shared/contracts/connections/externalSystem.js';

const declaration: ExternalSystemDeclaration = {
  ...telegramDeclaration,
  settings: telegramDeclaration.settings.map((item) => (item.id === 'incomingMessageSecret' ? { ...item, generated: true as const } : item)),
};
const ref: ExternalRef = { projectId: '102047', moduleId: 'telegram', systemId: 'telegram' };
const KEY = randomBytes(32);
const HOOK = 'https://102047.collabcodes.com/hook/102047/telegram/telegram/messageArrived';

describe('rt331 s2: the telegram, the generated secret and the hook', () => {
  it('setMessageDelivery makes the secret and sends it as secret_token; the hook accepts that value (200) and refuses another (401)', async () => {
    const lines: string[] = [];
    const store = createExternalSettingsStore({ declarationOf: () => declaration, moduleOf: () => 'telegram', db: memorySettingsDb(), key: KEY, log: (line) => lines.push(line) });
    const sent: Array<{ path: string; body: string }> = [];
    const events: ExternalRecordEvent[] = [];
    const sender = createExternalSender({
      declarationOf: () => declaration,
      settingOf: async () => null,
      secretOf: async (r, id) => { const read = await store.secretOf(r, id); return read.ok ? read.value ?? null : null; },
      ensureSecret: async (r, id) => { const read = await store.ensureGeneratedSecret(r, id); return read.ok ? read.value ?? null : null; },
      record: (event) => { events.push(event); },
      transport: async (call) => {
        sent.push({ path: call.url, body: call.body ?? '' });
        return { status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true,"result":true}' };
      },
      resolveHost: async () => ['149.154.167.220'],
    });
    const ctx = createFakeAdapterContext({ sender, ref, hookUrls: { messageArrived: HOOK } });

    const done = await telegramAdapter.setMessageDelivery?.({ botId: 'bot-7', botAccessKey: '123456:ABC-key' }, ctx);
    assert.equal(done?.ok, true, JSON.stringify(done));
    const body = JSON.parse(sent[0]?.body ?? '{}') as { secret_token?: string; url?: string };
    assert.match(body.secret_token ?? '', /^[A-Za-z0-9_-]{43}$/u, 'the secret_token that goes to Telegram is the one the platform made');
    assert.equal(body.url, `${HOOK}?bot=bot-7`);

    const read = await store.secretOf(ref, 'incomingMessageSecret');
    assert.deepEqual(read, { ok: true, value: body.secret_token });

    // The hook, with the same store: the header with that value passes, another does not.
    const seen = new Set<string>();
    const deps: ExternalHookDeps = {
      declarationOf: async () => declaration,
      secretOf: async (r, id) => { const got = await store.secretOf(r, id); return got.ok ? got.value ?? null : null; },
      seen: async (notice) => (seen.has(notice.noticeId) ? false : (seen.add(notice.noticeId), true)),
      forget: async (notice) => { seen.delete(notice.noticeId); },
      organizationOf: () => 'org-1',
      record: async () => undefined,
      deliver: async () => ({ ok: true, output: {} }),
      now: () => new Date('2026-11-27T12:00:00.000Z'),
      allow: () => true,
      log: () => undefined,
    };
    const target = { projectId: '102047', moduleId: 'telegram', systemId: 'telegram', operationId: 'messageArrived' };
    const payload = Buffer.from(JSON.stringify({ update_id: 1, message: { message_id: 1, date: 1, chat: { id: 5, type: 'private' }, text: 'oi' } }));
    const good = await handleExternalHook({ target, rawBody: payload, headers: { 'x-telegram-bot-api-secret-token': body.secret_token ?? '' }, query: { bot: 'bot-7' }, remoteAddress: '1.2.3.4' }, deps);
    assert.equal(good.status, 200);
    const bad = await handleExternalHook({ target, rawBody: payload, headers: { 'x-telegram-bot-api-secret-token': 'another-value' }, query: { bot: 'bot-7' }, remoteAddress: '1.2.3.4' }, deps);
    assert.equal(bad.status, 401);

    // The secret is in no log line, no record of the call.
    const value = body.secret_token ?? 'x';
    assert.equal(JSON.stringify(events).includes(value), false, 'not in the record');
    assert.equal(lines.some((line) => line.includes(value)), false, 'not in the log');
  });
});
