/// <mls fileReference="_102034_/l1/monitor/layer_2_controllers/externalSystemsHandlers.ts" enhancement="_blank" />
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { publicOriginOf } from '/_102034_/l1/server/layer_1_external/connections/external/externalHook.js';
import { getSharedPgPool } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import { moduleSystemsIndex } from '/_102034_/l1/server/layer_1_external/connections/moduleSystemsIndex.js';
import {
  externalCallWriteFailureCount,
  readRecentExternalCalls,
  type ExternalCallDb,
} from '/_102034_/l1/server/layer_1_external/connections/external/externalCallStore.js';
import {
  productionExternalSettings,
  releaseDeclarationOf,
} from '/_102034_/l1/server/layer_1_external/connections/external/productionExternalSender.js';
import { AppError, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  externalSystemsOf,
  externalSystemsScope,
  modulesWithSystems,
  setExternalSetting,
  type ExternalSystemsDeps,
} from '/_102034_/l1/monitor/layer_3_usecases/externalSystems.js';

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function requireScope(
  authorities: readonly string[] | undefined,
  moduleId: string,
  options: { write: boolean; agent: boolean },
): void {
  if (externalSystemsScope(authorities, moduleId, options) === 'denied') {
    throw new AppError('FORBIDDEN', 'App admin, or admin of this module, is required.', 403);
  }
}

/** The request comes from an agent (the assistant), not from a person at the screen. */
function isAgentRequest(input: { request: { meta?: { actorType?: string } }; ctx?: { requestMeta?: { actorType?: string } } }): boolean {
  return input.request.meta?.actorType === 'agent' || input.ctx?.requestMeta?.actorType === 'agent';
}

function callDb(): ExternalCallDb | null {
  const env = readAppEnv();
  if (env.runtimeMode !== 'postgres') return null;
  return { query: (sql, params) => getSharedPgPool(env).query(sql, params as never[]) };
}

function monitorDeps(): ExternalSystemsDeps {
  const env = readAppEnv();
  const db = callDb();
  return {
    systemsOf: moduleSystemsIndex,
    declarationOf: releaseDeclarationOf,
    settings: productionExternalSettings(),
    recentCalls: async (projectId, moduleId, systemId) => {
      if (!db) return [];
      return readRecentExternalCalls(db, projectId, moduleId, systemId);
    },
    writeFailureCount: externalCallWriteFailureCount,
    publicOrigin: () => publicOriginOf(env.projectDomain),
  };
}

/** The project of this server. A project id in the request is ignored: an admin of this app must not reach another project's rows. */
function projectIdOf(): string {
  return readAppEnv().projectId ?? '';
}

export const monitorExternalSystemsListHandler: BffHandler = async (input) => {
  const { request } = input;
  const params = (request.params ?? {}) as Record<string, unknown>;
  const projectId = projectIdOf();
  const moduleId = text(params.moduleId);
  requireScope(request.meta?.verifiedAuthorities, moduleId, { write: false, agent: isAgentRequest(input) });
  if (projectId === '') {
    throw new AppError('INVALID_REQUEST', 'projectId and moduleId are required.', 400);
  }
  if (moduleId === '') {
    const index = await monitorDeps().systemsOf(projectId);
    return { ok: true, data: { modules: modulesWithSystems(index) }, error: null };
  }
  return {
    ok: true,
    data: await externalSystemsOf(monitorDeps(), projectId, moduleId),
    error: null,
  };
};

export const monitorExternalSettingSetHandler: BffHandler = async (input) => {
  const { request } = input;
  const params = (request.params ?? {}) as Record<string, unknown>;
  const projectId = projectIdOf();
  const moduleId = text(params.moduleId);
  requireScope(request.meta?.verifiedAuthorities, moduleId, { write: true, agent: isAgentRequest(input) });
  const systemId = text(params.systemId);
  const settingId = text(params.settingId);
  const value = text(params.value);
  if (projectId === '' || moduleId === '' || systemId === '' || settingId === '') {
    throw new AppError('INVALID_REQUEST', 'projectId, moduleId, systemId and settingId are required.', 400);
  }
  const written = await setExternalSetting(
    monitorDeps(),
    { projectId, moduleId, systemId },
    settingId,
    value,
    request.meta?.verifiedEmail || request.meta?.verifiedUserId || 'admin',
  );
  if (!written.ok) {
    throw new AppError(
      written.code === 'disabled' ? 'SECRETS_DISABLED' : 'SETTING_REFUSED',
      written.code === 'disabled' ? 'Secrets are disabled on this server.' : 'That setting is not in the declaration.',
      written.code === 'disabled' ? 503 : 400,
    );
  }
  return { ok: true, data: { ok: true }, error: null };
};
