/// <mls fileReference="_102034_/l1/server/layer_1_external/data/moduleDataRuntime.ts" enhancement="_blank" />
import type { Pool, PoolClient } from 'pg';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { getSharedPgPool, queryRows, withPgTransaction } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import { createRuntimeUuid } from '/_102029_/l2/webCrypto.js';
import type { ResolvedTableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import {
  requiresWriteBehind,
  usesPostgres,
} from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import {
  findResolvedTableDefinition,
  loadResolvedTableDefinitions,
} from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

type PgExecutor = Pool | PoolClient;

export interface IFindManyInput<TWhere> {
  where?: Partial<TWhere>;
  orderBy?: {
    field: keyof TWhere;
    direction: 'asc' | 'desc';
  };
  limit?: number;
}

export interface ITableRepository<TRecord> {
  findOne(input: { where: Partial<TRecord> }): Promise<TRecord | null>;
  findMany(input?: IFindManyInput<TRecord>): Promise<TRecord[]>;
  findManyByValues<TKey extends keyof TRecord>(input: {
    field: TKey;
    values: Array<NonNullable<TRecord[TKey]>>;
    limit?: number;
  }): Promise<TRecord[]>;
  insert(input: { record: TRecord }): Promise<void>;
  upsert(input: { record: TRecord }): Promise<void>;
  update(input: { where: Partial<TRecord>; patch: Partial<TRecord> }): Promise<void>;
  delete(input: { where: Partial<TRecord> }): Promise<void>;
}

export interface IDocumentRepository<TDocument> {
  get(input: { key: Record<string, unknown> }): Promise<TDocument | null>;
  put(input: { document: TDocument }): Promise<void>;
  delete(input: { key: Record<string, unknown> }): Promise<void>;
  scanAll(): Promise<TDocument[]>;
}

export interface IModuleDataRuntime {
  getTable<TRecord extends object>(repositoryNameOrTableName: string): Promise<ITableRepository<TRecord>>;
  listTables(): Promise<ResolvedTableDefinition[]>;
  runInTransaction<TValue>(callback: (runtime: IModuleDataRuntime) => Promise<TValue>): Promise<TValue>;
}

type RegistryWriteBehindPayload = {
  tableName: string;
  repositoryName: string;
  operation: 'upsert' | 'delete';
  key: Record<string, unknown>;
  item?: Record<string, unknown>;
};

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
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

function matchesWhere<TRecord>(record: TRecord, where?: Partial<TRecord>): boolean {
  if (!where) {
    return true;
  }

  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) {
      return true;
    }
    return (record as Record<string, unknown>)[key] === value;
  });
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  return String(left ?? '').localeCompare(String(right ?? ''));
}

function getPrimaryKey(definition: ResolvedTableDefinition, record: Record<string, unknown>) {
  return Object.fromEntries(definition.primaryKey.map((key) => [key, record[key]]));
}

function serializeAggregateId(key: Record<string, unknown>): string {
  return Object.entries(key)
    .map(([field, value]) => `${field}=${String(value ?? '')}`)
    .join('|');
}

async function insertRegistryOutboxRecord(
  executor: PgExecutor,
  env: AppEnv,
  definition: ResolvedTableDefinition,
  payload: RegistryWriteBehindPayload,
) {
  const outboxDefinition = await findResolvedTableDefinition('mdmOutbox', env);
  const nowIso = new Date().toISOString();
  await executor.query(
    `INSERT INTO ${quoteIdentifier(outboxDefinition.tableName)}
     ("id", "aggregateType", "aggregateId", "eventType", "payload", "attemptCount", "processedAt", "lastError", "createdAt", "updatedAt", "topic")
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)`,
    [
      createRuntimeUuid(),
      'RegistryTable',
      `${definition.tableName}:${serializeAggregateId(payload.key)}`,
      payload.operation === 'delete' ? 'DeleteRegistryTableRecord' : 'UpsertRegistryTableRecord',
      JSON.stringify(payload),
      0,
      null,
      null,
      nowIso,
      nowIso,
      `registry.${definition.repositoryName}.write-behind`,
    ],
  );
}

