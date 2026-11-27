/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/externalSettingsStore.ts" enhancement="_blank" />
/**
 * Configuration of an outside system, one row per project.
 * A secret is AES-256-GCM with a fresh IV. The key is one per VM, read from COLLAB_SECRETS_KEY_FILE.
 * Without that key the server still starts; writing or reading a secret answers `disabled` and never stores plaintext.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { TableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import type { ExternalRef } from '/_102034_/l1/server/layer_1_external/connections/external/sendExternal.js';
import type { ExternalSystemDeclaration } from '/_102034_/l2/shared/contracts/connections/externalSystem.js';

export const EXTERNAL_SETTINGS_TABLE = 'platform_external_settings';

const SEALED = 'enc1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export const externalSettingsDefinition: TableDefinition = {
  moduleId: 'platformExternalSettings',
  repositoryName: EXTERNAL_SETTINGS_TABLE,
  tableName: EXTERNAL_SETTINGS_TABLE,
  purpose: 'controle',
  description: 'Configuration of an outside system, kept per project. A secret is stored sealed. The row is platform data and is not dropped when a release changes.',
  backupHot: false,
  storageProfile: 'postgres',
  writeMode: 'sync',
  columns: [
    { name: 'projectId', postgresType: 'TEXT' },
    { name: 'systemId', postgresType: 'TEXT' },
    { name: 'settingId', postgresType: 'TEXT' },
    { name: 'value', postgresType: 'TEXT' },
    { name: 'secret', postgresType: 'BOOLEAN' },
    { name: 'writtenBy', postgresType: 'TEXT' },
    { name: 'writtenAt', postgresType: 'TIMESTAMPTZ' },
  ],
  primaryKey: ['projectId', 'systemId', 'settingId'],
  version: 1,
};

export interface ExternalSettingsDb {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: unknown[] }>;
}

export interface ExternalSettingStatus {
  settingId: string;
  filled: boolean;
}

export type ExternalSettingWrite =
  | { ok: true }
  | { ok: false; code: 'disabled' }
  | { ok: false; code: 'refused' }
  /** The setting is `generated`: the platform makes the value, nobody writes it. */
  | { ok: false; code: 'generated' };

export type ExternalSecretRead =
  | { ok: true; value: string | undefined }
  | { ok: false; code: 'disabled' };

export interface ExternalSettingsStore {
  set(ref: ExternalRef, settingId: string, value: string, by: string): Promise<ExternalSettingWrite>;
  status(projectId: string, systemId: string): Promise<ExternalSettingStatus[]>;
  settingOf(ref: ExternalRef, settingId: string): Promise<string | undefined>;
  secretOf(ref: ExternalRef, settingId: string): Promise<ExternalSecretRead>;
  /**
   * The value of a `generated` secret: the one already stored (by hand too), or a new one made now (32 random bytes, base64url) and kept
   * only if there is none (`INSERT … ON CONFLICT DO NOTHING`, then read again): two callers at once get the same value.
   * Not generated without the key of the VM (`disabled`).
   */
  ensureGeneratedSecret(ref: ExternalRef, settingId: string, by?: string): Promise<ExternalSecretRead>;
  /** Deletes the value of a declared setting. On a `generated` secret it is the swap: the next outbound call makes another. */
  clear(ref: ExternalRef, settingId: string, by: string): Promise<{ ok: true } | { ok: false; code: 'refused' }>;
}

export interface ExternalSettingsDeps {
  declarationOf(ref: ExternalRef): Promise<ExternalSystemDeclaration | null> | ExternalSystemDeclaration | null;
  /** Resolves which module declared the system when `status` has no module id. */
  moduleOf?(projectId: string, systemId: string): Promise<string | null> | string | null;
  db: ExternalSettingsDb;
  /** 32 bytes, or null when the VM key is absent. */
  key: Buffer | null;
  now?: () => Date;
  log?: (line: string) => void;
}

interface StoredSetting {
  settingId: string;
  value: string;
  secret: boolean;
}

let disabledLogged = false;

/** One clear line. The line never contains a setting value. */
export function noteSecretsDisabled(log: (line: string) => void = (line) => { console.warn(line); }): void {
  if (disabledLogged) return;
  disabledLogged = true;
  log('[external] secrets disabled: COLLAB_SECRETS_KEY_FILE is missing or is not 32 bytes');
}

