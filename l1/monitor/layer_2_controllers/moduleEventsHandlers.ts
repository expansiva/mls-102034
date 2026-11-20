/// <mls fileReference="_102034_/l1/monitor/layer_2_controllers/moduleEventsHandlers.ts" enhancement="_blank" />
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { getSharedPgPool } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import type { ModuleEventDb } from '/_102034_/l1/server/layer_1_external/events/moduleEventQueue.js';
import { AppError, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { isAppAdmin } from '/_102034_/l1/monitor/layer_3_usecases/externalSystems.js';
import { moduleEventsOf } from '/_102034_/l1/monitor/layer_3_usecases/moduleEvents.js';

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const empty = { events: [], failures: [] };

export const monitorModuleEventsListHandler: BffHandler = async (input) => {
  const { request } = input;
  if (!isAppAdmin(request.meta?.verifiedAuthorities)) {
    throw new AppError('FORBIDDEN', 'App admin is required.', 403);
  }
  const env = readAppEnv();
  if (env.runtimeMode !== 'postgres') {
    return { ok: true, data: empty, error: null };
  }
  const params = (request.params ?? {}) as Record<string, unknown>;
  const moduleId = text(params.module);
  const db: Pick<ModuleEventDb, 'query'> = {
    query: (sql, queryParams) => getSharedPgPool(env).query(sql, queryParams as never[]),
  };
  return {
    ok: true,
    data: await moduleEventsOf({ db }, env.projectId ?? '', moduleId === '' ? undefined : moduleId),
    error: null,
  };
};