class MemoryTableRepository<TRecord extends object> implements ITableRepository<TRecord> {
  public constructor(
    private readonly definition: ResolvedTableDefinition,
    private readonly records: TRecord[],
  ) {}

  public async findOne(input: { where: Partial<TRecord> }): Promise<TRecord | null> {
    const record = this.records.find((entry) => matchesWhere(entry, input.where));
    return record ? { ...record } : null;
  }

  public async findMany(input?: IFindManyInput<TRecord>): Promise<TRecord[]> {
    const rows = this.records.filter((entry) => matchesWhere(entry, input?.where));
    if (input?.orderBy) {
      const { field, direction } = input.orderBy;
      rows.sort((left, right) => {
        const result = compareValues(
          (left as Record<string, unknown>)[String(field)],
          (right as Record<string, unknown>)[String(field)],
        );
        return direction === 'asc' ? result : -result;
      });
    }

    const limited = input?.limit ? rows.slice(0, input.limit) : rows;
    return limited.map((entry) => ({ ...entry }));
  }

  public async findManyByValues<TKey extends keyof TRecord>(input: {
    field: TKey;
    values: Array<NonNullable<TRecord[TKey]>>;
    limit?: number;
  }): Promise<TRecord[]> {
    const values = new Set(input.values);
    const rows = this.records.filter((entry) =>
      values.has((entry as Record<string, unknown>)[String(input.field)] as NonNullable<TRecord[TKey]>),
    );
    const limited = input.limit ? rows.slice(0, input.limit) : rows;
    return limited.map((entry) => ({ ...entry }));
  }

  public async insert(input: { record: TRecord }): Promise<void> {
    this.records.push({ ...input.record });
  }

  public async upsert(input: { record: TRecord }): Promise<void> {
    const key = getPrimaryKey(this.definition, input.record as Record<string, unknown>);
    const index = this.records.findIndex((entry) => matchesWhere(entry, key as Partial<TRecord>));
    if (index >= 0) {
      this.records[index] = { ...input.record };
      return;
    }
    this.records.push({ ...input.record });
  }

  public async update(input: { where: Partial<TRecord>; patch: Partial<TRecord> }): Promise<void> {
    const record = this.records.find((entry) => matchesWhere(entry, input.where));
    if (!record) {
      throw new AppError('NOT_FOUND', 'Record not found', 404, input.where);
    }
    Object.assign(record, input.patch);
  }

  public async delete(input: { where: Partial<TRecord> }): Promise<void> {
    const next = this.records.filter((entry) => !matchesWhere(entry, input.where));
    this.records.length = 0;
    this.records.push(...next);
  }
}

class PostgresTableRepository<TRecord extends object> implements ITableRepository<TRecord> {
  public constructor(
    private readonly definition: ResolvedTableDefinition,
    private readonly env: AppEnv,
    private readonly executor: PgExecutor,
  ) {}

  public async findOne(input: { where: Partial<TRecord> }): Promise<TRecord | null> {
    const where = buildWhereClause(input.where);
    const rows = await queryRows<TRecord>(
      this.executor,
      `SELECT * FROM ${quoteIdentifier(this.definition.tableName)} ${where.sql} LIMIT 1`,
      where.params,
    );
    return rows[0] ?? null;
  }

  public async findMany(input?: IFindManyInput<TRecord>): Promise<TRecord[]> {
    const where = buildWhereClause(input?.where);
    const orderSql = input?.orderBy
      ? `ORDER BY ${quoteIdentifier(String(input.orderBy.field))} ${input.orderBy.direction.toUpperCase()}`
      : '';
    const limitSql = input?.limit ? `LIMIT ${input.limit}` : '';
    return queryRows<TRecord>(
      this.executor,
      `SELECT * FROM ${quoteIdentifier(this.definition.tableName)} ${where.sql} ${orderSql} ${limitSql}`.trim(),
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
      `SELECT * FROM ${quoteIdentifier(this.definition.tableName)}
       WHERE ${quoteIdentifier(String(input.field))} = ANY($1)
       ${limitSql}`.trim(),
      [input.values],
    );
  }

