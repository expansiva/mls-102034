/// <mls fileReference="_102034_/l2/monitor/shared/contracts/operations.ts" enhancement="_blank" />

export type MonitorOperationsWindow = '1h' | '6h' | '24h' | '7d';
export type MonitorOperationsSeverity = 'green' | 'yellow' | 'red';

export interface MonitorOperationsSummaryRequest {
  window?: MonitorOperationsWindow;
  module?: string;
}

export interface MonitorOperationsSummaryResponse {
  generatedAt: string;
  window: {
    label: MonitorOperationsWindow;
    hours: number;
    startedAt: string;
    finishedAt: string;
    previousStartedAt: string;
    previousFinishedAt: string;
  };
  severity: MonitorOperationsSeverity;
  health: {
    score: number;
    reasons: string[];
  };
  filters: {
    module: string | null;
  };
  executions: {
    total: number;
    success: number;
    clientError: number;
    serverError: number;
    notFound: number;
    okPercent: number;
    avgDurationMs: number;
    p95DurationMs: number;
    p99DurationMs: number;
    previous: {
      total: number;
      serverError: number;
      okPercent: number;
      p95DurationMs: number;
    };
    change: {
      total: number;
      serverError: number;
      okPercent: number;
      p95DurationMs: number;
    };
    slowestRoutines: Array<{
      routine: string;
      module: string;
      total: number;
      avgDurationMs: number;
      p95DurationMs: number;
      lastFinishedAt: string;
    }>;
    failingRoutines: Array<{
      routine: string;
      module: string;
      total: number;
      failures: number;
      failurePercent: number;
      lastFinishedAt: string;
      lastErrorCode: string | null;
    }>;
  };
  abends: {
    total: number;
    groups: Array<{
      routine: string;
      module: string;
      count: number;
      firstAt: string;
      lastAt: string;
      latest: {
        requestId: string;
        traceId: string;
        statusCode: number;
        errorCode: string | null;
        errorStack: string | null;
        durationMs: number;
      };
    }>;
  };
  frontendErrors: {
    total: number;
    groups: Array<{
      routine: string;
      eventType: string;
      count: number;
      firstAt: string;
      lastAt: string;
      latestLabel: string | null;
    }>;
  };
  release: {
    activeId: string | null;
    activatedAt: string | null;
    cwd: string;
  };
  infra: {
    process: {
      uptimeSeconds: number;
      nodeVersion: string;
      pid: number;
      rssMb: number;
      heapUsedMb: number;
    };
    system: {
      totalMemMb: number;
      freeMemMb: number;
      freeMemPercent: number;
      cpuCount: number;
      loadAvg1m: number;
      loadAvg5m: number;
      loadAvg15m: number;
    };
    postgres: {
      currentDatabase: string;
      activeConnections: number;
      waitingLocks: number;
      cacheHitRate: number | null;
      pendingOutbox: number;
      replicationFailures: number;
    };
    disks: Array<{
      path: string;
      exists: boolean;
      sizeBytes: number | null;
      freeBytes: number | null;
      usedPercent: number | null;
    }>;
  };
  copyText: string;
}
