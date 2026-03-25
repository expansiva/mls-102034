/// <mls fileReference="_102034_/l1/mdm/layer_1_external/data/postgres/MdmDataRuntimePostgres.ts" enhancement="_blank" />
import type { Pool, PoolClient } from 'pg';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { createPostgresModuleDataRuntime } from '/_102034_/l1/server/layer_1_external/data/moduleDataRuntime.js';
import { createRuntimeUuid } from '/_102029_/l2/webCrypto.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type {
  IDataRuntime,
  IDocumentRuntime,
  IQueueRuntime,
  ITableRuntime,
} from '/_102034_/l1/server/layer_1_external/data/runtime.js';
import type {
  MdmAuditLogIndexRecord,
  MdmAttachmentRecord,
  MdmCommentRecord,
  MdmDocumentRecord,
  MdmErrorLogRecord,
  MdmEntityIndexRecord,
  MdmMonitoringWriteRecord,
  MdmNumberSequenceRecord,
  MdmOutboxRecord,
  MdmProspectIndexRecord,
  MdmRelationshipRecord,
  MdmStatusHistoryRecord,
  MdmTagRecord,
} from '/_102034_/l1/mdm/module.js';
import { getMdmTableNames } from '/_102034_/l1/mdm/tableNames.js';
import { getSharedPgPool, queryRows, withPgTransaction } from '/_102034_/l1/mdm/layer_1_external/data/postgres/pg.js';

type PgExecutor = Pool | PoolClient;

function quoteIdentifier(identifier: string): string {
  return `"${identifier}"`;
}

function buildWhereClause<TRecord>(where?: Partial<TRecord>, startIndex = 1) {
  const entries = Object.entries(where ?? {}).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return {
      sql: '',
      params: [] as unknown[],
    };
  }

  const params: unknown[] = [];
  return {
    sql: `WHERE ${entries
      .map(([key, value]) => {
        if (value === null) {
          return `${quoteIdentifier(key)} IS NULL`;
        }

        params.push(value);
        return `${quoteIdentifier(key)} = $${startIndex + params.length - 1}`;
      })
      .join(' AND ')}`,
    params,
  };
}

class TableRuntimePostgres<TRecord extends object> implements ITableRuntime<TRecord> {
  public constructor(
    private readonly executor: PgExecutor,
    private readonly tableName: string,
  ) {}

  public async findOne(input: { where: Partial<TRecord> }): Promise<TRecord | null> {
    const where = buildWhereClause(input.where);
    const rows = await queryRows<TRecord>(
      this.executor,
      `SELECT * FROM ${quoteIdentifier(this.tableName)} ${where.sql} LIMIT 1`,
      where.params,
    );
    return rows[0] ?? null;
  }

  public async findMany(input?: {
    where?: Partial<TRecord>;
    orderBy?: { field: keyof TRecord; direction: 'asc' | 'desc' };
    limit?: number;
  }): Promise<TRecord[]> {
    const where = buildWhereClause(input?.where);
    const orderSql = input?.orderBy
      ? `ORDER BY ${quoteIdentifier(String(input.orderBy.field))} ${input.orderBy.direction.toUpperCase()}`
      : '';
    const limitSql = input?.limit ? `LIMIT ${input.limit}` : '';
    return queryRows<TRecord>(
      this.executor,
      `SELECT * FROM ${quoteIdentifier(this.tableName)} ${where.sql} ${orderSql} ${limitSql}`.trim(),
      where.params,
    );
  }

  public async findManyByValues<TKey extends keyof TRecord>(input: {
    field: TKey;
    values: Array<NonNullable<TRecord[TKey]>>;
    limit?: number;
  }): Promise<TRecord[]> {
    if (input.values.length === 0) {
      return [];
    }

    const limitSql = input.limit ? `LIMIT ${input.limit}` : '';
    return queryRows<TRecord>(
      this.executor,
      `SELECT * FROM ${quoteIdentifier(this.tableName)} WHERE ${quoteIdentifier(String(input.field))} = ANY($1) ${limitSql}`.trim(),
      [input.values],
    );
  }

