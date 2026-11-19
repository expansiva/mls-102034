/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/productionExternalSender.ts" enhancement="_blank"/>
/**
 * The production door. The declaration is the one in the active release.
 * Settings and secrets come from the platform table. A new release is a new process.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { resolveProjectDistPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { getSharedPgPool } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import { moduleSystemsIndex } from '/_102034_/l1/server/layer_1_external/connections/moduleSystemsIndex.js';
import { nodeExternalTransport, nodeResolveHost } from '/_102034_/l1/server/layer_1_external/connections/external/nodeExternalTransport.js';
import {
  writeExternalCallPair,
  type ExternalCallDb,
  type ExternalCallRow,
} from '/_102034_/l1/server/layer_1_external/connections/external/externalCallStore.js';
import {
  createExternalSettingsStore,
  memorySettingsDb,
  readSecretsKey,
  type ExternalSettingsStore,
} from '/_102034_/l1/server/layer_1_external/connections/external/externalSettingsStore.js';
import {
  createExternalSender,
  type ExternalRecordEvent,
  type ExternalRef,
  type ExternalSender,
} from '/_102034_/l1/server/layer_1_external/connections/external/sendExternal.js';
import {
  externalSystemDeclarationFile,
  validateExternalSystemDeclaration,
  type ExternalSystemDeclaration,
} from '/_102034_/l1/server/layer_1_external/connections/external/types.js';

const SAFE_NAME = /^[a-z][A-Za-z0-9]*$/u;
const declarations = new Map<string, ExternalSystemDeclaration | null>();
let settingsStore: ExternalSettingsStore | undefined;

function cacheKey(ref: ExternalRef): string {
  return `${ref.projectId}\0${ref.moduleId}\0${ref.systemId}`;
}

/** The declaration shipped in the active release, or null when the file is missing or does not validate. */
export async function releaseDeclarationOf(ref: ExternalRef): Promise<ExternalSystemDeclaration | null> {
  // The ref names a path under dist/local that gets imported: it must be plain ids, never a path.
  if (!/^\d+$/u.test(ref.projectId) || !SAFE_NAME.test(ref.moduleId) || !SAFE_NAME.test(ref.systemId)) {
    console.warn(`[external] declaration refused: ref is not made of plain ids (${ref.systemId.slice(0, 40)})`);
    return null;
  }
  const key = cacheKey(ref);
  const cached = declarations.get(key);
  if (cached !== undefined) return cached;

  const relative = externalSystemDeclarationFile(ref.moduleId, ref.systemId).replace(/\.ts$/u, '.js');
  const filePath = resolveProjectDistPath(`_${ref.projectId}_/${relative}`);
  // A missing file is not cached: on the public hook the ref is chosen by the caller, so caching it would let anyone grow the map.
  if (!existsSync(filePath)) return null;

  let loaded: unknown;
  try {
    const imported = await import(pathToFileURL(filePath).href) as { default?: unknown };
    loaded = imported.default;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'import failed';
    console.warn(`[external] declaration invalid ${ref.systemId}: ${message}`);
    declarations.set(key, null);
    return null;
  }

  const problems = validateExternalSystemDeclaration(loaded);
  if (problems.length > 0) {
    console.warn(`[external] declaration invalid ${ref.systemId}: ${problems.map((item) => item.message).join('; ')}`);
    declarations.set(key, null);
    return null;
  }

  const declaration = loaded as ExternalSystemDeclaration;
  declarations.set(key, declaration);
  return declaration;
}

function callDb(): ExternalCallDb | null {
  const env = readAppEnv();
  if (env.runtimeMode !== 'postgres') return null;
  return { query: (sql, params) => getSharedPgPool(env).query(sql, params as never[]) };
}

/** The row that is stored. Only the fields of the event; never a body, a header or a setting value. */
export function externalCallRowFromEvent(event: ExternalRecordEvent): ExternalCallRow {
  return {
    id: randomUUID(),
    occurredAt: new Date().toISOString(),
    direction: 'out',
    projectId: event.projectId,
    moduleId: event.moduleId,
    systemId: event.systemId,
    operationId: event.operationId,
    server: event.server,
    path: event.path,
    outcome: event.outcome,
    denialReason: event.denialReason,
    httpStatus: event.status ?? null,
    durationMs: event.durationMs,
    bytes: event.bytes,
    actorKind: event.actorKind,
    actorId: event.actorId,
    requestId: null,
  };
}

function productionSettings(): ExternalSettingsStore {
  if (settingsStore) return settingsStore;
  const env = readAppEnv();
  const db = env.runtimeMode === 'postgres'
    ? { query: (sql: string, params?: readonly unknown[]) => getSharedPgPool(env).query(sql, params as never[]) }
    : memorySettingsDb();
  settingsStore = createExternalSettingsStore({
    declarationOf: releaseDeclarationOf,
    moduleOf: async (projectId, systemId) => (await moduleSystemsIndex(projectId)).get(systemId) ?? null,
    db,
    key: readSecretsKey(),
  });
  return settingsStore;
}

/** The secret named by a declaration, opened for the inbound hook. `null` when it cannot be read. */
export async function productionSecretOf(ref: ExternalRef, settingId: string): Promise<string | null> {
  const read = await productionSettings().secretOf(ref, settingId);
  if (!read.ok) return null;
  return read.value ?? null;
}

/** The only way the server obtains `sendExternal` in production. */
export function createProductionExternalSender(db: ExternalCallDb | null = callDb()): ExternalSender {
  const settings = productionSettings();
  return createExternalSender({
    declarationOf: releaseDeclarationOf,
    settingOf: async (ref, id) => (await settings.settingOf(ref, id)) ?? null,
    secretOf: async (ref, id) => {
      const read = await settings.secretOf(ref, id);
      if (!read.ok) return null;
      return read.value ?? null;
    },
    async record(event: ExternalRecordEvent): Promise<void> {
      if (!db) return;
      await writeExternalCallPair(db, externalCallRowFromEvent(event));
    },
    transport: nodeExternalTransport,
    resolveHost: nodeResolveHost,
  });
}
