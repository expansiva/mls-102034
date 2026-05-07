/// <mls fileReference="_102034_/l1/monitor/layer_1_external/data/postgres/MonitorRuntimePostgres.ts" enhancement="_blank" />
import {
  DescribeTableCommand,
  DynamoDBClient,
  ScanCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { Pool } from 'pg';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { getSharedPgPool, queryRows, withPgTransaction } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import {
  loadResolvedDynamoTableDefinitions,
  loadResolvedPostgresTableDefinitions,
} from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { MonitorPersistenceMetadata } from '/_102034_/l1/monitor/layer_1_external/data/persistence/MonitorPersistenceMetadata.js';
import type {
  MonitorBffExecutionAggregateMinuteRecord,
  MonitorBffExecutionLogRecord,
  MonitorExecutionEvent,
} from '/_102034_/l1/monitor/module.js';

const POSTGRES_INSPECT_PAGE_SIZE = 50;
const DYNAMO_INSPECT_PAGE_SIZE = 50;

type MonitorPostgresColumn = {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
};

type MonitorPostgresIndex = {
  name: string;
  unique: boolean;
  method: string;
  columns: string[];
};

type MonitorDynamoKey = Record<string, AttributeValue>;

export function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }
  if (typeof value === 'string') {
    if (value.startsWith('{') && value.endsWith('}')) {
      return value.slice(1, -1).split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
    }
    return [value];
  }
  return [];
}

function quoteIdent(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function isSafeMonitorIdentifier(value: string) {
  return /^[A-Za-z0-9_.-]+$/.test(value);
}

export function normalizeInspectFilters(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const entries = Object.entries(input as Record<string, unknown>)
    .filter((entry) => typeof entry[1] === 'string')
    .map(([key, value]) => [key.trim(), String(value).trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0);

  return Object.fromEntries(entries);
}

function serializeMonitorValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => serializeMonitorValue(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, serializeMonitorValue(entry)]),
    );
  }
  return value;
}

function parseAttributeNumber(value: string): number | string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

function attributeValueToJs(value: AttributeValue | undefined): unknown {
  if (!value) {
    return null;
  }
  if ('S' in value) {
    return value.S;
  }
  if ('N' in value) {
    return value.N ? parseAttributeNumber(value.N) : null;
  }
  if ('BOOL' in value) {
    return value.BOOL;
  }
  if ('NULL' in value && value.NULL) {
    return null;
  }
  if ('SS' in value) {
    return value.SS;
  }
  if ('NS' in value) {
    return (value.NS ?? []).map((entry) => parseAttributeNumber(entry));
  }
  if ('L' in value) {
    return (value.L ?? []).map((entry) => attributeValueToJs(entry));
  }
  if ('M' in value) {
    return Object.fromEntries(Object.entries(value.M ?? {}).map(([key, entry]) => [key, attributeValueToJs(entry)]));
  }
  if ('B' in value) {
    return `<binary:${value.B?.length ?? 0}>`;
  }
  if ('BS' in value) {
    return (value.BS ?? []).map((entry) => `<binary:${entry.length}>`);
  }
  return null;
}

function inferDynamoColumnType(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (typeof value === 'object') {
    return 'object';
  }
  return typeof value;
}

function isScalarDynamoValue(value: unknown) {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

export function normalizeDynamoKey(key: MonitorDynamoKey | undefined): string | null {
  if (!key) {
    return null;
  }

  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

export function decodeDynamoKey(cursor?: string | null): MonitorDynamoKey | undefined {
  if (!cursor) {
    return undefined;
  }

  const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid DynamoDB cursor');
  }

  return parsed as MonitorDynamoKey;
}

function createDynamoClient(env: AppEnv) {
  return new DynamoDBClient({
    region: env.awsRegion,
    credentials:
      env.awsAccessKeyId && env.awsSecretAccessKey
        ? {
            accessKeyId: env.awsAccessKeyId,
            secretAccessKey: env.awsSecretAccessKey,
            sessionToken: env.awsSessionToken,
          }
        : undefined,
  });
}

function toMinuteBucket(isoTimestamp: string): string {
  return `${isoTimestamp.slice(0, 16)}:00Z`;
}

function isMissingMonitorStorageError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { code?: string; message?: string };
  return (
    candidate.code === '42P01' ||
    candidate.message?.includes('monitor_bff_execution_log') === true ||
    candidate.message?.includes('monitor_bff_execution_agg_minute') === true
  );
}

function createPgPool(env: AppEnv, databaseName?: string) {
  return new Pool({
    host: env.pgHost,
    port: env.pgPort,
    database: databaseName ?? env.pgDatabase,
    user: env.pgUser,
    password: env.pgPassword,
  });
}

export function parseRoutineParts(routine: string): {
  module: string;
  pageName: string;
  command: string;
} {
  const parts = routine.split('.');
  if (parts.length === 2) {
    return {
      module: parts[0] ?? 'unknown',
      pageName: parts[0] ?? 'unknown',
      command: parts[1] ?? 'unknown',
    };
  }
  return {
    module: parts[0] ?? 'unknown',
    pageName: parts[1] ?? 'unknown',
    command: parts.slice(2).join('.') || 'unknown',
  };
}

export function getStatusGroup(statusCode: number) {
  if (statusCode === 404) {
    return 'not_found' as const;
  }
  if (statusCode >= 500) {
    return 'server_error' as const;
  }
  if (statusCode >= 400) {
    return 'client_error' as const;
  }
  return 'success' as const;
}

export class MonitorRuntimePostgres {
  private readonly metadata: MonitorPersistenceMetadata;

  public constructor(private readonly env: AppEnv = readAppEnv()) {
    this.metadata = new MonitorPersistenceMetadata(env);
  }