/** Reads the VM key. A missing or wrong file leaves the vault disabled and does not throw. */
export function readSecretsKey(log?: (line: string) => void): Buffer | null {
  const file = process.env.COLLAB_SECRETS_KEY_FILE;
  if (!file) {
    noteSecretsDisabled(log);
    return null;
  }
  try {
    const bytes = readFileSync(file);
    if (bytes.length !== KEY_BYTES) {
      noteSecretsDisabled(log);
      return null;
    }
    return bytes;
  } catch {
    noteSecretsDisabled(log);
    return null;
  }
}

/**
 * The place a sealed value belongs to, authenticated with it (GCM associated data). Without this, someone who can write
 * the table could copy the sealed text of one setting (or of another project) into a row that reads it back.
 */
export function settingAad(projectId: string, systemId: string, settingId: string): string {
  return `${projectId}\0${systemId}\0${settingId}`;
}

export function sealSettingValue(key: Buffer, plain: string, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return SEALED + Buffer.concat([iv, tag, data]).toString('base64');
}

export function openSettingValue(key: Buffer, stored: string, aad: string): string | null {
  if (!stored.startsWith(SEALED)) return null;
  const buf = Buffer.from(stored.slice(SEALED.length), 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES) return null;
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const data = buf.subarray(IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function quote(name: string): string {
  return `"${name}"`;
}

function rowOf(value: unknown): StoredSetting | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as { settingId?: unknown; value?: unknown; secret?: unknown };
  if (typeof row.settingId !== 'string' || typeof row.value !== 'string') return null;
  return { settingId: row.settingId, value: row.value, secret: row.secret === true };
}

export function createExternalSettingsStore(deps: ExternalSettingsDeps): ExternalSettingsStore {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: string) => { console.warn(line); });
  const table = quote(EXTERNAL_SETTINGS_TABLE);

  async function rowsOf(projectId: string, systemId: string): Promise<StoredSetting[]> {
    const result = await deps.db.query(
      `SELECT ${quote('settingId')}, ${quote('value')}, ${quote('secret')} FROM ${table} WHERE ${quote('projectId')} = $1 AND ${quote('systemId')} = $2`,
      [projectId, systemId],
    );
    return result.rows.map(rowOf).filter((row): row is StoredSetting => row !== null);
  }

  async function declarationOf(ref: ExternalRef): Promise<ExternalSystemDeclaration | null> {
    const found = await deps.declarationOf(ref);
    if (!found || found.systemId !== ref.systemId) return null;
    return found;
  }

  return {
    async set(ref, settingId, value, by) {
      const declaration = await declarationOf(ref);
      const declared = declaration?.settings.find((item) => item.id === settingId);
      if (!declared) return { ok: false, code: 'refused' };
      if (declared.generated === true) return { ok: false, code: 'generated' };
      if (declared.secret && !deps.key) {
        noteSecretsDisabled(log);
        return { ok: false, code: 'disabled' };
      }
      const stored = declared.secret && deps.key ? sealSettingValue(deps.key, value, settingAad(ref.projectId, ref.systemId, settingId)) : value;
      await deps.db.query(
        `INSERT INTO ${table} (${quote('projectId')}, ${quote('systemId')}, ${quote('settingId')}, ${quote('value')}, ${quote('secret')}, ${quote('writtenBy')}, ${quote('writtenAt')}) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (${quote('projectId')}, ${quote('systemId')}, ${quote('settingId')}) DO UPDATE SET ${quote('value')} = EXCLUDED.${quote('value')}, ${quote('secret')} = EXCLUDED.${quote('secret')}, ${quote('writtenBy')} = EXCLUDED.${quote('writtenBy')}, ${quote('writtenAt')} = EXCLUDED.${quote('writtenAt')}`,
        [ref.projectId, ref.systemId, settingId, stored, declared.secret, by, now().toISOString()],
      );
      return { ok: true };
    },

    async clear(ref, settingId, by) {
      const declaration = await declarationOf(ref);
      if (!declaration?.settings.some((item) => item.id === settingId)) return { ok: false, code: 'refused' };
      await deps.db.query(
        `DELETE FROM ${table} WHERE ${quote('projectId')} = $1 AND ${quote('systemId')} = $2 AND ${quote('settingId')} = $3`,
        [ref.projectId, ref.systemId, settingId],
      );
      log(`[external] setting cleared ${ref.systemId}.${settingId} by ${by}`);
      return { ok: true };
    },

    async status(projectId, systemId) {
      const stored = await rowsOf(projectId, systemId);
      const filled = new Map(stored.map((row) => [row.settingId, row.value.length > 0]));
      const moduleId = deps.moduleOf ? await deps.moduleOf(projectId, systemId) : null;
      const declaration = moduleId ? await declarationOf({ projectId, moduleId, systemId }) : null;
      if (!declaration) {
        return stored.map((row) => ({ settingId: row.settingId, filled: row.value.length > 0 }));
      }
      return declaration.settings.map((item) => ({
        settingId: item.id,
        filled: filled.get(item.id) === true,
      }));
    },

    async settingOf(ref, settingId) {
      const declaration = await declarationOf(ref);
      const declared = declaration?.settings.find((item) => item.id === settingId);
      if (!declared || declared.secret) return undefined;
      const row = (await rowsOf(ref.projectId, ref.systemId)).find((item) => item.settingId === settingId);
      if (!row || row.secret) return undefined;
      return row.value;
    },

    async ensureGeneratedSecret(ref, settingId, by = 'platform:generated') {
      const declaration = await declarationOf(ref);
      const declared = declaration?.settings.find((item) => item.id === settingId);
      if (!declared?.secret || declared.generated !== true) return { ok: true, value: undefined };
      if (!deps.key) {
        noteSecretsDisabled(log);
        return { ok: false, code: 'disabled' };
      }
      const aad = settingAad(ref.projectId, ref.systemId, settingId);
      const openStored = async (): Promise<ExternalSecretRead | undefined> => {
        const row = (await rowsOf(ref.projectId, ref.systemId)).find((item) => item.settingId === settingId);
        if (!row) return undefined;
        const plain = deps.key ? openSettingValue(deps.key, row.value, aad) : null;
        if (plain === null) {
          log(`[external] secret unreadable ${ref.systemId}.${settingId}`);
          return { ok: false, code: 'disabled' };
        }
        return { ok: true, value: plain };
      };
      const existing = await openStored();
      if (existing) return existing;
      const made = randomBytes(32).toString('base64url');
      await deps.db.query(
        `INSERT INTO ${table} (${quote('projectId')}, ${quote('systemId')}, ${quote('settingId')}, ${quote('value')}, ${quote('secret')}, ${quote('writtenBy')}, ${quote('writtenAt')}) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (${quote('projectId')}, ${quote('systemId')}, ${quote('settingId')}) DO NOTHING`,
        [ref.projectId, ref.systemId, settingId, sealSettingValue(deps.key, made, aad), true, by, now().toISOString()],
      );
      // Read again: when another caller won the race, its value is the one that stays.
      return (await openStored()) ?? { ok: false, code: 'disabled' };
    },

    async secretOf(ref, settingId) {
      const declaration = await declarationOf(ref);
      const declared = declaration?.settings.find((item) => item.id === settingId);
      if (!declared?.secret) return { ok: true, value: undefined };
      if (!deps.key) {
        noteSecretsDisabled(log);
        return { ok: false, code: 'disabled' };
      }
      const row = (await rowsOf(ref.projectId, ref.systemId)).find((item) => item.settingId === settingId);
      if (!row) return { ok: true, value: undefined };
      const plain = openSettingValue(deps.key, row.value, settingAad(ref.projectId, ref.systemId, settingId));
      if (plain === null) {
        log(`[external] secret unreadable ${ref.systemId}.${settingId}`);
        return { ok: false, code: 'disabled' };
      }
      return { ok: true, value: plain };
    },
  };
}

