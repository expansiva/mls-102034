/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/runtimeMetricsUsecases.ts" enhancement="_blank" />

import { realpathSync } from 'node:fs';
import { basename } from 'node:path';
import { freemem, loadavg, totalmem } from 'node:os';
import { monitorEventLoopDelay, performance, type EventLoopUtilization } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import {
  RUNTIME_METRICS_INTERVAL_SECONDS,
  RUNTIME_METRICS_RETENTION_DAYS,
  RuntimeMetricsPostgres,
} from '/_102034_/l1/monitor/layer_1_external/data/postgres/RuntimeMetricsPostgres.js';
import type {
  RuntimeMetricSample,
  RuntimeMetricsResponse,
} from '/_102034_/l2/monitor/shared/contracts/runtimeMetrics.js';

const DEFAULT_QUERY_MINUTES = 10;
const DEFAULT_QUERY_LIMIT = 1000;
const MAX_QUERY_MINUTES = RUNTIME_METRICS_RETENTION_DAYS * 24 * 60;
const MAX_QUERY_LIMIT = 5000;

interface RuntimeMetricIdentity {
  projectId: string;
  processInstance: string;
  releaseId: string | null;
  allocator: 'system' | 'jemalloc';
  optimizeForSize: boolean;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function nanosecondsToMilliseconds(value: number): number {
  return finite(value / 1_000_000);
}

function resolveReleaseId(): string | null {
  const explicit = process.env.COLLAB_RELEASE_ID?.trim();
  if (explicit) {
    return explicit;
  }
  try {
    const candidate = basename(realpathSync(process.cwd()));
    return /^\d{14}$/u.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function hasOptimizeForSize(): boolean {
  const flags = [...process.execArgv, process.env.NODE_OPTIONS ?? ''].join(' ');
  return /(?:^|\s)--optimize-for-size(?:\s|$)/u.test(flags);
}

export function resolveRuntimeMetricIdentity(
  env: AppEnv,
  defaultProjectId?: string,
): RuntimeMetricIdentity {
  return {
    projectId: env.projectId ?? process.env.COLLAB_PROJECT_ID?.trim() ?? defaultProjectId ?? 'unknown',
    processInstance: process.env.NODE_APP_INSTANCE?.trim() ?? process.env.pm_id?.trim() ?? '0',
    releaseId: resolveReleaseId(),
    allocator: process.env.LD_PRELOAD?.toLowerCase().includes('jemalloc') ? 'jemalloc' : 'system',
    optimizeForSize: hasOptimizeForSize(),
  };
}

export function calculateCpuPercent(
  cpuUsage: NodeJS.CpuUsage,
  elapsedMicroseconds: number,
): number {
  if (elapsedMicroseconds <= 0) {
    return 0;
  }
  return finite(((cpuUsage.user + cpuUsage.system) / elapsedMicroseconds) * 100);
}

export function parseRuntimeMetricsQuery(url: string): { minutes: number; limit: number } {
  const query = new URL(url, 'http://runtime.local').searchParams;
  const requestedMinutes = Number(query.get('minutes') ?? DEFAULT_QUERY_MINUTES);
  const requestedLimit = Number(query.get('limit') ?? DEFAULT_QUERY_LIMIT);
  const minutes = Number.isFinite(requestedMinutes)
    ? Math.min(Math.max(Math.floor(requestedMinutes), 1), MAX_QUERY_MINUTES)
    : DEFAULT_QUERY_MINUTES;
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.floor(requestedLimit), 1), MAX_QUERY_LIMIT)
    : DEFAULT_QUERY_LIMIT;
  return { minutes, limit };
}

export class RuntimeMetricsCollector {
  private timer: NodeJS.Timeout | null = null;
  private collecting = false;
  private previousCpuUsage = process.cpuUsage();
  private previousHrtime = process.hrtime.bigint();
  private previousElu: EventLoopUtilization = performance.eventLoopUtilization();
  private readonly eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });

  public constructor(
    private readonly repository: RuntimeMetricsPostgres,
    private readonly identity: RuntimeMetricIdentity,
  ) {}

  public async start(): Promise<void> {
    if (this.timer) {
      return;
    }
    await this.repository.ensureStorage();
    this.previousCpuUsage = process.cpuUsage();
    this.previousHrtime = process.hrtime.bigint();
    this.previousElu = performance.eventLoopUtilization();
    this.eventLoopDelay.enable();
    this.timer = setInterval(() => {
      void this.collectOnce().catch((error) => {
        console.error('[runtimeMetrics] collection failed:', error);
      });
    }, RUNTIME_METRICS_INTERVAL_SECONDS * 1000);
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.eventLoopDelay.disable();
  }

  public async collectOnce(): Promise<void> {
    if (this.collecting) {
      return;
    }
    this.collecting = true;
    try {
      const sampledAt = new Date().toISOString();
      const nowHrtime = process.hrtime.bigint();
      const elapsedMicroseconds = Number(nowHrtime - this.previousHrtime) / 1000;
      const cpuUsage = process.cpuUsage(this.previousCpuUsage);
      const currentElu = performance.eventLoopUtilization();
      const intervalElu = performance.eventLoopUtilization(currentElu, this.previousElu);
      this.previousHrtime = nowHrtime;
      this.previousCpuUsage = process.cpuUsage();
      this.previousElu = currentElu;

      const memory = process.memoryUsage();
      const heap = getHeapStatistics();
      const [loadAvg1m, loadAvg5m, loadAvg15m] = loadavg();
      const sample: RuntimeMetricSample = {
        sampledAt,
        projectId: this.identity.projectId,
        processInstance: this.identity.processInstance,
        pid: process.pid,
        releaseId: this.identity.releaseId,
        nodeVersion: process.version,
        allocator: this.identity.allocator,
        optimizeForSize: this.identity.optimizeForSize,
        uptimeSeconds: process.uptime(),
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        heapLimitBytes: heap.heap_size_limit,
        externalBytes: memory.external,
        arrayBuffersBytes: memory.arrayBuffers,
        cpuUserMicros: cpuUsage.user,
        cpuSystemMicros: cpuUsage.system,
        cpuPercent: calculateCpuPercent(cpuUsage, elapsedMicroseconds),
        eventLoopUtilization: finite(intervalElu.utilization),
        eventLoopDelayP50Ms: nanosecondsToMilliseconds(this.eventLoopDelay.percentile(50)),
        eventLoopDelayP95Ms: nanosecondsToMilliseconds(this.eventLoopDelay.percentile(95)),
        eventLoopDelayP99Ms: nanosecondsToMilliseconds(this.eventLoopDelay.percentile(99)),
        systemTotalMemBytes: totalmem(),
        systemFreeMemBytes: freemem(),
        systemLoadAvg1m: finite(loadAvg1m ?? 0),
        systemLoadAvg5m: finite(loadAvg5m ?? 0),
        systemLoadAvg15m: finite(loadAvg15m ?? 0),
      };
      this.eventLoopDelay.reset();
      await this.repository.insert(sample);
    } finally {
      this.collecting = false;
    }
  }
}

export function createRuntimeMetricsCollector(
  env: AppEnv,
  defaultProjectId?: string,
): RuntimeMetricsCollector {
  return new RuntimeMetricsCollector(
    new RuntimeMetricsPostgres(env),
    resolveRuntimeMetricIdentity(env, defaultProjectId),
  );
}

export async function loadRuntimeMetricSamples(
  input: { minutes: number; limit: number; defaultProjectId?: string },
  env: AppEnv = readAppEnv(),
): Promise<RuntimeMetricsResponse> {
  const identity = resolveRuntimeMetricIdentity(env, input.defaultProjectId);
  const samples = await new RuntimeMetricsPostgres(env).list({
    projectId: identity.projectId,
    minutes: input.minutes,
    limit: input.limit,
  });
  return {
    projectId: identity.projectId,
    intervalSeconds: RUNTIME_METRICS_INTERVAL_SECONDS,
    retentionDays: RUNTIME_METRICS_RETENTION_DAYS,
    requestedMinutes: input.minutes,
    limit: input.limit,
    count: samples.length,
    samples,
  };
}