  public async recordExecution(event: MonitorExecutionEvent): Promise<void> {
    if (this.env.runtimeMode !== 'postgres') {
      return;
    }

    const pool = getSharedPgPool(this.env);

    await pool.query(
      `INSERT INTO monitor_bff_execution_log
        ("id", "requestId", "traceId", "userId", "routine", "module", "pageName", "command", "source", "statusCode", "statusGroup", "ok", "durationMs", "errorCode", "errorStack", "startedAt", "finishedAt")
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        event.requestId,
        event.requestId,
        event.traceId,
        event.userId,
        event.routine,
        event.module,
        event.pageName,
        event.command,
        event.source,
        event.statusCode,
        event.statusGroup,
        event.ok,
        event.durationMs,
        event.errorCode ?? null,
        event.errorStack ?? null,
        event.startedAt,
        event.finishedAt,
      ],
    );
  }

  public static isMissingMonitorStorageError(error: unknown) {
    return isMissingMonitorStorageError(error);
  }

  public async listKnownPostgresTables(): Promise<Array<{
    tableName: string;
    description: string | null;
    moduleId: string | null;
    repositoryName: string | null;
    storageProfile: string | null;
    backupHot: boolean;
    exists: boolean;
    rowCount: number | null;
  }>> {
    const tableNames = await this.getKnownPostgresTableNames();
    const metadataList = await this.metadata.listAll();
    const metadataByTable = new Map(metadataList.map((item) => [item.tableName, item] as const));
    if (this.env.runtimeMode !== 'postgres') {
      return tableNames.map((tableName) => {
        const metadata = metadataByTable.get(tableName);
        return {
          tableName,
          description: metadata?.description ?? null,
          moduleId: metadata?.moduleId ?? null,
          repositoryName: metadata?.repositoryName ?? null,
          storageProfile: metadata?.storageProfile ?? null,
          backupHot: metadata?.backupHot ?? false,
          exists: false,
          rowCount: null,
        };
      });
    }

    const pool = getSharedPgPool(this.env);
    const rows = await queryRows<{ tableName: string }>(
      pool,
       `SELECT table_name AS "tableName"
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [tableNames],
    );
    const existing = new Set(rows.map((row) => row.tableName));
    const results: Array<{
      tableName: string;
      description: string | null;
      moduleId: string | null;
      repositoryName: string | null;
      storageProfile: string | null;
      backupHot: boolean;
      exists: boolean;
      rowCount: number | null;
    }> = [];
    for (const tableName of tableNames) {
      const metadata = metadataByTable.get(tableName);
      if (!existing.has(tableName)) {
        results.push({
          tableName,
          description: metadata?.description ?? null,
          moduleId: metadata?.moduleId ?? null,
          repositoryName: metadata?.repositoryName ?? null,
          storageProfile: metadata?.storageProfile ?? null,
          backupHot: metadata?.backupHot ?? false,
          exists: false,
          rowCount: null,
        });
        continue;
      }

      const countResult = await pool.query(`SELECT COUNT(*)::int AS count FROM "${tableName}"`);
      results.push({
        tableName,
        description: metadata?.description ?? null,
        moduleId: metadata?.moduleId ?? null,
        repositoryName: metadata?.repositoryName ?? null,
        storageProfile: metadata?.storageProfile ?? null,
        backupHot: metadata?.backupHot ?? false,
        exists: true,
        rowCount: Number(countResult.rows[0]?.count ?? 0),
      });
    }

    return results;
  }

  private async listAvailableDatabases(): Promise<string[]> {
    if (this.env.runtimeMode !== 'postgres') {
      return [this.env.pgDatabase];
    }

    const pool = getSharedPgPool(this.env);
    const rows = await queryRows<{ datname: string }>(
      pool,
      `SELECT datname
       FROM pg_database
       WHERE datistemplate = false
       ORDER BY datname ASC`,
    );
    return rows.map((row) => row.datname);
  }

  private async getKnownPostgresTableNames() {
    const definitions = await loadResolvedPostgresTableDefinitions(this.env);
    return definitions.map((definition) => definition.tableName);
  }

  private async getKnownDynamoTableNames() {
    const definitions = await loadResolvedDynamoTableDefinitions(this.env);
    return definitions
      .map((definition) => definition.dynamoResolvedTableName)
      .filter((tableName): tableName is string => typeof tableName === 'string' && tableName.length > 0);
  }

  private async getTableNameByRepositoryName(repositoryName: string): Promise<string | null> {
    const definitions = await loadResolvedPostgresTableDefinitions(this.env);
    return definitions.find((definition) => definition.repositoryName === repositoryName)?.tableName ?? null;
  }

  private async assertKnownPostgresTable(tableName: string) {
    const knownTableNames = await this.getKnownPostgresTableNames();
    if (!isSafeMonitorIdentifier(tableName) || !knownTableNames.includes(tableName)) {
      throw new Error(`Table not available for monitor: ${tableName}`);
    }
  }

  private async assertKnownDynamoTable(tableName: string) {
    const knownTableNames = await this.getKnownDynamoTableNames();
    if (!isSafeMonitorIdentifier(tableName) || !knownTableNames.includes(tableName)) {
      throw new Error(`Dynamo table not available for monitor: ${tableName}`);
    }
  }

  private async getPoolForDatabase(databaseName?: string) {
    const availableDatabases = await this.listAvailableDatabases();
    const targetDatabase = databaseName ?? this.env.pgDatabase;
    if (!availableDatabases.includes(targetDatabase)) {
      throw new Error(`Database not available for monitor: ${targetDatabase}`);
    }

    const useSharedPool = targetDatabase === this.env.pgDatabase;
    return {
      availableDatabases,
      targetDatabase,
      useSharedPool,
      pool: useSharedPool ? getSharedPgPool(this.env) : createPgPool(this.env, targetDatabase),
    };
  }

  private async listPostgresColumns(
    pool: Pool,
    tableName: string,
  ): Promise<MonitorPostgresColumn[]> {
    return queryRows<MonitorPostgresColumn>(
      pool,
      `SELECT
        column_name AS "name",
        data_type AS "dataType",
        (is_nullable = 'YES') AS "isNullable",
        column_default AS "defaultValue"
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
       ORDER BY ordinal_position ASC`,
      [tableName],
    );
  }

  private async getPostgresPrimaryKey(
    pool: Pool,
    tableName: string,
  ): Promise<string[]> {
    const rows = await queryRows<{ columnName: string }>(
      pool,
      `SELECT kcu.column_name AS "columnName"
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = 'public'
         AND tc.table_name = $1
         AND tc.constraint_type = 'PRIMARY KEY'
       ORDER BY kcu.ordinal_position ASC`,
      [tableName],
    );
    return rows.map((row) => row.columnName);
  }