  public async insert(input: { record: TRecord }): Promise<void> {
    const entries = Object.entries(input.record);
    const columns = entries.map(([key]) => quoteIdentifier(key));
    const placeholders = entries.map((_, index) => `$${index + 1}`);
    await this.executor.query(
      `INSERT INTO ${quoteIdentifier(this.tableName)} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
      entries.map(([, value]) => value),
    );
  }

  public async update(input: { where: Partial<TRecord>; patch: Partial<TRecord> }): Promise<void> {
    const patchEntries = Object.entries(input.patch).filter(([, value]) => value !== undefined);
    if (patchEntries.length === 0) {
      return;
    }
    const where = buildWhereClause(input.where, patchEntries.length + 1);
    const setSql = patchEntries
      .map(([key], index) => `${quoteIdentifier(key)} = $${index + 1}`)
      .join(', ');
    await this.executor.query(
      `UPDATE ${quoteIdentifier(this.tableName)} SET ${setSql} ${where.sql}`.trim(),
      [...patchEntries.map(([, value]) => value), ...where.params],
    );
  }

  public async delete(input: { where: Partial<TRecord> }): Promise<void> {
    const where = buildWhereClause(input.where);
    await this.executor.query(
      `DELETE FROM ${quoteIdentifier(this.tableName)} ${where.sql}`.trim(),
      where.params,
    );
  }
}

class DocumentRuntimePostgres implements IDocumentRuntime {
  public constructor(
    private readonly executor: PgExecutor,
    private readonly tableName: string,
  ) {}

  public async get(input: { mdmId: string }): Promise<MdmDocumentRecord | null> {
    const rows = await queryRows<MdmDocumentRecord>(
      this.executor,
      `SELECT "mdmId", "version", "details" FROM "${this.tableName}" WHERE "mdmId" = $1 LIMIT 1`,
      [input.mdmId],
    );
    return rows[0] ?? null;
  }

  public async getMany(input: { mdmIds: string[] }): Promise<MdmDocumentRecord[]> {
    if (input.mdmIds.length === 0) {
      return [];
    }

    return queryRows<MdmDocumentRecord>(
      this.executor,
      `SELECT "mdmId", "version", "details" FROM "${this.tableName}" WHERE "mdmId" = ANY($1)`,
      [input.mdmIds],
    );
  }

  public async put(input: { record: MdmDocumentRecord; expectedVersion?: number | null }): Promise<void> {
    if (input.expectedVersion !== undefined && input.expectedVersion !== null) {
      const result = await this.executor.query(
        `UPDATE "${this.tableName}" SET "version" = $2, "details" = $3::jsonb WHERE "mdmId" = $1 AND "version" = $4`,
        [input.record.mdmId, input.record.version, input.record.details, input.expectedVersion],
      );
      if (result.rowCount === 0) {
        throw new AppError('CONCURRENCY_CONFLICT', 'Version mismatch', 409);
      }
      return;
    }

    await this.executor.query(
      `INSERT INTO "${this.tableName}" ("mdmId", "version", "details")
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT ("mdmId") DO UPDATE SET "version" = EXCLUDED."version", "details" = EXCLUDED."details"`,
      [input.record.mdmId, input.record.version, input.record.details],
    );
  }

  public async delete(input: { mdmId: string }): Promise<void> {
    await this.executor.query(`DELETE FROM "${this.tableName}" WHERE "mdmId" = $1`, [input.mdmId]);
  }
}

class QueueRuntimePostgres implements IQueueRuntime {
  public constructor(
    private readonly executor: PgExecutor,
    private readonly outboxTableName: string,
  ) {}

  public async publish(input: { topic: string; payload: unknown }): Promise<void> {
    const payload = input.payload as MdmOutboxRecord | Record<string, unknown>;
    const nowIso = new Date().toISOString();
    await this.executor.query(
      `INSERT INTO ${quoteIdentifier(this.outboxTableName)}
       ("id", "aggregateType", "aggregateId", "eventType", "payload", "attemptCount", "processedAt", "lastError", "createdAt", "updatedAt", "topic")
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)`,
      [
        String(payload.id ?? createRuntimeUuid()),
        String(payload.aggregateType ?? 'QueueMessage'),
        String(payload.aggregateId ?? input.topic),
        String(payload.eventType ?? 'QueuePublish'),
        JSON.stringify(payload),
        Number(payload.attemptCount ?? 0),
        payload.processedAt ?? nowIso,
        payload.lastError ?? null,
        String(payload.createdAt ?? nowIso),
        String(payload.updatedAt ?? nowIso),
        input.topic,
      ],
    );
  }

  public async list(input?: { topic?: string }): Promise<Array<{ topic: string; payload: unknown }>> {
    const rows = await queryRows<{ topic: string; payload: Record<string, unknown> }>(
      this.executor,
      input?.topic
        ? `SELECT "topic", "payload" FROM ${quoteIdentifier(this.outboxTableName)} WHERE "topic" = $1 ORDER BY "createdAt" ASC`
        : `SELECT "topic", "payload" FROM ${quoteIdentifier(this.outboxTableName)} ORDER BY "createdAt" ASC`,
      input?.topic ? [input.topic] : [],
    );
    return rows.map((row) => ({ topic: row.topic, payload: row.payload }));
  }
}

function createPostgresRuntimeWithExecutor(env: AppEnv, executor: PgExecutor): IDataRuntime {
  const tableNames = getMdmTableNames(env.appEnv);
  const runtime: IDataRuntime = {
    mode: 'postgres',
    mdmDocument: new DocumentRuntimePostgres(executor, tableNames.documents),
    mdmEntityIndex: new TableRuntimePostgres<MdmEntityIndexRecord>(executor, tableNames.documentsEntitiesIndex),
    mdmProspectIndex: new TableRuntimePostgres<MdmProspectIndexRecord>(executor, tableNames.documentsProspectsIndex),
    mdmRelationship: new TableRuntimePostgres<MdmRelationshipRecord>(executor, tableNames.relationship),
    mdmProspectRelationship: new TableRuntimePostgres<MdmRelationshipRecord>(
      executor,
      tableNames.prospectRelationship,
    ),
    mdmAuditLog: new TableRuntimePostgres<MdmAuditLogIndexRecord>(executor, tableNames.auditLog),
    mdmComment: new TableRuntimePostgres<MdmCommentRecord>(executor, tableNames.comment),
    mdmAttachment: new TableRuntimePostgres<MdmAttachmentRecord>(executor, tableNames.attachment),
    mdmNumberSequence: new TableRuntimePostgres<MdmNumberSequenceRecord>(
      executor,
      tableNames.numberSequence,
    ),
    mdmMonitoringWrite: new TableRuntimePostgres<MdmMonitoringWriteRecord>(
      executor,
      tableNames.monitoringWrite,
    ),
    mdmErrorLog: new TableRuntimePostgres<MdmErrorLogRecord>(executor, tableNames.errorLog),
    mdmStatusHistory: new TableRuntimePostgres<MdmStatusHistoryRecord>(
      executor,
      tableNames.statusHistory,
    ),
    mdmTag: new TableRuntimePostgres<MdmTagRecord>(executor, tableNames.tag),
    mdmOutbox: new TableRuntimePostgres<MdmOutboxRecord>(executor, tableNames.outbox),
    pgQueue: new QueueRuntimePostgres(executor, tableNames.outbox),
    moduleData: createPostgresModuleDataRuntime(env, executor),
    async runInTransaction<TValue>() {
      throw new AppError('INVALID_RUNTIME', 'Nested transaction runtime is not supported directly', 500);
    },
  };

  runtime.runInTransaction = async <TValue>(callback: (data: IDataRuntime) => Promise<TValue>) => {
    if ('release' in executor) {
      return callback(runtime);
    }

    return withPgTransaction(executor, async (client) =>
      callback(createPostgresRuntimeWithExecutor(env, client)),
    );
  };

  return runtime;
}

export function createPostgresDataRuntime(env: AppEnv): IDataRuntime {
  return createPostgresRuntimeWithExecutor(env, getSharedPgPool(env));
}
