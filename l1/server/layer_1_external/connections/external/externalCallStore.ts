/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/externalCallStore.ts" enhancement="_blank" />
import type { TableDefinition, ViewDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';

/** Short log. A 7-day view over the audit table would hide rows and would not delete them. */
export const EXTERNAL_CALL_LOG_TABLE = 'platform_external_call_log';
export const EXTERNAL_CALL_LOG_RETENTION = '7 days';

/** Longer audit. Timescale allows one retention policy per hypertable, so this is a second table. */
export const EXTERNAL_CALL_AUDIT_TABLE = 'platform_external_call_audit';
export const EXTERNAL_CALL_AUDIT_RETENTION = '90 days';

/**
 * Already-received notice. Not a hypertable: a Timescale unique index must include the time
 * column, and the same noticeId at another instant would insert again.
 * Rows older than 90 days are deleted by `onTick` in `l1/server/persistence.ts` (the clock that
 * already wakes module persistence).
 */
export const EXTERNAL_NOTICE_SEEN_TABLE = 'platform_external_notice_seen';
export const EXTERNAL_NOTICE_SEEN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

const CALL_COLUMNS = [
  'id',
  'occurredAt',
  'direction',
  'projectId',
  'moduleId',
  'systemId',
  'operationId',
  'server',
  'path',
  'outcome',
  'denialReason',
  'httpStatus',
  'durationMs',
  'bytes',
  'actorKind',
  'actorId',
  'requestId',
] as const;

type CallColumn = (typeof CALL_COLUMNS)[number];

export interface ExternalCallRow {
  id: string;
  occurredAt: string;
  direction: 'out' | 'in';
  projectId: string;
  moduleId: string;
  systemId: string;
  operationId: string;
  server: string;
  path: string;
  outcome: string;
  denialReason: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  bytes: number | null;
  actorKind: 'person' | 'agent' | null;
  actorId: string | null;
  requestId: string | null;
}

export interface ExternalNoticeKey {
  projectId: string;
  systemId: string;
  operationId: string;
  noticeId: string;
  arrivedAt: string;
}

export interface ExternalCallDb {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: unknown[] }>;
}

function callTable(tableName: string, retention: string): TableDefinition {
  return {
    moduleId: 'platform',
    repositoryName: tableName,
    tableName,
    purpose: 'controle',
    description: `External call ${tableName === EXTERNAL_CALL_LOG_TABLE ? 'log' : 'audit'}. Hypertable on occurredAt. Retention ${retention} is the add_retention_policy statement, not retentionDays.`,
    backupHot: false,
    storageProfile: 'postgres',
    writeMode: 'sync',
    columns: [
      { name: 'id', postgresType: 'TEXT' },
      { name: 'occurredAt', postgresType: 'TIMESTAMPTZ' },
      { name: 'direction', postgresType: 'TEXT' },
      { name: 'projectId', postgresType: 'TEXT' },
      { name: 'moduleId', postgresType: 'TEXT' },
      { name: 'systemId', postgresType: 'TEXT' },
      { name: 'operationId', postgresType: 'TEXT' },
      { name: 'server', postgresType: 'TEXT' },
      { name: 'path', postgresType: 'TEXT' },
      { name: 'outcome', postgresType: 'TEXT' },
      { name: 'denialReason', postgresType: 'TEXT', nullable: true },
      { name: 'httpStatus', postgresType: 'INTEGER', nullable: true },
      { name: 'durationMs', postgresType: 'INTEGER', nullable: true },
      { name: 'bytes', postgresType: 'INTEGER', nullable: true },
      { name: 'actorKind', postgresType: 'TEXT', nullable: true },
      { name: 'actorId', postgresType: 'TEXT', nullable: true },
      { name: 'requestId', postgresType: 'TEXT', nullable: true },
    ],
    primaryKey: ['id', 'occurredAt'],
    indexes: [
      { name: `idx_${tableName}_request`, columns: ['requestId'] },
      { name: `idx_${tableName}_system`, columns: ['projectId', 'systemId', 'occurredAt'] },
    ],
    timescale: {
      hypertable: {
        timeColumn: 'occurredAt',
        chunkTimeInterval: '1 day',
      },
    },
    version: 1,
  };
}

export function externalCallRetentionStatement(tableName: string, interval: string): string {
  return `SELECT add_retention_policy('${tableName}', INTERVAL '${interval}', if_not_exists => TRUE)`;
}

export const externalCallLogDefinition = callTable(EXTERNAL_CALL_LOG_TABLE, EXTERNAL_CALL_LOG_RETENTION);
export const externalCallAuditDefinition = callTable(EXTERNAL_CALL_AUDIT_TABLE, EXTERNAL_CALL_AUDIT_RETENTION);

export const externalNoticeSeenDefinition: TableDefinition = {
  moduleId: 'platform',
  repositoryName: EXTERNAL_NOTICE_SEEN_TABLE,
  tableName: EXTERNAL_NOTICE_SEEN_TABLE,
  purpose: 'controle',
  description: 'Notices already received. Unique on (projectId, systemId, operationId, noticeId). Purged after 90 days by onTick.',
  backupHot: false,
  storageProfile: 'postgres',
  writeMode: 'sync',
  columns: [
    { name: 'projectId', postgresType: 'TEXT' },
    { name: 'systemId', postgresType: 'TEXT' },
    { name: 'operationId', postgresType: 'TEXT' },
    { name: 'noticeId', postgresType: 'TEXT' },
    { name: 'arrivedAt', postgresType: 'TIMESTAMPTZ' },
  ],
  primaryKey: ['projectId', 'systemId', 'operationId', 'noticeId'],
  version: 1,
};

