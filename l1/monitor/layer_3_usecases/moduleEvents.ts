/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/moduleEvents.ts" enhancement="_blank" />
/**
 * What the monitor shows for events between modules.
 * The event body never leaves the queue: no query below selects `payload`, `actorKind`, `actorId` or `requestId`.
 * The counts are made by the database (GROUP BY), so the page does not read every row of the queue.
 */
import type { ModuleEventDb } from '/_102034_/l1/server/layer_1_external/events/moduleEventQueue.js';

const FAILURE_LIMIT = 50;
const REASON_MAX = 200;

export interface ModuleEventsDeps {
  db: Pick<ModuleEventDb, 'query'>;
}

export interface ModuleEventSummary {
  event: string;
  subscribers: string[];
  published24h: number;
  published7d: number;
  delivered: number;
  pending: number;
  failed: number;
}

export interface ModuleEventFailure {
  event: string;
  consumerModule: string;
  attempts: number;
  reason: string;
  publishedAt: string;
}

export interface ModuleEventsOfResult {
  events: ModuleEventSummary[];
  failures: ModuleEventFailure[];
}

/** An event the module published or receives; `$2` is the module, empty for all. */
const VISIBLE = `e."projectId" = $1 AND ($2::text = '' OR e."moduleId" = $2::text OR EXISTS (
    SELECT 1 FROM "platform_module_event_deliveries" v WHERE v."eventId" = e."eventId" AND v."consumerModule" = $2::text))`;

export const MODULE_EVENT_PUBLISHED_SQL = `SELECT e."moduleId" AS "moduleId", e."event" AS "event",
    count(*) FILTER (WHERE e."publishedAt" >= now() - interval '24 hours' AND e."publishedAt" <= now())::int AS "published24h",
    count(*) FILTER (WHERE e."publishedAt" >= now() - interval '7 days' AND e."publishedAt" <= now())::int AS "published7d"
  FROM "platform_module_events" e
  WHERE ${VISIBLE}
  GROUP BY e."moduleId", e."event"`;

export const MODULE_EVENT_DELIVERIES_SQL = `SELECT e."moduleId" AS "moduleId", e."event" AS "event",
    d."consumerModule" AS "consumerModule", d."result" AS "result", count(*)::int AS "n"
  FROM "platform_module_event_deliveries" d
  JOIN "platform_module_events" e ON e."eventId" = d."eventId"
  WHERE ${VISIBLE}
  GROUP BY e."moduleId", e."event", d."consumerModule", d."result"`;

export const MODULE_EVENT_FAILURES_SQL = `SELECT e."moduleId" AS "moduleId", e."event" AS "event",
    d."consumerModule" AS "consumerModule", d."attempts" AS "attempts",
    left(coalesce(d."reason", ''), ${REASON_MAX}) AS "reason", e."publishedAt"::text AS "publishedAt"
  FROM "platform_module_event_deliveries" d
  JOIN "platform_module_events" e ON e."eventId" = d."eventId"
  WHERE ${VISIBLE} AND d."result" = 'failed'
  ORDER BY e."publishedAt" DESC, e."eventId", d."consumerModule"
  LIMIT ${FAILURE_LIMIT}`;

function record(row: unknown): Record<string, unknown> {
  return row !== null && typeof row === 'object' ? row as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function count(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

/** `<module>.<event>`; the queue stores the event id with or without the module in front. */
function eventName(moduleId: string, event: string): string {
  return event.includes('.') ? event : `${moduleId}.${event}`;
}

export async function moduleEventsOf(
  deps: ModuleEventsDeps,
  projectId: string,
  moduleId?: string,
): Promise<ModuleEventsOfResult> {
  const params = [projectId, moduleId?.trim() ?? ''];
  const [published, deliveries, failed] = await Promise.all([
    deps.db.query(MODULE_EVENT_PUBLISHED_SQL, params),
    deps.db.query(MODULE_EVENT_DELIVERIES_SQL, params),
    deps.db.query(MODULE_EVENT_FAILURES_SQL, params),
  ]);

  const byEvent = new Map<string, ModuleEventSummary>();
  const summaryOf = (name: string): ModuleEventSummary => {
    const found = byEvent.get(name);
    if (found) return found;
    const created: ModuleEventSummary = { event: name, subscribers: [], published24h: 0, published7d: 0, delivered: 0, pending: 0, failed: 0 };
    byEvent.set(name, created);
    return created;
  };
  for (const raw of published.rows) {
    const row = record(raw);
    const summary = summaryOf(eventName(text(row.moduleId), text(row.event)));
    summary.published24h += count(row.published24h);
    summary.published7d += count(row.published7d);
  }
  for (const raw of deliveries.rows) {
    const row = record(raw);
    const summary = summaryOf(eventName(text(row.moduleId), text(row.event)));
    const consumer = text(row.consumerModule);
    if (consumer !== '' && !summary.subscribers.includes(consumer)) summary.subscribers.push(consumer);
    const n = count(row.n);
    const result = text(row.result);
    if (result === 'delivered') summary.delivered += n;
    else if (result === 'failed') summary.failed += n;
    else if (result === 'pending' || result === 'delivering') summary.pending += n;
  }

  return {
    events: [...byEvent.values()]
      .map((summary) => ({ ...summary, subscribers: [...summary.subscribers].sort() }))
      .sort((left, right) => left.event.localeCompare(right.event)),
    failures: failed.rows.map((raw): ModuleEventFailure => {
      const row = record(raw);
      return {
        event: eventName(text(row.moduleId), text(row.event)),
        consumerModule: text(row.consumerModule),
        attempts: count(row.attempts),
        reason: text(row.reason).slice(0, REASON_MAX),
        publishedAt: text(row.publishedAt),
      };
    }),
  };
}
