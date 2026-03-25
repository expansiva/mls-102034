/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/statisticsUsecases.ts" enhancement="_blank" />
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { getSharedBffExecutionSeriesStore } from '/_102034_/l1/monitor/layer_1_external/cache/BffExecutionSeriesStore.js';
import { MonitorPersistenceMetadata } from '/_102034_/l1/monitor/layer_1_external/data/persistence/MonitorPersistenceMetadata.js';
import { MonitorRuntimePostgres } from '/_102034_/l1/monitor/layer_1_external/data/postgres/MonitorRuntimePostgres.js';
import type { MonitorSeriesPoint } from '/_102034_/l1/monitor/module.js';

function countIndexRows(
  tables: Array<{ tableName: string; repositoryName?: string | null; exists: boolean; rowCount: number | null }>,
) {
  const findCount = (repositoryName: string) =>
    tables.find((table) => table.repositoryName === repositoryName)?.rowCount ?? 0;

  return {
    mdmEntityIndex: findCount('mdmEntityIndex'),
    mdmProspectIndex: findCount('mdmProspectIndex'),
    mdmRelationship: findCount('mdmRelationship'),
    mdmProspectRelationship: findCount('mdmProspectRelationship'),
    monitorBffExecutionLog: findCount('monitorBffExecutionLog'),
    monitorBffExecutionAggMinute: findCount('monitorBffExecutionAggMinute'),
  };
}

function summarizeSeries(series: MonitorSeriesPoint[]) {
  return series.reduce(
    (acc, point) => ({
      total: acc.total + point.total,
      success: acc.success + point.success,
      clientError: acc.clientError + point.clientError,
      serverError: acc.serverError + point.serverError,
      notFound: acc.notFound + point.notFound,
    }),
    {
      total: 0,
      success: 0,
      clientError: 0,
      serverError: 0,
      notFound: 0,
    },
  );
}

function buildOverviewFromSeries(series: MonitorSeriesPoint[]) {
  const totals = summarizeSeries(series);
  return {
    overview: {
      totalExecutions: totals.total,
      successCount: totals.success,
      clientErrorCount: totals.clientError,
      serverErrorCount: totals.serverError,
      notFoundCount: totals.notFound,
    },
    byStatusGroup: [
      { statusGroup: 'success', totalCount: totals.success },
      { statusGroup: 'client_error', totalCount: totals.clientError },
      { statusGroup: 'server_error', totalCount: totals.serverError },
      { statusGroup: 'not_found', totalCount: totals.notFound },
    ],
  };
}

export async function getStatisticsSnapshot() {
  const env = readAppEnv();
  const runtime = new MonitorRuntimePostgres(env);
  const liveSeries = getSharedBffExecutionSeriesStore().getSeries({ windowSeconds: 100 });
  const [postgresTables, dynamodbTables, bff] = await Promise.all([
    runtime.listKnownPostgresTables(),
    runtime.listKnownDynamoTables(),
    runtime.getSnapshotData(),
  ]);
  const memoryOverview = buildOverviewFromSeries(liveSeries);

  return {
    generatedAt: new Date().toISOString(),
    storage: {
      postgres: {
        runtimeMode: env.runtimeMode,
        tables: postgresTables,
      },
      dynamodb: {
        region: env.awsRegion,
        tables: dynamodbTables,
      },
    },
    counts: {
      postgresIndexes: countIndexRows(postgresTables),
    },
    bff: env.runtimeMode === 'postgres'
      ? bff
      : {
          ...bff,
          overview: memoryOverview.overview,
          byStatusGroup: memoryOverview.byStatusGroup,
        },
  };
}

export async function getStatisticsSeries(input?: {
  windowSeconds?: number;
  routine?: string;
  source?: 'http' | 'message' | 'test';
}) {
  const series = getSharedBffExecutionSeriesStore().getSeries({
    windowSeconds: input?.windowSeconds ?? 100,
    routine: input?.routine,
    source: input?.source,
  });

  return {
    generatedAt: new Date().toISOString(),
    windowSeconds: input?.windowSeconds ?? 100,
    totals: summarizeSeries(series),
    series,
  };
}

