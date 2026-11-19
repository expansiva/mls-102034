/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/productionExternalSender.ts" enhancement="_blank"/>
/**
 * The production door. The declaration is the one in the active release.
 * Settings and secrets stay empty until they have a store. A new release is a new process.
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolveProjectDistPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { nodeExternalTransport, nodeResolveHost } from '/_102034_/l1/server/layer_1_external/connections/external/nodeExternalTransport.js';
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
const configLogged = new Set<string>();

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
  if (!existsSync(filePath)) {
    declarations.set(key, null);
    return null;
  }

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

function notConfigured(ref: ExternalRef): null {
  if (!configLogged.has(ref.systemId)) {
    configLogged.add(ref.systemId);
    console.warn(`[external] ${ref.systemId} configuração ainda não disponível (R3)`);
  }
  return null;
}

/** The only way the server obtains `sendExternal` in production. */
export function createProductionExternalSender(): ExternalSender {
  return createExternalSender({
    declarationOf: releaseDeclarationOf,
    settingOf: notConfigured,
    secretOf: notConfigured,
    record(event: ExternalRecordEvent): void {
      console.log(`[external] ${event.systemId}.${event.operationId} ${event.outcome}`);
    },
    transport: nodeExternalTransport,
    resolveHost: nodeResolveHost,
  });
}
