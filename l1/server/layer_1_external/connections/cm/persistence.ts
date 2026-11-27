/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/cm/persistence.ts" enhancement="_blank" />
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { getSharedPgPool } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import { ONCE_ANSWER_RETENTION_MS, ONCE_ANSWER_TABLE, onceAnswerDefinition } from '/_102034_/l1/server/layer_1_external/connections/cm/onceStore.js';
import type { TableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';

export const tableDefinitions: TableDefinition[] = [onceAnswerDefinition];

export async function onTick(_ctx: RequestContext, now: Date): Promise<void> {
  const env = readAppEnv();
  if (env.runtimeMode !== 'postgres') return;
  const cutoff = new Date(now.getTime() - ONCE_ANSWER_RETENTION_MS).toISOString();
  await getSharedPgPool(env).query(`DELETE FROM "${ONCE_ANSWER_TABLE}" WHERE "createdAt" < $1::timestamptz`, [cutoff]);
}