/** In-process table used when the server is not on Postgres. */
export function memorySettingsDb(): ExternalSettingsDb {
  const rows = new Map<string, { value: string; secret: boolean; writtenBy: string; writtenAt: string }>();
  return {
    async query(sql, params = []) {
      if (sql.startsWith('DELETE')) {
        rows.delete(`${String(params[0])}\0${String(params[1])}\0${String(params[2])}`);
        return { rows: [] };
      }
      if (sql.startsWith('SELECT')) {
        const projectId = String(params[0]);
        const systemId = String(params[1]);
        const found: StoredSetting[] = [];
        for (const [key, row] of rows) {
          const [project, system, settingId] = key.split('\0');
          if (project === projectId && system === systemId && settingId) {
            found.push({ settingId, value: row.value, secret: row.secret });
          }
        }
        return { rows: found };
      }
      const [projectId, systemId, settingId, value, secret, writtenBy, writtenAt] = params;
      const rowKey = `${String(projectId)}\0${String(systemId)}\0${String(settingId)}`;
      if (sql.includes('DO NOTHING') && rows.has(rowKey)) return { rows: [] };
      rows.set(rowKey, {
        value: String(value),
        secret: secret === true,
        writtenBy: String(writtenBy),
        writtenAt: String(writtenAt),
      });
      return { rows: [] };
    },
  };
}
