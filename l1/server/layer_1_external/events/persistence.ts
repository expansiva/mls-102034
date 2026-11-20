/// <mls fileReference="_102034_/l1/server/layer_1_external/events/persistence.ts" enhancement="_blank" />
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { getSharedPgPool, withPgTransaction } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import type { ModuleEventDb } from '/_102034_/l1/server/layer_1_external/events/moduleEventQueue.js';
import {
  moduleEventDefinition,
  moduleEventDeliveryDefinition,
  purgeModuleEvents,
} from '/_102034_/l1/server/layer_1_external/events/moduleEventQueue.js';
import {
  callConsumesRoute,
  createDeliveryRunner,
  createReleaseConsumesLookup,
  deliverDueModuleEvents,
} from '/_102034_/l1/server/layer_1_external/events/deliverModuleEvents.js';
import type { TableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';

export const tableDefinitions: TableDefinition[] = [
  moduleEventDefinition,
  moduleEventDeliveryDefinition,
];

/** The context of a delivery: the tick context (its project and module are kept) with `moduleData` swapped for the transaction client. */
export function bindModuleDataContext(ctx: RequestContext): (moduleData: RequestContext['data']['moduleData']) => RequestContext {
  return (moduleData) => ({ ...ctx, data: { ...ctx.data, moduleData } });
}

const findConsumes = createReleaseConsumesLookup();
const deliveryRunner = createDeliveryRunner();

/** Retention follows delivery state, so it is not an add_retention_policy. Then due deliveries run. */
export async function onTick(ctx: RequestContext, now: Date): Promise<void> {
  const env = readAppEnv();
  if (env.runtimeMode !== 'postgres') return;
  const pool = getSharedPgPool(env);
  const db: ModuleEventDb = {
    query: (sql, params) => pool.query(sql, params as unknown[] | undefined),
    transaction: (work) => withPgTransaction(pool, (client) => {
      const tx: ModuleEventDb = {
        query: (sql, params) => client.query(sql, params as unknown[] | undefined),
        transaction: (inner) => inner(tx),
      };
      return work(tx);
    }),
  };
  await purgeModuleEvents(db, now);
  // The tick of every module is one round. Delivery waits for the route to end (the transaction cannot be released under it),
  // so it runs apart: this tick waits only for the cleanup above.
  deliveryRunner.start(() => deliverDueModuleEvents({
    db,
    moduleData: ctx.data.moduleData,
    now,
    bindContext: bindModuleDataContext(ctx),
    findRoute: findConsumes,
    callRoute: callConsumesRoute,
  }), now.getTime());
}
