/// <mls fileReference="_102034_/l2/monitor/shared/contracts/home.ts" enhancement="_blank" />
export interface MonitorHomeSeriesPoint {
  timestamp: string;
  total: number;
  success: number;
  clientError: number;
  serverError: number;
  notFound: number;
}

export interface MonitorHomeResponse {
  generatedAt: string;
  system: {
    appEnv: string;
    runtimeMode: 'memory' | 'postgres';
    writeBehindEnabled: boolean;
    awsRegion: string;
  };
  bff: {
    byRoutine: Array<{
      routine: string;
      totalCount: number;
      lastFinishedAt: string;
      avgDurationMs: number;
    }>;
    byStatusGroup: Array<{
      statusGroup: string;
      totalCount: number;
    }>;
    overview: {
      totalExecutions: number;
      successCount: number;
      clientErrorCount: number;
      serverErrorCount: number;
      notFoundCount: number;
    };
    recentFailures: Array<{
      routine: string;
      statusCode: number;
      statusGroup: string;
      errorCode?: string | null;
      finishedAt: string;
    }>;
  };
  recentSeries: MonitorHomeSeriesPoint[];
  postgres: {
    host: string;
    port: number;
    currentDatabase: string;
    availableDatabases: string[];
    tableCount: number;
    missingTableCount: number;
    activeConnections: number;
    cacheHitRate: number | null;
    pendingOutbox: number;
    replicationFailures: number;
  };
  dynamodb: {
    totalTables: number;
    availableTables: number;
    missingTables: number;
    totalItemCount: number;
    metricsAreApproximate?: boolean;
  };
}

export interface MonitorStatisticsSeriesResponse {
  generatedAt: string;
  windowSeconds: number;
  totals: {
    total: number;
    success: number;
    clientError: number;
    serverError: number;
    notFound: number;
  };
  series: MonitorHomeSeriesPoint[];
}
