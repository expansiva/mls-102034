/// <mls fileReference="_102034_/l1/server/layer_1_external/events/moduleEventQueue.ts" enhancement="_blank" />
import type { TableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import type { ModuleEventEnvelope } from '/_102034_/l1/server/layer_1_external/events/types.js';
import { moduleEventRefText } from '/_102034_/l1/server/layer_1_external/events/types.js';

/**
 * One row per published event. Not a hypertable: retention depends on delivery state
 * (every delivery delivered → 7 days; any failed and none still pending or delivering → 90 days),
 * and a Timescale policy drops by time only. `onTick` of the platformModuleEvents persistence applies it.
 *
 * Delivery is at least once. `claimDue` sets `delivering` and a lease, then returns. A second
 * process may claim the same row after the lease ends, and the first process may still mark it.
 * The receiver treats `eventId` as the idempotency key.
 */
export const MODULE_EVENT_TABLE = 'platform_module_events';
export const MODULE_EVENT_DELIVERY_TABLE = 'platform_module_event_deliveries';
export const MODULE_EVENT_DELIVERED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MODULE_EVENT_FAILED_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const REASON_MAX = 200;

export interface ModuleEventDb {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: unknown[] }>;
  transaction<T>(work: (tx: ModuleEventDb) => Promise<T>): Promise<T>;
}

export type ModuleEventDeliveryResult = 'pending' | 'delivering' | 'delivered' | 'failed';

export interface ClaimedModuleEvent {
  eventId: string;
  projectId: string;
  moduleId: string;
  event: string;
  payload: unknown;
  actorKind: 'person' | 'agent' | null;
  actorId: string | null;
  requestId: string | null;
  publishedAt: string;
  consumerModule: string;
  attempts: number;
  nextAttemptAt: string;
}

const eventColumns = [
  { name: 'eventId', postgresType: 'TEXT' },
  { name: 'projectId', postgresType: 'TEXT' },
  { name: 'moduleId', postgresType: 'TEXT' },
  { name: 'event', postgresType: 'TEXT' },
  { name: 'payload', postgresType: 'JSONB' },
  { name: 'actorKind', postgresType: 'TEXT', nullable: true },
  { name: 'actorId', postgresType: 'TEXT', nullable: true },
  { name: 'requestId', postgresType: 'TEXT', nullable: true },
  { name: 'publishedAt', postgresType: 'TIMESTAMPTZ' },
] as const;

export const moduleEventDefinition: TableDefinition = {
  moduleId: 'platformModuleEvents',
  repositoryName: MODULE_EVENT_TABLE,
  tableName: MODULE_EVENT_TABLE,
  purpose: 'controle',
  description: 'One published module event. Purged by onTick from delivery state: 7 days when every delivery is delivered, 90 days when any delivery failed and none is pending or delivering. Not a hypertable, because that retention is not a function of time alone.',
  backupHot: false,
  storageProfile: 'postgres',
  writeMode: 'sync',
  columns: [...eventColumns],
  primaryKey: ['eventId'],
  indexes: [
    { name: 'idx_platform_module_events_project', columns: ['projectId', 'publishedAt'] },
  ],
  version: 1,
};

export const moduleEventDeliveryDefinition: TableDefinition = {
  moduleId: 'platformModuleEvents',
  repositoryName: MODULE_EVENT_DELIVERY_TABLE,
  tableName: MODULE_EVENT_DELIVERY_TABLE,
  purpose: 'controle',
  description: 'One delivery per event and subscriber. claimDue marks due rows delivering with a lease in one statement (FOR UPDATE SKIP LOCKED). A later claim may take the row again after leaseUntil.',
  backupHot: false,
  storageProfile: 'postgres',
  writeMode: 'sync',
  columns: [
    { name: 'eventId', postgresType: 'TEXT' },
    { name: 'consumerModule', postgresType: 'TEXT' },
    { name: 'attempts', postgresType: 'INTEGER', defaultSql: '0' },
    { name: 'nextAttemptAt', postgresType: 'TIMESTAMPTZ' },
    { name: 'leaseUntil', postgresType: 'TIMESTAMPTZ', nullable: true },
    { name: 'result', postgresType: 'TEXT' },
    { name: 'reason', postgresType: 'TEXT', nullable: true },
    { name: 'deliveredAt', postgresType: 'TIMESTAMPTZ', nullable: true },
  ],
  primaryKey: ['eventId', 'consumerModule'],
  indexes: [
    { name: 'idx_platform_module_event_deliveries_due', columns: ['result', 'nextAttemptAt'] },
  ],
  version: 2,
};

