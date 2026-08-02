/// <mls fileReference="_102034_/l2/monitor/shared/contracts/runtimeMetrics.ts" enhancement="_blank" />

export interface RuntimeMetricSample {
  sampledAt: string;
  projectId: string;
  processInstance: string;
  pid: number;
  releaseId: string | null;
  nodeVersion: string;
  allocator: 'system' | 'jemalloc';
  optimizeForSize: boolean;
  uptimeSeconds: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  heapLimitBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
  cpuUserMicros: number;
  cpuSystemMicros: number;
  cpuPercent: number;
  eventLoopUtilization: number;
  eventLoopDelayP50Ms: number;
  eventLoopDelayP95Ms: number;
  eventLoopDelayP99Ms: number;
  systemTotalMemBytes: number;
  systemFreeMemBytes: number;
  systemLoadAvg1m: number;
  systemLoadAvg5m: number;
  systemLoadAvg15m: number;
}

export interface RuntimeMetricsResponse {
  projectId: string;
  intervalSeconds: number;
  retentionDays: number;
  requestedMinutes: number;
  limit: number;
  count: number;
  samples: RuntimeMetricSample[];
}