  private async listPostgresIndexes(
    pool: Pool,
    tableName: string,
  ): Promise<MonitorPostgresIndex[]> {
    const rows = await queryRows<MonitorPostgresIndex & { columns: unknown }>(
      pool,
      `SELECT
        idx.relname AS "name",
        i.indisunique AS "unique",
        am.amname AS "method",
        COALESCE(
          ARRAY_AGG(att.attname ORDER BY ord.ord) FILTER (WHERE att.attname IS NOT NULL),
          ARRAY[]::text[]
        ) AS "columns"
       FROM pg_class tbl
       JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
       JOIN pg_index i ON i.indrelid = tbl.oid
       JOIN pg_class idx ON idx.oid = i.indexrelid
       JOIN pg_am am ON am.oid = idx.relam
       LEFT JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS ord(attnum, ord) ON true
       LEFT JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = ord.attnum
       WHERE ns.nspname = 'public'
         AND tbl.relname = $1
       GROUP BY idx.relname, i.indisunique, am.amname
       ORDER BY idx.relname ASC`,
      [tableName],
    );

    return rows.map((row) => ({
      name: row.name,
      unique: row.unique,
      method: row.method,
      columns: normalizeStringList(row.columns),
    }));
  }

  private async getPostgresTableMetrics(
    pool: Pool,
    tableName: string,
  ): Promise<{ rowCount: number; totalSizeBytes: number }> {
    const rows = await queryRows<{ rowCount: number; totalSizeBytes: number }>(
      pool,
      `SELECT
        COALESCE(s.n_live_tup, 0)::bigint::int AS "rowCount",
        COALESCE(pg_total_relation_size(c.oid), 0)::bigint::int AS "totalSizeBytes"
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
         AND c.relname = $1`,
      [tableName],
    );

    return rows[0] ?? {
      rowCount: 0,
      totalSizeBytes: 0,
    };
  }

  public async listKnownPostgresTablesDetailed(databaseName?: string): Promise<Array<{
    tableName: string;
    description: string | null;
    moduleId: string | null;
    repositoryName: string | null;
    storageProfile: string | null;
    backupHot: boolean;
    exists: boolean;
    rowCount: number | null;
    totalSizeBytes: number | null;
  }>> {
    const tableNames = await this.getKnownPostgresTableNames();
    const metadataList = await this.metadata.listAll();
    const metadataByTable = new Map(metadataList.map((item) => [item.tableName, item] as const));
    if (this.env.runtimeMode !== 'postgres') {
      return tableNames.map((tableName) => ({
        tableName,
        description: metadataByTable.get(tableName)?.description ?? null,
        moduleId: metadataByTable.get(tableName)?.moduleId ?? null,
        repositoryName: metadataByTable.get(tableName)?.repositoryName ?? null,
        storageProfile: metadataByTable.get(tableName)?.storageProfile ?? null,
        backupHot: metadataByTable.get(tableName)?.backupHot ?? false,
        exists: false,
        rowCount: null,
        totalSizeBytes: null,
      }));
    }

    const { pool, useSharedPool } = await this.getPoolForDatabase(databaseName);
    try {
      const rows = await queryRows<{
        tableName: string;
        rowCount: number;
        totalSizeBytes: number;
      }>(
        pool,
        `SELECT
          c.relname AS "tableName",
          COALESCE(s.n_live_tup, 0)::bigint::int AS "rowCount",
          pg_total_relation_size(c.oid)::bigint::int AS "totalSizeBytes"
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND c.relname = ANY($1::text[])`,
        [tableNames],
      );

      const byTableName = new Map(rows.map((row) => [row.tableName, row]));

      return tableNames.map((tableName) => {
        const row = byTableName.get(tableName);
        const metadata = metadataByTable.get(tableName);
        return {
          tableName,
          description: metadata?.description ?? null,
          moduleId: metadata?.moduleId ?? null,
          repositoryName: metadata?.repositoryName ?? null,
          storageProfile: metadata?.storageProfile ?? null,
          backupHot: metadata?.backupHot ?? false,
          exists: Boolean(row),
          rowCount: row?.rowCount ?? null,
          totalSizeBytes: row?.totalSizeBytes ?? null,
        };
      });
    } finally {
      if (!useSharedPool) {
        await pool.end();
      }
    }
  }

  public async getPostgresTableDetails(input: {
    databaseName?: string;
    tableName: string;
  }): Promise<{
    databaseName: string;
    tableName: string;
    description: string | null;
    moduleId: string | null;
    repositoryName: string | null;
    storageProfile: string | null;
    backupHot: boolean;
    exists: boolean;
    metrics: {
      rowCount: number;
      totalSizeBytes: number;
    };
    columns: MonitorPostgresColumn[];
    primaryKey: string[];
    indexes: MonitorPostgresIndex[];
  }> {
    await this.assertKnownPostgresTable(input.tableName);
    const metadata = await this.metadata.findByPostgresTableName(input.tableName);

    if (this.env.runtimeMode !== 'postgres') {
      return {
        databaseName: input.databaseName ?? this.env.pgDatabase,
        tableName: input.tableName,
        description: metadata?.description ?? null,
        moduleId: metadata?.moduleId ?? null,
        repositoryName: metadata?.repositoryName ?? null,
        storageProfile: metadata?.storageProfile ?? null,
        backupHot: metadata?.backupHot ?? false,
        exists: false,
        metrics: {
          rowCount: 0,
          totalSizeBytes: 0,
        },
        columns: [],
        primaryKey: [],
        indexes: [],
      };
    }

    const { pool, targetDatabase, useSharedPool } = await this.getPoolForDatabase(input.databaseName);
    try {
      const [columns, primaryKey, indexes, metrics] = await Promise.all([
        this.listPostgresColumns(pool, input.tableName),
        this.getPostgresPrimaryKey(pool, input.tableName),
        this.listPostgresIndexes(pool, input.tableName),
        this.getPostgresTableMetrics(pool, input.tableName),
      ]);

      return {
        databaseName: targetDatabase,
        tableName: input.tableName,
        description: metadata?.description ?? null,
        moduleId: metadata?.moduleId ?? null,
        repositoryName: metadata?.repositoryName ?? null,
        storageProfile: metadata?.storageProfile ?? null,
        backupHot: metadata?.backupHot ?? false,
        exists: columns.length > 0,
        metrics,
        columns,
        primaryKey,
        indexes,
      };
    } finally {
      if (!useSharedPool) {
        await pool.end();
      }
    }
  }