export const externalCallViewDefinitions: ViewDefinition[] = [
  {
    moduleId: 'platform',
    viewName: 'platform_external_call_retention',
    statements: [
      externalCallRetentionStatement(EXTERNAL_CALL_LOG_TABLE, EXTERNAL_CALL_LOG_RETENTION),
      externalCallRetentionStatement(EXTERNAL_CALL_AUDIT_TABLE, EXTERNAL_CALL_AUDIT_RETENTION),
    ],
  },
];

const CALL_TABLES = new Set<string>([EXTERNAL_CALL_LOG_TABLE, EXTERNAL_CALL_AUDIT_TABLE]);

let externalCallWriteFailures = 0;

/** How many times a call row failed to land. The monitor reads this; a failure never stops the call. */
export function externalCallWriteFailureCount(): number {
  return externalCallWriteFailures;
}

function quoteIdent(name: string): string {
  return `"${name}"`;
}

function callValues(row: ExternalCallRow): unknown[] {
  return CALL_COLUMNS.map((column) => row[column]);
}

export async function writeExternalCall(db: ExternalCallDb, tableName: string, row: ExternalCallRow): Promise<void> {
  if (!CALL_TABLES.has(tableName)) {
    throw new Error(`external call table is not registered: ${tableName}`);
  }
  const columns = CALL_COLUMNS.map(quoteIdent).join(', ');
  const slots = CALL_COLUMNS.map((_, index) => `$${index + 1}`).join(', ');
  await db.query(
    `INSERT INTO ${quoteIdent(tableName)} (${columns}) VALUES (${slots})`,
    callValues(row),
  );
}

/** Writes the short log and the audit. A failed write is logged and counted; it does not throw. */
export async function writeExternalCallPair(db: ExternalCallDb, row: ExternalCallRow): Promise<void> {
  for (const tableName of [EXTERNAL_CALL_LOG_TABLE, EXTERNAL_CALL_AUDIT_TABLE]) {
    try {
      await writeExternalCall(db, tableName, row);
    } catch (error) {
      externalCallWriteFailures += 1;
      const text = error instanceof Error ? error.message : 'record failed';
      console.error(`[external] call record failed ${row.systemId}.${row.operationId} ${tableName} (failures=${externalCallWriteFailures}): ${text}`);
    }
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function directionOf(value: unknown): 'out' | 'in' {
  return value === 'in' ? 'in' : 'out';
}

function actorKindOf(value: unknown): 'person' | 'agent' | null {
  if (value === 'person' || value === 'agent') return value;
  return null;
}

function toCallRow(value: unknown): ExternalCallRow {
  const row = value !== null && typeof value === 'object' ? value as Partial<Record<CallColumn, unknown>> : {};
  return {
    id: text(row.id),
    occurredAt: text(row.occurredAt),
    direction: directionOf(row.direction),
    projectId: text(row.projectId),
    moduleId: text(row.moduleId),
    systemId: text(row.systemId),
    operationId: text(row.operationId),
    server: text(row.server),
    path: text(row.path),
    outcome: text(row.outcome),
    denialReason: textOrNull(row.denialReason),
    httpStatus: numberOrNull(row.httpStatus),
    durationMs: numberOrNull(row.durationMs),
    bytes: numberOrNull(row.bytes),
    actorKind: actorKindOf(row.actorKind),
    actorId: textOrNull(row.actorId),
    requestId: textOrNull(row.requestId),
  };
}

export async function readExternalCalls(db: ExternalCallDb, tableName: string, requestId: string): Promise<ExternalCallRow[]> {
  if (!CALL_TABLES.has(tableName)) {
    throw new Error(`external call table is not registered: ${tableName}`);
  }
  const columns = CALL_COLUMNS.map(quoteIdent).join(', ');
  const result = await db.query(
    `SELECT ${columns} FROM ${quoteIdent(tableName)} WHERE "requestId" = $1`,
    [requestId],
  );
  return result.rows.map(toCallRow);
}

/** @returns true when this noticeId was stored now. A repeat returns false and inserts nothing. */
export async function recordNoticeSeen(db: ExternalCallDb, notice: ExternalNoticeKey): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO ${quoteIdent(EXTERNAL_NOTICE_SEEN_TABLE)}
      ("projectId", "systemId", "operationId", "noticeId", "arrivedAt")
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ("projectId", "systemId", "operationId", "noticeId") DO NOTHING
     RETURNING "noticeId"`,
    [notice.projectId, notice.systemId, notice.operationId, notice.noticeId, notice.arrivedAt],
  );
  return result.rows.length === 1;
}

/** Undoes `recordNoticeSeen` when the delivery failed, so the sender's retry is delivered and not refused as a repeat. */
export async function forgetNotice(db: ExternalCallDb, notice: Omit<ExternalNoticeKey, 'arrivedAt'>): Promise<void> {
  await db.query(
    `DELETE FROM ${quoteIdent(EXTERNAL_NOTICE_SEEN_TABLE)}
     WHERE "projectId" = $1 AND "systemId" = $2 AND "operationId" = $3 AND "noticeId" = $4`,
    [notice.projectId, notice.systemId, notice.operationId, notice.noticeId],
  );
}

export async function purgeSeenNotices(db: ExternalCallDb, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - EXTERNAL_NOTICE_SEEN_RETENTION_MS).toISOString();
  await db.query(
    `DELETE FROM ${quoteIdent(EXTERNAL_NOTICE_SEEN_TABLE)} WHERE "arrivedAt" < $1::timestamptz`,
    [cutoff],
  );
}