  public async insert(input: { record: TRecord }): Promise<void> {
    await this.executeMutation(input.record as Record<string, unknown>, async (executor) => {
      const entries = Object.entries(input.record);
      const columns = entries.map(([key]) => quoteIdentifier(key));
      const placeholders = entries.map((_, index) => `$${index + 1}`);
      await executor.query(
        `INSERT INTO ${quoteIdentifier(this.definition.tableName)} (${columns.join(', ')})
         VALUES (${placeholders.join(', ')})`,
        entries.map(([, value]) => value),
      );
    });
  }

  public async upsert(input: { record: TRecord }): Promise<void> {
    await this.executeMutation(input.record as Record<string, unknown>, async (executor) => {
      const entries = Object.entries(input.record);
      const columns = entries.map(([key]) => quoteIdentifier(key));
      const placeholders = entries.map((_, index) => `$${index + 1}`);
      const updateSql = entries
        .filter(([key]) => !this.definition.primaryKey.includes(key))
        .map(([key]) => `${quoteIdentifier(key)} = EXCLUDED.${quoteIdentifier(key)}`)
        .join(', ');
      await executor.query(
        `INSERT INTO ${quoteIdentifier(this.definition.tableName)} (${columns.join(', ')})
         VALUES (${placeholders.join(', ')})
         ON CONFLICT (${this.definition.primaryKey.map((key) => quoteIdentifier(key)).join(', ')})
         DO UPDATE SET ${updateSql}`,
        entries.map(([, value]) => value),
      );
    });
  }

  public async update(input: { where: Partial<TRecord>; patch: Partial<TRecord> }): Promise<void> {
    await this.executeMutation(undefined, async (executor) => {
      const patchEntries = Object.entries(input.patch).filter(([, value]) => value !== undefined);
      if (patchEntries.length === 0) {
        return;
      }
      const where = buildWhereClause(input.where, patchEntries.length + 1);
      const setSql = patchEntries
        .map(([key], index) => `${quoteIdentifier(key)} = $${index + 1}`)
        .join(', ');
      await executor.query(
        `UPDATE ${quoteIdentifier(this.definition.tableName)} SET ${setSql} ${where.sql}`.trim(),
        [...patchEntries.map(([, value]) => value), ...where.params],
      );

      if (requiresWriteBehind(this.definition)) {
        const rows = await queryRows<Record<string, unknown>>(
          executor,
          `SELECT * FROM ${quoteIdentifier(this.definition.tableName)} ${where.sql} LIMIT 1`,
          where.params,
        );
        const row = rows[0];
        if (row) {
          await insertRegistryOutboxRecord(executor, this.env, this.definition, {
            tableName: this.definition.tableName,
            repositoryName: this.definition.repositoryName,
            operation: 'upsert',
            key: getPrimaryKey(this.definition, row),
            item: row,
          });
        }
      }
    });
  }

  public async delete(input: { where: Partial<TRecord> }): Promise<void> {
    await this.executeMutation(undefined, async (executor) => {
      const where = buildWhereClause(input.where);
      const rowsToDelete = requiresWriteBehind(this.definition)
        ? await queryRows<Record<string, unknown>>(
            executor,
            `SELECT * FROM ${quoteIdentifier(this.definition.tableName)} ${where.sql}`,
            where.params,
          )
        : [];

      await executor.query(
        `DELETE FROM ${quoteIdentifier(this.definition.tableName)} ${where.sql}`.trim(),
        where.params,
      );

      for (const row of rowsToDelete) {
        await insertRegistryOutboxRecord(executor, this.env, this.definition, {
          tableName: this.definition.tableName,
          repositoryName: this.definition.repositoryName,
          operation: 'delete',
          key: getPrimaryKey(this.definition, row),
        });
      }
    });
  }