  public async inspectPostgresTable(input: {
    databaseName?: string;
    tableName: string;
    page?: number;
    filters?: unknown;
  }): Promise<{
    databaseName: string;
    tableName: string;
    description: string | null;
    moduleId: string | null;
    repositoryName: string | null;
    storageProfile: string | null;
    backupHot: boolean;
    exists: boolean;
    columns: Array<Pick<MonitorPostgresColumn, 'name' | 'dataType' | 'isNullable'>>;
    pagination: {
      page: number;
      pageSize: number;
      totalRows: number;
      totalPages: number;
    };
    filters: Record<string, string>;
    rows: Array<Record<string, unknown>>;
    order: {
      primary: string[];
      fallback: string;
    };
  }> {
    await this.assertKnownPostgresTable(input.tableName);
    const metadata = await this.metadata.findByPostgresTableName(input.tableName);

    const page = Math.max(1, Math.trunc(input.page ?? 1));
    const filters = normalizeInspectFilters(input.filters);
    if (this.env.runtimeMode !== 'postgres') {
      return {
        databaseName: input.databaseName ?? this.env.pgDatabase,
        tableName: input.tableName,
        description: metadata?.description ?? null,
        moduleId: metadata?.moduleId ?? null,
        repositoryName: metadata?.repositoryName ?? null,
        storageProfile: metadata?.storageProfile ?? null,
        backupHot: metadata?.backupHot ?? false,
        exists: false,
        columns: [],
        pagination: {
          page,
          pageSize: POSTGRES_INSPECT_PAGE_SIZE,
          totalRows: 0,
          totalPages: 0,
        },
        filters: {},
        rows: [],
        order: {
          primary: [],
          fallback: '',
        },
      };
    }

    const { pool, targetDatabase, useSharedPool } = await this.getPoolForDatabase(input.databaseName);
    try {
      const [columns, primaryKey] = await Promise.all([
        this.listPostgresColumns(pool, input.tableName),
        this.getPostgresPrimaryKey(pool, input.tableName),
      ]);

      if (columns.length === 0) {
        return {
          databaseName: targetDatabase,
          tableName: input.tableName,
          description: metadata?.description ?? null,
          moduleId: metadata?.moduleId ?? null,
          repositoryName: metadata?.repositoryName ?? null,
          storageProfile: metadata?.storageProfile ?? null,
          backupHot: metadata?.backupHot ?? false,
          exists: false,
          columns: [],
          pagination: {
            page,
            pageSize: POSTGRES_INSPECT_PAGE_SIZE,
            totalRows: 0,
            totalPages: 0,
          },
          filters: {},
          rows: [],
          order: {
            primary: [],
            fallback: '',
          },
        };
      }

      const allowedColumns = new Set(columns.map((column) => column.name));
      const normalizedFilters = Object.fromEntries(
        Object.entries(filters).filter(([key]) => allowedColumns.has(key)),
      );
      const whereClauses: string[] = [];
      const filterParams: unknown[] = [];
      for (const [columnName, filterValue] of Object.entries(normalizedFilters)) {
        filterParams.push(`%${filterValue}%`);
        whereClauses.push(`${quoteIdent(columnName)}::text ILIKE $${filterParams.length}`);
      }
      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const orderColumns = primaryKey.length > 0 ? primaryKey : [columns[0]?.name ?? ''];
      const fallback = primaryKey.length > 0 ? 'ctid' : (columns[0]?.name ?? 'ctid');
      const orderFragments = orderColumns
        .filter((columnName) => columnName.length > 0)
        .map((columnName) => `${quoteIdent(columnName)} ASC`);
      if (fallback === 'ctid') {
        orderFragments.push('ctid ASC');
      } else {
        orderFragments.push(`${quoteIdent(fallback)} ASC`, 'ctid ASC');
      }

      const countRows = await queryRows<{ totalRows: number }>(
        pool,
        `SELECT COUNT(*)::int AS "totalRows"
         FROM ${quoteIdent(input.tableName)}
         ${whereSql}`,
        filterParams,
      );
      const totalRows = countRows[0]?.totalRows ?? 0;
      const totalPages = totalRows > 0 ? Math.ceil(totalRows / POSTGRES_INSPECT_PAGE_SIZE) : 0;
      const boundedPage = totalPages > 0 ? Math.min(page, totalPages) : 1;
      const offset = (boundedPage - 1) * POSTGRES_INSPECT_PAGE_SIZE;

      const rowResult = await pool.query(
        `SELECT *
         FROM ${quoteIdent(input.tableName)}
         ${whereSql}
         ORDER BY ${orderFragments.join(', ')}
         LIMIT $${filterParams.length + 1}
         OFFSET $${filterParams.length + 2}`,
        [...filterParams, POSTGRES_INSPECT_PAGE_SIZE, offset],
      );

      return {
        databaseName: targetDatabase,
        tableName: input.tableName,
        description: metadata?.description ?? null,
        moduleId: metadata?.moduleId ?? null,
        repositoryName: metadata?.repositoryName ?? null,
        storageProfile: metadata?.storageProfile ?? null,
        backupHot: metadata?.backupHot ?? false,
        exists: true,
        columns: columns.map((column) => ({
          name: column.name,
          dataType: column.dataType,
          isNullable: column.isNullable,
        })),
        pagination: {
          page: boundedPage,
          pageSize: POSTGRES_INSPECT_PAGE_SIZE,
          totalRows,
          totalPages,
        },
        filters: normalizedFilters,
        rows: rowResult.rows.map((row) => serializeMonitorValue(row) as Record<string, unknown>),
        order: {
          primary: primaryKey,
          fallback,
        },
      };
    } finally {
      if (!useSharedPool) {
        await pool.end();
      }
    }
  }

