/// <mls fileReference="_102034_/l1/server/layer_1_external/events/deliverModuleEvents.ts" enhancement="_blank" />
/**
 * Each tick claims due deliveries and runs the subscriber route inside one module-data transaction.
 * The delivered mark commits with the route's writes. A failure rolls both back.
 * An effect outside the database does not roll back; the envelope still carries eventId.
 */
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { IModuleDataRuntime } from '/_102034_/l1/server/layer_1_external/data/moduleDataRuntime.js';
import { execMessage } from '/_102034_/l1/server/layer_1_external/transport/message/execMessage.js';
import { readProjectsConfig } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { distDefsReader } from '/_102034_/l1/workflow/assistantCatalogDefs.js';
import {
  findConsumesRoute,
  moduleEventTechnicalId,
  buildConsumesIndex,
  type ConsumesIndex,
  type ServeRoute,
} from '/_102034_/l1/workflow/connectionServe.js';
import {
  MODULE_EVENT_DELIVERY_TABLE,
  claimDue,
  markFailed,
  markRetry,
  type ClaimedModuleEvent,
  type ModuleEventDb,
} from '/_102034_/l1/server/layer_1_external/events/moduleEventQueue.js';
import {
  moduleEventRefText,
  type ModuleEventEnvelope,
  type ModuleEventRef,
} from '/_102034_/l1/server/layer_1_external/events/types.js';

export const MODULE_EVENT_DELIVER_LIMIT = 8;
export const MODULE_EVENT_DELIVER_MS = 5_000;
export const MODULE_EVENT_LEASE_MS = 60_000;
export const MODULE_EVENT_MAX_ATTEMPTS = 5;
const BACKOFF_MS = [10_000, 60_000, 300_000, 1_800_000, 7_200_000];

interface DeliveryMark {
  eventId: string;
  consumerModule: string;
  attempts: number;
  result: string;
  deliveredAt: string | null;
  leaseUntil: string | null;
}

export interface DeliverModuleEventsDeps {
  db: ModuleEventDb;
  moduleData: IModuleDataRuntime;
  now: Date;
  bindContext(moduleData: IModuleDataRuntime): RequestContext;
  findRoute(projectId: string, consumerModule: string, mark: string): Promise<ServeRoute | undefined>;
  callRoute(route: ServeRoute, envelope: ModuleEventEnvelope, ctx: RequestContext): Promise<number>;
  log?(line: string): void;
  limit?: number;
  /** Tests shorten it. Default: `MODULE_EVENT_DELIVER_MS`. */
  deadlineMs?: number;
}

function refOf(row: ClaimedModuleEvent): ModuleEventRef {
  const dot = row.event.indexOf('.');
  if (dot > 0) return { module: row.event.slice(0, dot), eventId: row.event.slice(dot + 1) };
  return { module: row.moduleId, eventId: row.event };
}

function envelopeOf(row: ClaimedModuleEvent): ModuleEventEnvelope {
  const ref = refOf(row);
  return {
    eventId: row.eventId,
    ref,
    publishedAt: row.publishedAt,
    payload: row.payload,
    ...(row.actorKind && row.actorId ? { actor: { kind: row.actorKind, id: row.actorId } } : {}),
    ...(row.requestId ? { requestId: row.requestId } : {}),
  };
}

function waitMs(attempts: number): number {
  return BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!;
}

function reasonOf(error: unknown): 'timeout' | 'status' | 'error' | 'lost' {
  if (error !== null && typeof error === 'object' && 'deliverResult' in error) {
    const value = (error as { deliverResult: unknown }).deliverResult;
    if (value === 'timeout' || value === 'status' || value === 'lost') return value;
  }
  return 'error';
}

function fail(result: 'timeout' | 'status' | 'lost'): Error {
  return Object.assign(new Error(result), { deliverResult: result });
}

