/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/log/persistence.ts" enhancement="_blank" />
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { getSharedPgPool } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import {
  externalCallAuditDefinition,
  externalCallLogDefinition,
  externalCallViewDefinitions,
  externalNoticeSeenDefinition,
  purgeSeenNotices,
} from '/_102034_/l1/server/layer_1_external/connections/external/externalCallStore.js';
import type { TableDefinition, ViewDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';

export const tableDefinitions: TableDefinition[] = [
  externalCallLogDefinition,
  externalCallAuditDefinition,
  externalNoticeSeenDefinition,
];

/** Hypertables use add_retention_policy. The notice table is purged here. */
export const viewDefinitions: ViewDefinition[] = externalCallViewDefinitions;

export async function onTick(_ctx: RequestContext, now: Date): Promise<void> {
  const env = readAppEnv();
  if (env.runtimeMode !== 'postgres') return;
  await purgeSeenNotices(getSharedPgPool(env), now);
}