  public async listKnownDynamoTables(): Promise<Array<{
    tableName: string;
    description: string | null;
    moduleId: string | null;
    repositoryName: string | null;
    storageProfile: string | null;
    backupHot: boolean;
    exists: boolean;
    itemCount: number | null;
    tableStatus: string | null;
    tableSizeBytes: number | null;
    metricsAreApproximate: boolean;
  }>> {
    const tableNames = await this.getKnownDynamoTableNames();
    const metadataList = await this.metadata.listAll();
    const metadataByTable = new Map(
      metadataList
        .filter((item) => item.dynamoTableName)
        .map((item) => [item.dynamoTableName as string, item] as const),
    );
    if (this.env.runtimeMode !== 'postgres') {
      return tableNames.map((tableName) => ({
        tableName,
        description: metadataByTable.get(tableName)?.description ?? null,
        moduleId: metadataByTable.get(tableName)?.moduleId ?? null,
        repositoryName: metadataByTable.get(tableName)?.repositoryName ?? null,
        storageProfile: metadataByTable.get(tableName)?.storageProfile ?? null,
        backupHot: metadataByTable.get(tableName)?.backupHot ?? false,
        exists: false,
        itemCount: null,
        tableStatus: null,
        tableSizeBytes: null,
        metricsAreApproximate: true,
      }));
    }

    const client = createDynamoClient(this.env);
    const results = [];
    for (const tableName of tableNames) {
      const metadata = metadataByTable.get(tableName);
      try {
        const result = await client.send(new DescribeTableCommand({ TableName: tableName }));
        results.push({
          tableName,
          description: metadata?.description ?? null,
          moduleId: metadata?.moduleId ?? null,
          repositoryName: metadata?.repositoryName ?? null,
          storageProfile: metadata?.storageProfile ?? null,
          backupHot: metadata?.backupHot ?? false,
          exists: true,
          itemCount: result.Table?.ItemCount ?? null,
          tableStatus: result.Table?.TableStatus ?? null,
          tableSizeBytes: result.Table?.TableSizeBytes ?? null,
          metricsAreApproximate: true,
        });
      } catch {
        results.push({
          tableName,
          description: metadata?.description ?? null,
          moduleId: metadata?.moduleId ?? null,
          repositoryName: metadata?.repositoryName ?? null,
          storageProfile: metadata?.storageProfile ?? null,
          backupHot: metadata?.backupHot ?? false,
          exists: false,
          itemCount: null,
          tableStatus: null,
          tableSizeBytes: null,
          metricsAreApproximate: true,
        });
      }
    }

    return results;
  }

  public async getPostgresSnapshot(input?: { databaseName?: string }): Promise<{
    runtimeMode: AppEnv['runtimeMode'];
    connection: {
      host: string;
      port: number;
      currentDatabase: string;
      availableDatabases: string[];
    };
    database: {
      name: string;
      activeConnections: number;
      activeConnectionsByState: Record<string, number>;
      maxConnections: number;
      waitingLocks: number;
      cacheHitRate: number | null;
      commitCount: number;
      rollbackCount: number;
      deadlockCount: number;
    };
    queue: {
      pendingOutbox: number;
      processedOutbox: number;
      replicationFailures: number;
      cacheEntries: number;
    };
    tables: Array<{
      tableName: string;
      exists: boolean;
      rowCount: number | null;
      totalSizeBytes: number | null;
    }>;
  }> {
    if (this.env.runtimeMode !== 'postgres') {
      return {
        runtimeMode: this.env.runtimeMode,
        connection: {
          host: this.env.pgHost,
          port: this.env.pgPort,
          currentDatabase: this.env.pgDatabase,
          availableDatabases: [this.env.pgDatabase],
        },
        database: {
          name: this.env.pgDatabase,
          activeConnections: 0,
          activeConnectionsByState: {},
          maxConnections: 0,
          waitingLocks: 0,
          cacheHitRate: null,
          commitCount: 0,
          rollbackCount: 0,
          deadlockCount: 0,
        },
        queue: {
          pendingOutbox: 0,
          processedOutbox: 0,
          replicationFailures: 0,
          cacheEntries: 0,
        },
        tables: await this.listKnownPostgresTablesDetailed(input?.databaseName),
      };
    }

    const availableDatabases = await this.listAvailableDatabases();
    const targetDatabase = input?.databaseName ?? this.env.pgDatabase;
    if (!availableDatabases.includes(targetDatabase)) {
      throw new Error(`Database not available for monitor: ${targetDatabase}`);
    }

    const useSharedPool = targetDatabase === this.env.pgDatabase;
    const pool = useSharedPool ? getSharedPgPool(this.env) : createPgPool(this.env, targetDatabase);
    try {
      const [documentTableName, outboxTableName, replicationFailuresTableName] = await Promise.all([
        this.getTableNameByRepositoryName('mdmDocumentCache'),
        this.getTableNameByRepositoryName('mdmOutbox'),
        this.getTableNameByRepositoryName('mdmReplicationFailures'),
      ]);
      const [databaseRows, waitingLocksRows, queueRows, tables, connectionsByStateRows, maxConnectionsRows] = await Promise.all([
      queryRows<{
        databaseName: string;
        activeConnections: number;
        commitCount: number;
        rollbackCount: number;
        deadlockCount: number;
        blocksRead: number;
        blocksHit: number;
      }>(
        pool,
        `SELECT
          current_database() AS "databaseName",
          COALESCE(numbackends, 0)::int AS "activeConnections",
          COALESCE(xact_commit, 0)::bigint::int AS "commitCount",
          COALESCE(xact_rollback, 0)::bigint::int AS "rollbackCount",
          COALESCE(deadlocks, 0)::bigint::int AS "deadlockCount",
          COALESCE(blks_read, 0)::bigint::int AS "blocksRead",
          COALESCE(blks_hit, 0)::bigint::int AS "blocksHit"
         FROM pg_stat_database
         WHERE datname = current_database()`,
      ),
      queryRows<{ waitingLocks: number }>(
        pool,
        `SELECT COUNT(*)::int AS "waitingLocks"
         FROM pg_locks
         WHERE NOT granted`,
      ),
      queryRows<{
        pendingOutbox: number;
        processedOutbox: number;
        replicationFailures: number;
        cacheEntries: number;
      }>(
        pool,
        `SELECT
          COALESCE((SELECT COUNT(*)::int FROM ${quoteIdent(outboxTableName ?? 'mdm_outbox')} WHERE "processedAt" IS NULL), 0) AS "pendingOutbox",
          COALESCE((SELECT COUNT(*)::int FROM ${quoteIdent(outboxTableName ?? 'mdm_outbox')} WHERE "processedAt" IS NOT NULL), 0) AS "processedOutbox",
         COALESCE((SELECT COUNT(*)::int FROM ${quoteIdent(replicationFailuresTableName ?? 'mdm_replication_failures')}), 0) AS "replicationFailures",
         COALESCE((SELECT COUNT(*)::int FROM ${quoteIdent(documentTableName ?? 'mdm_documents')}), 0) AS "cacheEntries"`,
      ),
      this.listKnownPostgresTablesDetailed(targetDatabase),
      queryRows<{ state: string | null; count: number }>(
        pool,
        `SELECT COALESCE(state, 'unknown') AS "state", COUNT(*)::int AS "count"
         FROM pg_stat_activity
         WHERE datname = current_database()
         GROUP BY state`,
      ),
      queryRows<{ maxConnections: number }>(
        pool,
        `SELECT setting::int AS "maxConnections" FROM pg_settings WHERE name = 'max_connections'`,
      ),
    ]);

      const database = databaseRows[0];
      const queue = queueRows[0];
      const blockReads = (database?.blocksRead ?? 0) + (database?.blocksHit ?? 0);
      const activeConnectionsByState: Record<string, number> = {};
      for (const row of connectionsByStateRows) {
        activeConnectionsByState[row.state ?? 'unknown'] = row.count;
      }

      return {
        runtimeMode: this.env.runtimeMode,
        connection: {
          host: this.env.pgHost,
          port: this.env.pgPort,
          currentDatabase: database?.databaseName ?? targetDatabase,
          availableDatabases,
        },
        database: {
          name: database?.databaseName ?? targetDatabase,
          activeConnections: database?.activeConnections ?? 0,
          activeConnectionsByState,
          maxConnections: maxConnectionsRows[0]?.maxConnections ?? 0,
          waitingLocks: waitingLocksRows[0]?.waitingLocks ?? 0,
          cacheHitRate: blockReads > 0 ? Number((((database?.blocksHit ?? 0) / blockReads) * 100).toFixed(2)) : null,
          commitCount: database?.commitCount ?? 0,
          rollbackCount: database?.rollbackCount ?? 0,
          deadlockCount: database?.deadlockCount ?? 0,
        },
        queue: {
          pendingOutbox: queue?.pendingOutbox ?? 0,
          processedOutbox: queue?.processedOutbox ?? 0,
          replicationFailures: queue?.replicationFailures ?? 0,
          cacheEntries: queue?.cacheEntries ?? 0,
        },
        tables,
      };
    } finally {
      if (!useSharedPool) {
        await pool.end();
      }
    }
  }