/**
 * The route runs on the transaction client. When the deadline passes the delivery is a failure, but the transaction must
 * not be rolled back and released while the route is still running: its late queries would run on a client that is back
 * in the pool. So the deadline only decides the result; the call waits for the route to end, then the failure is thrown
 * (and the route's writes are rolled back with it).
 */
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const settled = work.then((value) => ({ value }), (error: unknown) => ({ error }));
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  try {
    const first = await Promise.race([settled, timeout]);
    if (first === 'timeout') {
      await settled;
      throw fail('timeout');
    }
    if ('error' in first) throw first.error;
    return first.value;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The serves path: execMessage keeps the ctx, so moduleData stays on the transaction client. */
export async function callConsumesRoute(
  route: ServeRoute,
  envelope: ModuleEventEnvelope,
  ctx: RequestContext,
): Promise<number> {
  const technical = moduleEventTechnicalId(envelope.ref.module);
  const answer = await execMessage({
    routine: route.route,
    params: envelope,
    meta: {
      requestId: envelope.eventId,
      userId: technical,
      actorId: technical,
      actorScope: [`${route.moduleId}:${technical}`],
      verifiedAuthorities: [`${route.moduleId}:${technical}`],
    },
  }, ctx);
  return answer.statusCode;
}

/** Routes of the running release, cached per process. A release without the mark is no route. */
export function createReleaseConsumesLookup(): DeliverModuleEventsDeps['findRoute'] {
  const cache = new Map<string, Promise<ConsumesIndex>>();
  return async (projectId, consumerModule, mark) => {
    let pending = cache.get(projectId);
    if (!pending) {
      const modules = (readProjectsConfig().projects[projectId]?.modules ?? []).map((entry) => entry.moduleId);
      pending = buildConsumesIndex(distDefsReader(projectId), modules);
      cache.set(projectId, pending);
    }
    return findConsumesRoute(await pending, consumerModule, mark);
  };
}

async function markInside(
  tx: IModuleDataRuntime,
  row: ClaimedModuleEvent,
  at: string,
): Promise<void> {
  const table = await tx.getTable<DeliveryMark>(MODULE_EVENT_DELIVERY_TABLE);
  await table.update({
    where: {
      eventId: row.eventId,
      consumerModule: row.consumerModule,
      result: 'delivering',
      attempts: row.attempts,
    },
    patch: { result: 'delivered', deliveredAt: at, leaseUntil: null },
  });
  const stored = await table.findOne({
    where: {
      eventId: row.eventId,
      consumerModule: row.consumerModule,
      result: 'delivered',
      deliveredAt: at,
      attempts: row.attempts,
    },
  });
  if (!stored) throw fail('lost');
}

/** One claim batch. Each delivery is its own transaction. One failure does not stop the next. */
export async function deliverDueModuleEvents(deps: DeliverModuleEventsDeps): Promise<void> {
  const log = deps.log ?? ((line: string): void => console.info(line));
  const claimed = await claimDue(
    deps.db,
    deps.limit ?? MODULE_EVENT_DELIVER_LIMIT,
    deps.now,
    MODULE_EVENT_LEASE_MS,
  );
  for (const row of claimed) {
    const started = Date.now();
    const mark = moduleEventRefText(refOf(row));
    let result = 'delivered';
    try {
      const route = await deps.findRoute(row.projectId, row.consumerModule, mark);
      if (!route) {
        await markFailed(deps.db, row.eventId, row.consumerModule, 'no-route', row.attempts);
        result = 'failed';
      } else {
        const envelope = envelopeOf(row);
        await deps.moduleData.runInTransaction(async (tx) => {
          const status = await withDeadline(
            deps.callRoute(route, envelope, deps.bindContext(tx)),
            deps.deadlineMs ?? MODULE_EVENT_DELIVER_MS,
          );
          if (status < 200 || status >= 300) throw fail('status');
          await markInside(tx, row, deps.now.toISOString());
        });
      }
    } catch (error) {
      const reason = reasonOf(error);
      if (reason === 'lost') {
        result = 'lost';
      } else if (row.attempts >= MODULE_EVENT_MAX_ATTEMPTS) {
        await markFailed(deps.db, row.eventId, row.consumerModule, reason, row.attempts);
        result = 'failed';
      } else {
        const next = new Date(deps.now.getTime() + waitMs(row.attempts));
        await markRetry(deps.db, row.eventId, row.consumerModule, next, row.attempts);
        result = 'retry';
      }
    }
    log(`[module-event] ${mark} ${row.consumerModule} ${result} ms=${Date.now() - started}`);
  }
}

/**
 * Runs delivery rounds apart from the common tick. The tick of every module is one round with one "running" flag, so a
 * route that never ends must not be awaited there. `start` fires the round and returns at once; while a round is in flight
 * no other starts in this process (the SKIP LOCKED of the queue covers the other process). A round that throws is logged,
 * never a loose promise. A round still running is logged at most once every `busyLogEveryMs`, so a stuck route shows up.
 */
export function createDeliveryRunner(options: { log?: (line: string) => void; busyLogEveryMs?: number } = {}) {
  const log = options.log ?? ((line: string): void => console.warn(line));
  const busyLogEveryMs = options.busyLogEveryMs ?? 10 * 60_000;
  let inFlight = false;
  let lastBusyLogAt = Number.NEGATIVE_INFINITY;
  return {
    inFlight: (): boolean => inFlight,
    start(round: () => Promise<void>, nowMs: number): boolean {
      if (inFlight) {
        if (nowMs - lastBusyLogAt >= busyLogEveryMs) {
          lastBusyLogAt = nowMs;
          log('[module-event] the previous delivery round is still running; this one is skipped');
        }
        return false;
      }
      inFlight = true;
      void round()
        .catch((error: unknown) => {
          log(`[module-event] delivery round failed: ${error instanceof Error ? error.name : 'error'}`);
        })
        .finally(() => {
          inFlight = false;
        });
      return true;
    },
  };
}
