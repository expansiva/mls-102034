/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/externalCallStore.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EXTERNAL_CALL_AUDIT_RETENTION,
  EXTERNAL_CALL_AUDIT_TABLE,
  EXTERNAL_CALL_LOG_RETENTION,
  EXTERNAL_CALL_LOG_TABLE,
  EXTERNAL_NOTICE_SEEN_TABLE,
  type ExternalCallDb,
  type ExternalCallRow,
  externalCallAuditDefinition,
  externalCallLogDefinition,
  externalCallViewDefinitions,
  externalNoticeSeenDefinition,
  purgeSeenNotices,
  readExternalCalls,
  recordNoticeSeen,
  writeExternalCall,
} from '/_102034_/l1/server/layer_1_external/connections/external/externalCallStore.js';
import { viewDefinitions } from '/_102034_/l1/server/persistence.js';

const row: ExternalCallRow = {
  id: 'call-1',
  occurredAt: '2026-11-19T12:00:00.000Z',
  direction: 'out',
  projectId: '102034',
  moduleId: 'orders',
  systemId: 'payments',
  operationId: 'charge',
  server: 'pay.example',
  path: '/v1/charges',
  outcome: 'ok',
  denialReason: null,
  httpStatus: 200,
  durationMs: 40,
  bytes: 120,
  actorKind: 'person',
  actorId: 'person-1',
  requestId: 'req-1',
};

function memoryDb(): ExternalCallDb & { sql: string[]; params: unknown[][] } {
  const calls: Array<ExternalCallRow & { table: 'log' | 'audit' }> = [];
  const notices = new Set<string>();
  const sql: string[] = [];
  const params: unknown[][] = [];
  const db: ExternalCallDb & { sql: string[]; params: unknown[][] } = {
    sql,
    params,
    async query(statement, values = []) {
      sql.push(statement);
      params.push([...values]);
      if (statement.startsWith('INSERT INTO "platform_external_call_')) {
        const table = statement.includes('platform_external_call_audit') ? 'audit' : 'log';
        calls.push({
          table,
          id: String(values[0]),
          occurredAt: String(values[1]),
          direction: values[2] === 'in' ? 'in' : 'out',
          projectId: String(values[3]),
          moduleId: String(values[4]),
          systemId: String(values[5]),
          operationId: String(values[6]),
          server: String(values[7]),
          path: String(values[8]),
          outcome: String(values[9]),
          denialReason: typeof values[10] === 'string' ? values[10] : null,
          httpStatus: typeof values[11] === 'number' ? values[11] : null,
          durationMs: typeof values[12] === 'number' ? values[12] : null,
          bytes: typeof values[13] === 'number' ? values[13] : null,
          actorKind: values[14] === 'person' || values[14] === 'agent' ? values[14] : null,
          actorId: typeof values[15] === 'string' ? values[15] : null,
          requestId: typeof values[16] === 'string' ? values[16] : null,
        });
        return { rows: [] };
      }
      if (statement.startsWith('SELECT') && statement.includes('platform_external_call_')) {
        const table = statement.includes('platform_external_call_audit') ? 'audit' : 'log';
        return { rows: calls.filter((entry) => entry.table === table && entry.requestId === values[0]) };
      }
      if (statement.includes('ON CONFLICT') && statement.includes('DO NOTHING')) {
        const key = [values[0], values[1], values[2], values[3]].join('\0');
        if (notices.has(key)) return { rows: [] };
        notices.add(key);
        return { rows: [{ noticeId: values[3] }] };
      }
      return { rows: [] };
    },
  };
  return db;
}

describe('external call store', () => {
  it('writes a call and reads it back by request id', async () => {
    const db = memoryDb();
    await writeExternalCall(db, EXTERNAL_CALL_LOG_TABLE, row);
    const read = await readExternalCalls(db, EXTERNAL_CALL_LOG_TABLE, 'req-1');
    assert.deepEqual(read, [row]);
    assert.equal(await readExternalCalls(db, EXTERNAL_CALL_AUDIT_TABLE, 'req-1').then((rows) => rows.length), 0);
  });

  it('declares both retention policies on the migration statements', () => {
    assert.equal(externalCallLogDefinition.timescale?.hypertable.timeColumn, 'occurredAt');
    assert.equal(externalCallAuditDefinition.timescale?.hypertable.timeColumn, 'occurredAt');
    const statements = externalCallViewDefinitions.flatMap((view) => view.statements);
    assert.deepEqual(viewDefinitions.flatMap((view) => view.statements), statements);
    assert.ok(statements.some((statement) => statement.includes(`add_retention_policy('${EXTERNAL_CALL_LOG_TABLE}', INTERVAL '${EXTERNAL_CALL_LOG_RETENTION}'`)));
    assert.ok(statements.some((statement) => statement.includes(`add_retention_policy('${EXTERNAL_CALL_AUDIT_TABLE}', INTERVAL '${EXTERNAL_CALL_AUDIT_RETENTION}'`)));
    assert.equal(externalNoticeSeenDefinition.timescale, undefined);
    assert.deepEqual(externalNoticeSeenDefinition.primaryKey, ['projectId', 'systemId', 'operationId', 'noticeId']);
  });

  it('inserts a notice once', async () => {
    const db = memoryDb();
    const notice = {
      projectId: '102034',
      systemId: 'payments',
      operationId: 'charge',
      noticeId: 'n-1',
      arrivedAt: '2026-11-19T12:00:00.000Z',
    };
    assert.equal(await recordNoticeSeen(db, notice), true);
    assert.equal(await recordNoticeSeen(db, { ...notice, arrivedAt: '2026-11-19T13:00:00.000Z' }), false);
    const insert = db.sql.find((statement) => statement.includes(EXTERNAL_NOTICE_SEEN_TABLE));
    assert.match(insert ?? '', /ON CONFLICT \("projectId", "systemId", "operationId", "noticeId"\) DO NOTHING/);
  });

  it('purges notices older than 90 days', async () => {
    const db = memoryDb();
    const now = new Date('2026-11-19T00:00:00.000Z');
    await purgeSeenNotices(db, now);
    const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    assert.match(db.sql[0] ?? '', /DELETE FROM "platform_external_notice_seen" WHERE "arrivedAt" < \$1::timestamptz/);
    assert.deepEqual(db.params[0], [cutoff]);
  });
});