  public async getDynamoSnapshot(): Promise<{
    runtimeMode: AppEnv['runtimeMode'];
    region: string;
    tables: Array<{
      tableName: string;
      description: string | null;
      moduleId: string | null;
      repositoryName: string | null;
      storageProfile: string | null;
      backupHot: boolean;
      exists: boolean;
      itemCount: number | null;
      tableStatus: string | null;
      tableSizeBytes: number | null;
      metricsAreApproximate: boolean;
    }>;
    summary: {
      totalTables: number;
      availableTables: number;
      missingTables: number;
      totalItemCount: number;
      metricsAreApproximate: boolean;
    };
  }> {
    const tables = await this.listKnownDynamoTables();

    return {
      runtimeMode: this.env.runtimeMode,
      region: this.env.awsRegion,
      tables,
      summary: {
        totalTables: tables.length,
        availableTables: tables.filter((table) => table.exists).length,
        missingTables: tables.filter((table) => !table.exists).length,
        totalItemCount: tables.reduce((acc, table) => acc + (table.itemCount ?? 0), 0),
        metricsAreApproximate: true,
      },
    };
  }

  public async getDynamoTableDetails(input: {
    tableName: string;
  }): Promise<{
    tableName: string;
    description: string | null;
    moduleId: string | null;
    repositoryName: string | null;
    storageProfile: string | null;
    backupHot: boolean;
    exists: boolean;
    summary: {
      tableStatus: string | null;
      itemCount: number;
      tableSizeBytes: number;
      billingMode: string | null;
      tableClass: string | null;
      metricsAreApproximate: boolean;
    };
    keys: {
      partitionKey: string | null;
      sortKey: string | null;
    };
    attributeDefinitions: Array<{
      name: string;
      type: string;
    }>;
    globalSecondaryIndexes: Array<{
      name: string;
      projectionType: string | null;
      keys: string[];
    }>;
    localSecondaryIndexes: Array<{
      name: string;
      projectionType: string | null;
      keys: string[];
    }>;
  }> {
    await this.assertKnownDynamoTable(input.tableName);
    const metadata = await this.metadata.findByDynamoTableName(input.tableName);

    if (this.env.runtimeMode !== 'postgres') {
      return {
        tableName: input.tableName,
        description: metadata?.description ?? null,
        moduleId: metadata?.moduleId ?? null,
        repositoryName: metadata?.repositoryName ?? null,
        storageProfile: metadata?.storageProfile ?? null,
        backupHot: metadata?.backupHot ?? false,
        exists: false,
        summary: {
          tableStatus: null,
          itemCount: 0,
          tableSizeBytes: 0,
          billingMode: null,
          tableClass: null,
          metricsAreApproximate: true,
        },
        keys: {
          partitionKey: null,
          sortKey: null,
        },
        attributeDefinitions: [],
        globalSecondaryIndexes: [],
        localSecondaryIndexes: [],
      };
    }

    const client = createDynamoClient(this.env);
    try {
      const result = await client.send(new DescribeTableCommand({ TableName: input.tableName }));
      const table = result.Table;
      const partitionKey = table?.KeySchema?.find((entry) => entry.KeyType === 'HASH')?.AttributeName ?? null;
      const sortKey = table?.KeySchema?.find((entry) => entry.KeyType === 'RANGE')?.AttributeName ?? null;

      return {
        tableName: input.tableName,
        description: metadata?.description ?? null,
        moduleId: metadata?.moduleId ?? null,
        repositoryName: metadata?.repositoryName ?? null,
        storageProfile: metadata?.storageProfile ?? null,
        backupHot: metadata?.backupHot ?? false,
        exists: Boolean(table),
        summary: {
          tableStatus: table?.TableStatus ?? null,
          itemCount: table?.ItemCount ?? 0,
          tableSizeBytes: table?.TableSizeBytes ?? 0,
          billingMode: table?.BillingModeSummary?.BillingMode ?? null,
          tableClass: table?.TableClassSummary?.TableClass ?? null,
          metricsAreApproximate: true,
        },
        keys: {
          partitionKey,
          sortKey,
        },
        attributeDefinitions: (table?.AttributeDefinitions ?? []).map((definition) => ({
          name: definition.AttributeName ?? '',
          type: definition.AttributeType ?? 'UNKNOWN',
        })),
        globalSecondaryIndexes: (table?.GlobalSecondaryIndexes ?? []).map((index) => ({
          name: index.IndexName ?? '',
          projectionType: index.Projection?.ProjectionType ?? null,
          keys: (index.KeySchema ?? []).map((key) => key.AttributeName ?? '').filter((key) => key.length > 0),
        })),
        localSecondaryIndexes: (table?.LocalSecondaryIndexes ?? []).map((index) => ({
          name: index.IndexName ?? '',
          projectionType: index.Projection?.ProjectionType ?? null,
          keys: (index.KeySchema ?? []).map((key) => key.AttributeName ?? '').filter((key) => key.length > 0),
        })),
      };
    } catch {
      return {
        tableName: input.tableName,
        description: metadata?.description ?? null,
        moduleId: metadata?.moduleId ?? null,
        repositoryName: metadata?.repositoryName ?? null,
        storageProfile: metadata?.storageProfile ?? null,
        backupHot: metadata?.backupHot ?? false,
        exists: false,
        summary: {
          tableStatus: null,
          itemCount: 0,
          tableSizeBytes: 0,
          billingMode: null,
          tableClass: null,
          metricsAreApproximate: true,
        },
        keys: {
          partitionKey: null,
          sortKey: null,
        },
        attributeDefinitions: [],
        globalSecondaryIndexes: [],
        localSecondaryIndexes: [],
      };
    }
  }

