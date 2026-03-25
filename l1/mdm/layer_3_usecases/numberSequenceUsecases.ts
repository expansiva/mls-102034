/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/numberSequenceUsecases.ts" enhancement="_blank" />
import { queryRows, withPgTransaction, getSharedPgPool } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { AuditLogService, runMonitoredWrite } from '/_102034_/l1/mdm/layer_3_usecases/core/DataRecordService.js';
import { getMdmTableNames } from '/_102034_/l1/mdm/tableNames.js';
import type {
  MdmNumberSequenceRecord,
  MdmOutboxRecord,
  NumberSequenceNextParams,
} from '/_102034_/l1/mdm/module.js';
import { moduleConfig } from '/_102034_/l1/mdm/module.js';

function formatSequence(record: MdmNumberSequenceRecord): string {
  const yearPart = record.yearSegment ? `${new Date(record.lastIssuedAt).getUTCFullYear()}-` : '';
  const rawValue = String(record.currentValue);
  const padded = record.padding && record.padding > 0
    ? rawValue.padStart(record.padding, '0')
    : rawValue;
  return `${record.prefix ?? ''}${yearPart}${padded}`;
}

function buildSequenceOutbox(ctx: RequestContext, record: MdmNumberSequenceRecord): MdmOutboxRecord {
  const nowIso = ctx.clock.nowIso();
  return {
    id: ctx.idGenerator.newId(),
    topic: 'mdm.number-sequence.write-behind',
    aggregateType: 'MdmNumberSequence',
    aggregateId: record.id,
    eventType: 'UpsertNumberSequence',
    payload: record as unknown as Record<string, unknown>,
    attemptCount: 0,
    processedAt: null,
    lastError: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export async function nextSequence(ctx: RequestContext, params: NumberSequenceNextParams) {
  return runMonitoredWrite(ctx, {
    entityType: 'MdmNumberSequence',
    entityId: params.sequenceKey,
    module: 'mdm',
    routine: 'mdm.numberSequence.next',
    action: 'update',
  }, async () => {
    const nowIso = ctx.clock.nowIso();

    if (ctx.data.mode === 'postgres') {
      const env = readAppEnv();
      const pool = getSharedPgPool(env);
      const tableNames = getMdmTableNames(env.appEnv);
      return withPgTransaction(pool, async (client) => {
        const rows = await queryRows<MdmNumberSequenceRecord>(
          client,
          `SELECT * FROM "${tableNames.numberSequence}" WHERE "sequenceKey" = $1 FOR UPDATE`,
          [params.sequenceKey],
        );
        const current = rows[0] ?? null;
        const nextRecord: MdmNumberSequenceRecord = current
          ? {
              ...current,
              currentValue: current.currentValue + (current.increment || 1),
              lastIssuedAt: nowIso,
            }
          : {
              id: ctx.idGenerator.newId(),
              sequenceKey: params.sequenceKey,
              prefix: params.prefix ?? null,
              currentValue: 1,
              increment: params.increment ?? 1,
              padding: params.padding ?? null,
              yearSegment: params.yearSegment ?? false,
              scopeType: params.scopeType,
              scopeId: params.scopeId ?? null,
              lastIssuedAt: nowIso,
              createdAt: nowIso,
              details: params.details ?? null,
            };

        if (current) {
          await client.query(
            `UPDATE "${tableNames.numberSequence}" SET "currentValue" = $2, "lastIssuedAt" = $3, "details" = $4::jsonb WHERE "id" = $1`,
            [nextRecord.id, nextRecord.currentValue, nextRecord.lastIssuedAt, nextRecord.details],
          );
        } else {
          await client.query(
            `INSERT INTO "${tableNames.numberSequence}" ("id","sequenceKey","prefix","currentValue","increment","padding","yearSegment","scopeType","scopeId","lastIssuedAt","createdAt","details") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
            [
              nextRecord.id,
              nextRecord.sequenceKey,
              nextRecord.prefix,
              nextRecord.currentValue,
              nextRecord.increment,
              nextRecord.padding,
              nextRecord.yearSegment,
              nextRecord.scopeType,
              nextRecord.scopeId,
              nextRecord.lastIssuedAt,
              nextRecord.createdAt,
              nextRecord.details,
            ],
          );
        }

        const runtime = ctx.data;
        await AuditLogService.record(ctx, runtime, {
          entityType: 'MdmNumberSequence',
          entityId: nextRecord.id,
          action: current ? 'update' : 'create',
          module: 'mdm',
          routine: 'mdm.numberSequence.next',
          before: current as unknown as Record<string, unknown> | null,
          after: nextRecord as unknown as Record<string, unknown>,
        });
        if (moduleConfig.persistence.writeMode === 'writeBehind') {
          await runtime.mdmOutbox.insert({ record: buildSequenceOutbox(ctx, nextRecord) });
        }

        return {
          record: nextRecord,
          value: formatSequence(nextRecord),
        };
      });
    }

    const current = await ctx.data.mdmNumberSequence.findOne({ where: { sequenceKey: params.sequenceKey } });
    const nextRecord: MdmNumberSequenceRecord = current
      ? {
          ...current,
          currentValue: current.currentValue + (current.increment || 1),
          lastIssuedAt: nowIso,
        }
      : {
          id: ctx.idGenerator.newId(),
          sequenceKey: params.sequenceKey,
          prefix: params.prefix ?? null,
          currentValue: 1,
          increment: params.increment ?? 1,
          padding: params.padding ?? null,
          yearSegment: params.yearSegment ?? false,
          scopeType: params.scopeType,
          scopeId: params.scopeId ?? null,
          lastIssuedAt: nowIso,
          createdAt: nowIso,
          details: params.details ?? null,
        };

    await ctx.data.runInTransaction(async (runtime) => {
      if (current) {
        await runtime.mdmNumberSequence.update({ where: { id: current.id }, patch: nextRecord });
      } else {
        await runtime.mdmNumberSequence.insert({ record: nextRecord });
      }
      await AuditLogService.record(ctx, runtime, {
        entityType: 'MdmNumberSequence',
        entityId: nextRecord.id,
        action: current ? 'update' : 'create',
        module: 'mdm',
        routine: 'mdm.numberSequence.next',
        before: current as unknown as Record<string, unknown> | null,
        after: nextRecord as unknown as Record<string, unknown>,
      });
      if (moduleConfig.persistence.writeMode === 'writeBehind') {
        await runtime.mdmOutbox.insert({ record: buildSequenceOutbox(ctx, nextRecord) });
      }
    });

    return {
      record: nextRecord,
      value: formatSequence(nextRecord),
    };
  });
}