export async function loadMonitorHome() {
  const env = readAppEnv();
  const runtime = new MonitorRuntimePostgres(env);
  const liveSeries = getSharedBffExecutionSeriesStore().getSeries({ windowSeconds: 300 });
  const [snapshot, postgres, dynamodb] = await Promise.all([
    getStatisticsSnapshot(),
    runtime.getPostgresSnapshot(),
    runtime.getDynamoSnapshot(),
  ]);
  const memoryOverview = buildOverviewFromSeries(liveSeries);

  return {
    generatedAt: new Date().toISOString(),
    system: {
      appEnv: env.appEnv,
      runtimeMode: env.runtimeMode,
      writeBehindEnabled: env.writeBehindEnabled,
      awsRegion: env.awsRegion,
    },
    bff: env.runtimeMode === 'postgres'
      ? snapshot.bff
      : {
          ...snapshot.bff,
          overview: memoryOverview.overview,
          byStatusGroup: memoryOverview.byStatusGroup,
        },
    recentSeries: liveSeries.slice(-20),
    postgres: {
      host: postgres.connection.host,
      port: postgres.connection.port,
      currentDatabase: postgres.connection.currentDatabase,
      availableDatabases: postgres.connection.availableDatabases,
      tableCount: postgres.tables.filter((table) => table.exists).length,
      missingTableCount: postgres.tables.filter((table) => !table.exists).length,
      activeConnections: postgres.database.activeConnections,
      cacheHitRate: postgres.database.cacheHitRate,
      pendingOutbox: postgres.queue.pendingOutbox,
      replicationFailures: postgres.queue.replicationFailures,
    },
    dynamodb: dynamodb.summary,
  };
}

export async function loadMonitorPostgres(input?: { databaseName?: string }) {
  const env = readAppEnv();
  const runtime = new MonitorRuntimePostgres(env);

  return {
    generatedAt: new Date().toISOString(),
    postgres: await runtime.getPostgresSnapshot(input),
  };
}

export async function loadMonitorDynamodb() {
  const env = readAppEnv();
  const runtime = new MonitorRuntimePostgres(env);

  return {
    generatedAt: new Date().toISOString(),
    dynamodb: await runtime.getDynamoSnapshot(),
  };
}

export async function loadMonitorArchitecture() {
  const env = readAppEnv();
  const metadata = new MonitorPersistenceMetadata(env);
  const tables = await metadata.listAll();

  return {
    generatedAt: new Date().toISOString(),
    architecture: {
      totalTables: tables.length,
      postgresBackedTables: tables.filter((table) => table.storageProfile !== 'dynamoOnly').length,
      dynamoBackedTables: tables.filter((table) => table.dynamoTableName !== null).length,
      hotBackupTables: tables.filter((table) => table.backupHot).length,
      tables,
    },
  };
}

export async function loadMonitorPostgresTableInspect(input: {
  databaseName?: string;
  tableName: string;
  page?: number;
  filters?: Record<string, string>;
}) {
  const env = readAppEnv();
  const runtime = new MonitorRuntimePostgres(env);

  return {
    generatedAt: new Date().toISOString(),
    ...(await runtime.inspectPostgresTable(input)),
  };
}

export async function loadMonitorPostgresTableDetails(input: {
  databaseName?: string;
  tableName: string;
}) {
  const env = readAppEnv();
  const runtime = new MonitorRuntimePostgres(env);

  return {
    generatedAt: new Date().toISOString(),
    ...(await runtime.getPostgresTableDetails(input)),
  };
}

export async function loadMonitorDynamoTableInspect(input: {
  tableName: string;
  cursor?: string;
  filters?: Record<string, string>;
}) {
  const env = readAppEnv();
  const runtime = new MonitorRuntimePostgres(env);

  return {
    generatedAt: new Date().toISOString(),
    ...(await runtime.inspectDynamoTable(input)),
  };
}

export async function loadMonitorDynamoTableDetails(input: {
  tableName: string;
}) {
  const env = readAppEnv();
  const runtime = new MonitorRuntimePostgres(env);

  return {
    generatedAt: new Date().toISOString(),
    ...(await runtime.getDynamoTableDetails(input)),
  };
}