/** Writes the event and one delivery per subscriber in one transaction. A failure rolls both back. */
export async function enqueue(
  db: ModuleEventDb,
  projectId: string,
  envelope: ModuleEventEnvelope,
  consumers: readonly string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO "platform_module_events"
        ("eventId", "projectId", "moduleId", "event", "payload", "actorKind", "actorId", "requestId", "publishedAt")
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::timestamptz)`,
      [
        envelope.eventId,
        projectId,
        envelope.ref.module,
        moduleEventRefText(envelope.ref),
        JSON.stringify(envelope.payload ?? null),
        envelope.actor?.kind ?? null,
        envelope.actor?.id ?? null,
        envelope.requestId ?? null,
        envelope.publishedAt,
      ],
    );
    for (const consumerModule of consumers) {
      await tx.query(
        `INSERT INTO "platform_module_event_deliveries"
          ("eventId", "consumerModule", "attempts", "nextAttemptAt", "leaseUntil", "result", "reason", "deliveredAt")
         VALUES ($1, $2, 0, $3::timestamptz, NULL, 'pending', NULL, NULL)`,
        [envelope.eventId, consumerModule, envelope.publishedAt],
      );
    }
  });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function actorKind(value: unknown): 'person' | 'agent' | null {
  if (value === 'person' || value === 'agent') return value;
  return null;
}

function claimed(row: unknown): ClaimedModuleEvent {
  const value = row !== null && typeof row === 'object' ? row as Record<string, unknown> : {};
  return {
    eventId: text(value.eventId),
    projectId: text(value.projectId),
    moduleId: text(value.moduleId),
    event: text(value.event),
    payload: value.payload ?? null,
    actorKind: actorKind(value.actorKind),
    actorId: textOrNull(value.actorId),
    requestId: textOrNull(value.requestId),
    publishedAt: text(value.publishedAt),
    consumerModule: text(value.consumerModule),
    attempts: typeof value.attempts === 'number' ? value.attempts : Number(value.attempts ?? 0),
    nextAttemptAt: text(value.nextAttemptAt),
  };
}

/**
 * One statement. Pending rows due now, and delivering rows whose lease ended, become
 * `delivering` until `now + leaseMs`. `attempts` increases here. The connection is not held.
 */
export async function claimDue(
  db: ModuleEventDb,
  limit: number,
  now: Date,
  leaseMs: number,
): Promise<ClaimedModuleEvent[]> {
  const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
  const result = await db.query(
    `WITH due AS (
       SELECT d."eventId", d."consumerModule"
       FROM "platform_module_event_deliveries" d
       WHERE (d."result" = 'pending' AND d."nextAttemptAt" <= $1::timestamptz)
          OR (d."result" = 'delivering' AND d."leaseUntil" <= $1::timestamptz)
       ORDER BY d."nextAttemptAt", d."eventId", d."consumerModule"
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     ), claimed AS (
       UPDATE "platform_module_event_deliveries" d
       SET "result" = 'delivering',
           "leaseUntil" = $3::timestamptz,
           "attempts" = d."attempts" + 1
       FROM due
       WHERE d."eventId" = due."eventId" AND d."consumerModule" = due."consumerModule"
       RETURNING d."eventId", d."consumerModule", d."attempts", d."nextAttemptAt"
     )
     SELECT e."eventId", e."projectId", e."moduleId", e."event", e."payload",
            e."actorKind", e."actorId", e."requestId", e."publishedAt",
            c."consumerModule", c."attempts", c."nextAttemptAt"
     FROM claimed c
     JOIN "platform_module_events" e ON e."eventId" = c."eventId"`,
    [now.toISOString(), limit, leaseUntil],
  );
  return result.rows.map(claimed);
}

export async function markDelivered(
  db: ModuleEventDb,
  eventId: string,
  consumerModule: string,
  at: Date,
): Promise<void> {
  await db.query(
    `UPDATE "platform_module_event_deliveries"
     SET "result" = 'delivered', "deliveredAt" = $3::timestamptz, "leaseUntil" = NULL
     WHERE "eventId" = $1 AND "consumerModule" = $2 AND "result" = 'delivering'`,
    [eventId, consumerModule, at.toISOString()],
  );
}

export async function markRetry(
  db: ModuleEventDb,
  eventId: string,
  consumerModule: string,
  next: Date,
  attempts?: number,
): Promise<void> {
  const owned = typeof attempts === 'number' ? ' AND "attempts" = $4' : '';
  await db.query(
    `UPDATE "platform_module_event_deliveries"
     SET "result" = 'pending', "nextAttemptAt" = $3::timestamptz, "leaseUntil" = NULL, "reason" = NULL
     WHERE "eventId" = $1 AND "consumerModule" = $2 AND "result" = 'delivering'${owned}`,
    typeof attempts === 'number'
      ? [eventId, consumerModule, next.toISOString(), attempts]
      : [eventId, consumerModule, next.toISOString()],
  );
}

export async function markFailed(
  db: ModuleEventDb,
  eventId: string,
  consumerModule: string,
  reason: string,
  attempts?: number,
): Promise<void> {
  const short = reason.slice(0, REASON_MAX);
  const owned = typeof attempts === 'number' ? ' AND "attempts" = $4' : '';
  await db.query(
    `UPDATE "platform_module_event_deliveries"
     SET "result" = 'failed', "reason" = $3, "leaseUntil" = NULL
     WHERE "eventId" = $1 AND "consumerModule" = $2 AND "result" = 'delivering'${owned}`,
    typeof attempts === 'number'
      ? [eventId, consumerModule, short, attempts]
      : [eventId, consumerModule, short],
  );
}

/** Deletes events whose deliveries are all delivered after 7 days, or include a failure after 90. Pending and delivering stay. */
export async function purgeModuleEvents(
  db: { query(sql: string, params?: readonly unknown[]): Promise<{ rows: unknown[] }> },
  now: Date,
): Promise<void> {
  const deliveredBefore = new Date(now.getTime() - MODULE_EVENT_DELIVERED_RETENTION_MS).toISOString();
  const failedBefore = new Date(now.getTime() - MODULE_EVENT_FAILED_RETENTION_MS).toISOString();
  await db.query(
    `DELETE FROM "platform_module_events" e
     WHERE (
       e."publishedAt" < $1::timestamptz
       AND NOT EXISTS (
         SELECT 1 FROM "platform_module_event_deliveries" d
         WHERE d."eventId" = e."eventId" AND d."result" <> 'delivered'
       )
     ) OR (
       e."publishedAt" < $2::timestamptz
       AND EXISTS (
         SELECT 1 FROM "platform_module_event_deliveries" d
         WHERE d."eventId" = e."eventId" AND d."result" = 'failed'
       )
       AND NOT EXISTS (
         SELECT 1 FROM "platform_module_event_deliveries" d
         WHERE d."eventId" = e."eventId" AND d."result" IN ('pending', 'delivering')
       )
     )`,
    [deliveredBefore, failedBefore],
  );
  await db.query(
    `DELETE FROM "platform_module_event_deliveries" d
     WHERE NOT EXISTS (
       SELECT 1 FROM "platform_module_events" e WHERE e."eventId" = d."eventId"
     )`,
    [],
  );
}
