/// <mls fileReference="_102034_/l1/server/layer_1_external/events/persistence.ts" enhancement="_blank" />
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { getSharedPgPool } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import {
  moduleEventDefinition,
  moduleEventDeliveryDefinition,
  purgeModuleEvents,
} from '/_102034_/l1/server/layer_1_external/events/moduleEventQueue.js';
import type { TableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';

export const tableDefinitions: TableDefinition[] = [
  moduleEventDefinition,
  moduleEventDeliveryDefinition,
];

/** Retention follows delivery state, so it is not an add_retention_policy. */
export async function onTick(_ctx: RequestContext, now: Date): Promise<void> {
  const env = readAppEnv();
  if (env.runtimeMode !== 'postgres') return;
  await purgeModuleEvents(getSharedPgPool(env), now);
}