  public async inspectDynamoTable(input: {
    tableName: string;
    cursor?: string;
    filters?: unknown;
  }): Promise<{
    tableName: string;
    description: string | null;
    moduleId: string | null;
    repositoryName: string | null;
    storageProfile: string | null;
    backupHot: boolean;
    exists: boolean;
    columns: Array<{
      name: string;
      type: string;
      filterable: boolean;
    }>;
    pagination: {
      pageSize: number;
      cursor: string | null;
      nextCursor: string | null;
      hasNextPage: boolean;
    };
    filters: Record<string, string>;
    rows: Array<Record<string, unknown>>;
    metricsAreApproximate: boolean;
  }> {
    await this.assertKnownDynamoTable(input.tableName);
    const metadata = await this.metadata.findByDynamoTableName(input.tableName);
    const filters = normalizeInspectFilters(input.filters);

    if (this.env.runtimeMode !== 'postgres') {
      return {
        tableName: input.tableName,
        description: metadata?.description ?? null,
        moduleId: metadata?.moduleId ?? null,
        repositoryName: metadata?.repositoryName ?? null,
        storageProfile: metadata?.storageProfile ?? null,
        backupHot: metadata?.backupHot ?? false,
        exists: false,
        columns: [],
        pagination: {
          pageSize: DYNAMO_INSPECT_PAGE_SIZE,
          cursor: input.cursor ?? null,
          nextCursor: null,
          hasNextPage: false,
        },
        filters: {},
        rows: [],
        metricsAreApproximate: true,
      };
    }

    const details = await this.getDynamoTableDetails({ tableName: input.tableName });
    if (!details.exists) {
      return {
        tableName: input.tableName,
        description: metadata?.description ?? null,
        moduleId: metadata?.moduleId ?? null,
        repositoryName: metadata?.repositoryName ?? null,
        storageProfile: metadata?.storageProfile ?? null,
        backupHot: metadata?.backupHot ?? false,
        exists: false,
        columns: [],
        pagination: {
          pageSize: DYNAMO_INSPECT_PAGE_SIZE,
          cursor: input.cursor ?? null,
          nextCursor: null,
          hasNextPage: false,
        },
        filters: {},
        rows: [],
        metricsAreApproximate: true,
      };
    }

    const client = createDynamoClient(this.env);
    const filterEntries = Object.entries(filters).filter(([key]) => isSafeMonitorIdentifier(key));
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, AttributeValue> = {};
    const filterFragments: string[] = [];

    filterEntries.forEach(([key, rawValue], index) => {
      const nameToken = `#f${index}`;
      expressionAttributeNames[nameToken] = key;
      const trimmed = rawValue.trim();
      if (trimmed === 'true' || trimmed === 'false') {
        const valueToken = `:v${index}`;
        expressionAttributeValues[valueToken] = { BOOL: trimmed === 'true' };
        filterFragments.push(`${nameToken} = ${valueToken}`);
        return;
      }

      const numeric = Number(trimmed);
      if (Number.isFinite(numeric) && trimmed !== '') {
        const valueToken = `:v${index}`;
        expressionAttributeValues[valueToken] = { N: String(numeric) };
        filterFragments.push(`${nameToken} = ${valueToken}`);
        return;
      }

      const valueToken = `:v${index}`;
      const typeToken = `:t${index}`;
      expressionAttributeValues[valueToken] = { S: trimmed };
      expressionAttributeValues[typeToken] = { S: 'S' };
      filterFragments.push(`attribute_type(${nameToken}, ${typeToken}) AND contains(${nameToken}, ${valueToken})`);
    });

    const result = await client.send(new ScanCommand({
      TableName: input.tableName,
      Limit: DYNAMO_INSPECT_PAGE_SIZE,
      ExclusiveStartKey: decodeDynamoKey(input.cursor),
      FilterExpression: filterFragments.length > 0 ? filterFragments.join(' AND ') : undefined,
      ExpressionAttributeNames: filterFragments.length > 0 ? expressionAttributeNames : undefined,
      ExpressionAttributeValues: filterFragments.length > 0 ? expressionAttributeValues : undefined,
    }));

    const rows = (result.Items ?? []).map((item) => (
      Object.fromEntries(Object.entries(item).map(([key, value]) => [key, attributeValueToJs(value)]))
    ));
    const columnMetadata = new Map<string, { type: string; filterable: boolean }>();

    for (const definition of details.attributeDefinitions) {
      columnMetadata.set(definition.name, {
        type: definition.type,
        filterable: true,
      });
    }

    for (const row of rows) {
      Object.entries(row).forEach(([key, value]) => {
        const nextType = inferDynamoColumnType(value);
        const current = columnMetadata.get(key);
        columnMetadata.set(key, {
          type: current?.type && current.type !== 'null' ? current.type : nextType,
          filterable: current?.filterable === false ? false : isScalarDynamoValue(value),
        });
      });
    }

    return {
      tableName: input.tableName,
      description: metadata?.description ?? null,
      moduleId: metadata?.moduleId ?? null,
      repositoryName: metadata?.repositoryName ?? null,
      storageProfile: metadata?.storageProfile ?? null,
      backupHot: metadata?.backupHot ?? false,
      exists: true,
      columns: [...columnMetadata.entries()]
        .map(([name, info]) => ({
          name,
          type: info.type,
          filterable: info.filterable,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      pagination: {
        pageSize: DYNAMO_INSPECT_PAGE_SIZE,
        cursor: input.cursor ?? null,
        nextCursor: normalizeDynamoKey(result.LastEvaluatedKey),
        hasNextPage: Boolean(result.LastEvaluatedKey),
      },
      filters: Object.fromEntries(filterEntries),
      rows,
      metricsAreApproximate: true,
    };
  }

  public async getSnapshotData(): Promise<{
    byRoutine: Array<{ routine: string; totalCount: number; lastFinishedAt: string; avgDurationMs: number }>;
    byStatusGroup: Array<{ statusGroup: string; totalCount: number }>;
    overview: { totalExecutions: number; successCount: number; clientErrorCount: number; serverErrorCount: number; notFoundCount: number };
    recentFailures: Array<Pick<MonitorBffExecutionLogRecord, 'routine' | 'statusCode' | 'statusGroup' | 'errorCode' | 'finishedAt'>>;
  }> {
    if (this.env.runtimeMode !== 'postgres') {
      return {
        byRoutine: [],
        byStatusGroup: [],
        overview: { totalExecutions: 0, successCount: 0, clientErrorCount: 0, serverErrorCount: 0, notFoundCount: 0 },
        recentFailures: [],
      };
    }

    const pool = getSharedPgPool(this.env);
    const [overviewRows, byRoutineRows, byStatusGroupRows, recentFailuresRows] = await Promise.all([
      queryRows<{
        totalExecutions: number;
        successCount: number;
        clientErrorCount: number;
        serverErrorCount: number;
        notFoundCount: number;
      }>(
        pool,
        `SELECT
          COUNT(*)::int AS "totalExecutions",
          COUNT(*) FILTER (WHERE "statusGroup" = 'success')::int AS "successCount",
          COUNT(*) FILTER (WHERE "statusGroup" = 'client_error')::int AS "clientErrorCount",
          COUNT(*) FILTER (WHERE "statusGroup" = 'server_error')::int AS "serverErrorCount",
          COUNT(*) FILTER (WHERE "statusGroup" = 'not_found')::int AS "notFoundCount"
         FROM monitor_bff_execution_log`,
      ),
      queryRows<{ routine: string; totalCount: number; lastFinishedAt: string; avgDurationMs: number }>(
        pool,
        `SELECT
          "routine",
          COUNT(*)::int AS "totalCount",
          MAX("finishedAt")::text AS "lastFinishedAt",
          ROUND(AVG("durationMs"))::int AS "avgDurationMs"
         FROM monitor_bff_execution_log
         GROUP BY "routine"
         ORDER BY "totalCount" DESC, "routine" ASC
         LIMIT 20`,
      ),
      queryRows<{ statusGroup: string; totalCount: number }>(
        pool,
        `SELECT "statusGroup", COUNT(*)::int AS "totalCount"
         FROM monitor_bff_execution_log
         GROUP BY "statusGroup"
         ORDER BY "totalCount" DESC, "statusGroup" ASC`,
      ),
      queryRows<Pick<MonitorBffExecutionLogRecord, 'routine' | 'statusCode' | 'statusGroup' | 'errorCode' | 'finishedAt'>>(
        pool,
        `SELECT "routine", "statusCode", "statusGroup", "errorCode", "finishedAt"
         FROM monitor_bff_execution_log
         WHERE "statusCode" >= 400
         ORDER BY "finishedAt" DESC
         LIMIT 20`,
      ),
    ]);

    return {
      byRoutine: byRoutineRows,
      byStatusGroup: byStatusGroupRows,
      overview: overviewRows[0] ?? {
        totalExecutions: 0,
        successCount: 0,
        clientErrorCount: 0,
        serverErrorCount: 0,
        notFoundCount: 0,
      },
      recentFailures: recentFailuresRows,
    };
  }

  public async recordTelemetry(events: Array<{
    id: string;
    requestId: string;
    traceId: string;
    userId: string;
    module: string;
    routine: string;
    eventType: string;
    label: string;
    durationMs: number | null;
    metadata: Record<string, unknown> | null;
    recordedAt: string;
    receivedAt: string;
  }>): Promise<void> {
    if (this.env.runtimeMode !== 'postgres' || events.length === 0) {
      return;
    }
    const pool = getSharedPgPool(this.env);
    for (const ev of events) {
      await pool.query(
        `INSERT INTO monitor_client_telemetry_event
         ("id","requestId","traceId","userId","module","routine","eventType","label","durationMs","metadata","recordedAt","receivedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT DO NOTHING`,
        [
          ev.id, ev.requestId, ev.traceId, ev.userId, ev.module, ev.routine,
          ev.eventType, ev.label, ev.durationMs,
          ev.metadata !== null ? JSON.stringify(ev.metadata) : null,
          ev.recordedAt, ev.receivedAt,
        ],
      );
    }
  }

  public async loadRequestTrace(input: {
    requestId?: string;
    traceId?: string;
  }): Promise<Array<{
    id: string;
    requestId: string;
    traceId: string;
    userId: string;
    routine: string;
    module: string;
    statusCode: number;
    statusGroup: string;
    ok: boolean;
    durationMs: number;
    errorCode: string | null;
    errorStack: string | null;
    startedAt: string;
    finishedAt: string;
  }>> {
    if (this.env.runtimeMode !== 'postgres') {
      return [];
    }

    const pool = getSharedPgPool(this.env);
    const { requestId, traceId } = input;

    if (!requestId && !traceId) {
      return [];
    }

    const rows = await queryRows<{
      id: string;
      requestId: string;
      traceId: string;
      userId: string;
      routine: string;
      module: string;
      statusCode: number;
      statusGroup: string;
      ok: boolean;
      durationMs: number;
      errorCode: string | null;
      errorStack: string | null;
      startedAt: Date;
      finishedAt: Date;
    }>(
      pool,
      `SELECT
         "id", "requestId", "traceId", "userId", "routine", "module",
         "statusCode", "statusGroup", "ok", "durationMs",
         "errorCode", "errorStack", "startedAt", "finishedAt"
       FROM monitor_bff_execution_log
       WHERE ($1::text IS NOT NULL AND "requestId" = $1)
          OR ($2::text IS NOT NULL AND "traceId" = $2)
       ORDER BY "startedAt" ASC
       LIMIT 200`,
      [requestId ?? null, traceId ?? null],
    );

    return rows.map((row) => ({
      ...row,
      startedAt: row.startedAt instanceof Date ? row.startedAt.toISOString() : String(row.startedAt),
      finishedAt: row.finishedAt instanceof Date ? row.finishedAt.toISOString() : String(row.finishedAt),
    }));
  }
}