  private async executeMutation(
    record: Record<string, unknown> | undefined,
    operation: (executor: PgExecutor) => Promise<void>,
  ) {
    if (!requiresWriteBehind(this.definition)) {
      await operation(this.executor);
      return;
    }

    if ('release' in this.executor) {
      await operation(this.executor);
      if (record) {
        await insertRegistryOutboxRecord(this.executor, this.env, this.definition, {
          tableName: this.definition.tableName,
          repositoryName: this.definition.repositoryName,
          operation: 'upsert',
          key: getPrimaryKey(this.definition, record),
          item: record,
        });
      }
      return;
    }

    await withPgTransaction(this.executor, async (client) => {
      await operation(client);
      if (record) {
        await insertRegistryOutboxRecord(client, this.env, this.definition, {
          tableName: this.definition.tableName,
          repositoryName: this.definition.repositoryName,
          operation: 'upsert',
          key: getPrimaryKey(this.definition, record),
          item: record,
        });
      }
    });
  }
}

class MemoryModuleDataRuntime implements IModuleDataRuntime {
  private readonly store = new Map<string, object[]>();

  public constructor(private readonly env: AppEnv) {}

  public async getTable<TRecord extends object>(repositoryNameOrTableName: string): Promise<ITableRepository<TRecord>> {
    const definition = await findResolvedTableDefinition(repositoryNameOrTableName, this.env);
    if (!usesPostgres(definition)) {
      throw new AppError(
        'PERSISTENCE_TABLE_UNAVAILABLE',
        'Dynamo-only tables are not available in memory runtime',
        400,
        { repositoryNameOrTableName },
      );
    }

    if (!this.store.has(definition.repositoryName)) {
      this.store.set(definition.repositoryName, []);
    }

    return new MemoryTableRepository<TRecord>(
      definition,
      this.store.get(definition.repositoryName)! as TRecord[],
    );
  }

  public async listTables(): Promise<ResolvedTableDefinition[]> {
    return loadResolvedTableDefinitions(this.env);
  }

  public async runInTransaction<TValue>(callback: (runtime: IModuleDataRuntime) => Promise<TValue>): Promise<TValue> {
    return callback(this);
  }
}

class PostgresModuleDataRuntime implements IModuleDataRuntime {
  private readonly repositoryCache = new Map<string, ITableRepository<object>>();

  public constructor(
    private readonly env: AppEnv,
    private readonly executor: PgExecutor = getSharedPgPool(env),
  ) {}

  public async getTable<TRecord extends object>(repositoryNameOrTableName: string): Promise<ITableRepository<TRecord>> {
    const definition = await findResolvedTableDefinition(repositoryNameOrTableName, this.env);
    if (!usesPostgres(definition)) {
      throw new AppError(
        'PERSISTENCE_TABLE_UNAVAILABLE',
        'Requested repository does not have a local PostgreSQL table',
        400,
        { repositoryNameOrTableName },
      );
    }

    const cacheKey = definition.repositoryName;
    const cached = this.repositoryCache.get(cacheKey);
    if (cached) {
      return cached as ITableRepository<TRecord>;
    }

    const repository = new PostgresTableRepository<TRecord>(definition, this.env, this.executor);
    this.repositoryCache.set(cacheKey, repository as ITableRepository<object>);
    return repository;
  }

  public async listTables(): Promise<ResolvedTableDefinition[]> {
    return loadResolvedTableDefinitions(this.env);
  }

  public async runInTransaction<TValue>(callback: (runtime: IModuleDataRuntime) => Promise<TValue>): Promise<TValue> {
    if ('release' in this.executor) {
      return callback(this);
    }

    return withPgTransaction(this.executor, async (client) =>
      callback(new PostgresModuleDataRuntime(this.env, client)),
    );
  }
}

export function createMemoryModuleDataRuntime(env: AppEnv): IModuleDataRuntime {
  return new MemoryModuleDataRuntime(env);
}

export function createPostgresModuleDataRuntime(
  env: AppEnv,
  executor: PgExecutor = getSharedPgPool(env),
): IModuleDataRuntime {
  return new PostgresModuleDataRuntime(env, executor);
}
