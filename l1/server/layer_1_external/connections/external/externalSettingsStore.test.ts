/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/externalSettingsStore.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exampleExternalSystem } from '/_102034_/testing/connections/externalFixtures.js';
import type { ExternalRef } from '/_102034_/l1/server/layer_1_external/connections/external/sendExternal.js';
import type { ExternalSystemDeclaration } from '/_102034_/l1/server/layer_1_external/connections/external/types.js';
import { tableDefinitions } from '/_102034_/l1/server/persistence.js';
import {
  EXTERNAL_SETTINGS_TABLE,
  createExternalSettingsStore,
  memorySettingsDb,
  openSettingValue,
  settingAad,
  readSecretsKey,
  sealSettingValue,
  type ExternalSettingsDb,
} from '/_102034_/l1/server/layer_1_external/connections/external/externalSettingsStore.js';

const KEY = randomBytes(32);
const SECRET = 'sk_live_do_not_log';
const ref: ExternalRef = { projectId: '102034', moduleId: 'exampleModule', systemId: exampleExternalSystem.systemId };

function storeFor(key: Buffer | null, lines: string[]) {
  const db = memorySettingsDb();
  const stored: string[] = [];
  const recording: ExternalSettingsDb = {
    async query(sql, params = []) {
      stored.push(JSON.stringify(params));
      return db.query(sql, params);
    },
  };
  const store = createExternalSettingsStore({
    declarationOf: () => exampleExternalSystem,
    moduleOf: () => ref.moduleId,
    db: recording,
    key,
    log: (line) => { lines.push(line); },
  });
  return { store, stored };
}

describe('external settings vault', () => {
  it('seals and opens, and a second seal of the same text uses another IV', () => {
    const aad = settingAad('p', 'sys', 'apiKey');
    const first = sealSettingValue(KEY, SECRET, aad);
    const second = sealSettingValue(KEY, SECRET, aad);
    assert.notEqual(first, second);
    assert.equal(openSettingValue(KEY, first, aad), SECRET);
    assert.equal(openSettingValue(KEY, second, aad), SECRET);
    assert.equal(openSettingValue(randomBytes(32), first, aad), null);
  });

  it('a sealed value does not open in another setting, system or project', () => {
    const sealed = sealSettingValue(KEY, SECRET, settingAad('p', 'sys', 'apiKey'));
    assert.equal(openSettingValue(KEY, sealed, settingAad('p', 'sys', 'apiKey')), SECRET);
    assert.equal(openSettingValue(KEY, sealed, settingAad('p', 'sys', 'otherKey')), null);
    assert.equal(openSettingValue(KEY, sealed, settingAad('p', 'other', 'apiKey')), null);
    assert.equal(openSettingValue(KEY, sealed, settingAad('q', 'sys', 'apiKey')), null);
  });

  it('keeps the table on the platform registry with the project, system and setting as the key', () => {
    const found = tableDefinitions.find((item) => item.tableName === EXTERNAL_SETTINGS_TABLE);
    assert.ok(found);
    assert.equal(found.moduleId, 'platform');
    assert.deepEqual(found.primaryKey, ['projectId', 'systemId', 'settingId']);
  });

  it('refuses an item the declaration does not list', async () => {
    const lines: string[] = [];
    const { store, stored } = storeFor(KEY, lines);
    const result = await store.set(ref, 'notDeclared', SECRET, 'admin');
    assert.deepEqual(result, { ok: false, code: 'refused' });
    assert.equal(stored.length, 0);
  });

  it('answers disabled without storing plaintext when the key is missing', async () => {
    const lines: string[] = [];
    const { store, stored } = storeFor(null, lines);
    const written = await store.set(ref, 'signingKey', SECRET, 'admin');
    const read = await store.secretOf(ref, 'signingKey');
    assert.deepEqual(written, { ok: false, code: 'disabled' });
    assert.deepEqual(read, { ok: false, code: 'disabled' });
    assert.equal(stored.some((line) => line.includes(SECRET)), false);
    assert.equal(lines.some((line) => line.includes(SECRET)), false);
    assert.match(lines[0] ?? '', /secrets disabled/);
    const plain = await store.set(ref, 'account', 'acme', 'admin');
    assert.deepEqual(plain, { ok: true });
    assert.equal(await store.settingOf(ref, 'account'), 'acme');
  });

  it('never returns a secret value from status or from settingOf', async () => {
    const lines: string[] = [];
    const { store } = storeFor(KEY, lines);
    assert.deepEqual(await store.set(ref, 'signingKey', SECRET, 'admin'), { ok: true });
    assert.deepEqual(await store.set(ref, 'account', 'acme', 'admin'), { ok: true });
    const status = await store.status(ref.projectId, ref.systemId);
    assert.deepEqual(status, [
      { settingId: 'account', filled: true },
      { settingId: 'signingKey', filled: true },
    ]);
    assert.equal(JSON.stringify(status).includes(SECRET), false);
    assert.equal(await store.settingOf(ref, 'signingKey'), undefined);
    const secret = await store.secretOf(ref, 'signingKey');
    assert.deepEqual(secret, { ok: true, value: SECRET });
    assert.equal(lines.some((line) => line.includes(SECRET)), false);
  });

  it('copies secret from the declaration and does not log the value', async () => {
    const lines: string[] = [];
    const declaration: ExternalSystemDeclaration = {
      ...exampleExternalSystem,
      settings: [{ id: 'account', secret: true }],
    };
    const db = memorySettingsDb();
    const blobs: string[] = [];
    const store = createExternalSettingsStore({
      declarationOf: () => declaration,
      db: {
        async query(sql, params = []) {
          if (typeof params[3] === 'string') blobs.push(params[3]);
          return db.query(sql, params);
        },
      },
      key: KEY,
      log: (line) => { lines.push(line); },
    });
    await store.set(ref, 'account', SECRET, 'admin');
    await store.set(ref, 'account', SECRET, 'admin');
    assert.equal(blobs.length, 2);
    assert.notEqual(blobs[0], blobs[1]);
    assert.equal(blobs.every((item) => item.startsWith('enc1:') && !item.includes(SECRET)), true);
    assert.equal(await store.settingOf(ref, 'account'), undefined);
    assert.equal(lines.some((line) => line.includes(SECRET)), false);
  });

  it('reads a 32-byte key file and stays disabled when the file is absent', () => {
    const previous = process.env.COLLAB_SECRETS_KEY_FILE;
    const dir = mkdtempSync(path.join(tmpdir(), 'secrets-key-'));
    const file = path.join(dir, 'collab-secrets.key');
    writeFileSync(file, KEY);
    const lines: string[] = [];
    try {
      process.env.COLLAB_SECRETS_KEY_FILE = file;
      const loaded = readSecretsKey((line) => { lines.push(line); });
      assert.ok(loaded);
      assert.equal(loaded.equals(KEY), true);
      delete process.env.COLLAB_SECRETS_KEY_FILE;
      assert.equal(readSecretsKey((line) => { lines.push(line); }), null);
      assert.equal(lines.some((line) => line.includes(SECRET) || line.includes(file)), false);
    } finally {
      if (previous === undefined) delete process.env.COLLAB_SECRETS_KEY_FILE;
      else process.env.COLLAB_SECRETS_KEY_FILE = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
