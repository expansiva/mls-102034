/// <mls fileReference="_102034_/l2/monitor/web/shared/process.ts" enhancement="_blank" />
import type { BffClientOptions } from '/_102029_/l2/bffClient.js';
import type { MonitorProcessResponse } from '/_102034_/l2/monitor/shared/contracts/process.js';
import type {
  RuntimeMetricSample,
  RuntimeMetricsResponse,
} from '/_102034_/l2/monitor/shared/contracts/runtimeMetrics.js';
import { execBff } from '/_102029_/l2/bffClient.js';

export async function loadMonitorProcess(options?: BffClientOptions) {
  return execBff<MonitorProcessResponse>('monitor.process.load', {}, options);
}

export const RUNTIME_METRIC_OPTIONS = [
  { key: 'rssBytes', label: 'RSS', unit: 'MB', value: (sample: RuntimeMetricSample) => sample.rssBytes / 1024 / 1024 },
  { key: 'heapUsedBytes', label: 'Heap usado', unit: 'MB', value: (sample: RuntimeMetricSample) => sample.heapUsedBytes / 1024 / 1024 },
  { key: 'heapTotalBytes', label: 'Heap total', unit: 'MB', value: (sample: RuntimeMetricSample) => sample.heapTotalBytes / 1024 / 1024 },
  { key: 'heapLimitBytes', label: 'Limite do heap', unit: 'MB', value: (sample: RuntimeMetricSample) => sample.heapLimitBytes / 1024 / 1024 },
  { key: 'externalBytes', label: 'Memória externa', unit: 'MB', value: (sample: RuntimeMetricSample) => sample.externalBytes / 1024 / 1024 },
  { key: 'systemFreeMemBytes', label: 'Memória livre do servidor', unit: 'MB', value: (sample: RuntimeMetricSample) => sample.systemFreeMemBytes / 1024 / 1024 },
  { key: 'cpuPercent', label: 'CPU do processo', unit: '%', value: (sample: RuntimeMetricSample) => sample.cpuPercent },
  { key: 'eventLoopUtilization', label: 'Utilização do event loop', unit: '%', value: (sample: RuntimeMetricSample) => sample.eventLoopUtilization * 100 },
  { key: 'eventLoopDelayP95Ms', label: 'Atraso do event loop p95', unit: 'ms', value: (sample: RuntimeMetricSample) => sample.eventLoopDelayP95Ms },
  { key: 'systemLoadAvg1m', label: 'Load average 1m', unit: '', value: (sample: RuntimeMetricSample) => sample.systemLoadAvg1m },
] as const;

export type RuntimeMetricKey = typeof RUNTIME_METRIC_OPTIONS[number]['key'];

export interface RuntimeMetricChartPoint {
  timestamp: number;
  value: number;
}

export interface RuntimeMetricChartSeries {
  processInstance: string;
  points: RuntimeMetricChartPoint[];
}

export interface RuntimeMetricChart {
  series: RuntimeMetricChartSeries[];
  minValue: number;
  maxValue: number;
}

export async function loadMonitorRuntimeMetrics(
  input: { minutes?: number; limit?: number } = {},
  options?: BffClientOptions,
): Promise<{
  ok: boolean;
  data: RuntimeMetricsResponse | null;
  error: { code: string; message: string } | null;
}> {
  const search = new URLSearchParams({
    minutes: String(input.minutes ?? 60),
    limit: String(input.limit ?? 2000),
  });
  try {
    const response = await fetch(`/monitor/runtime-metrics?${search.toString()}`, {
      signal: options?.signal,
    });
    const payload = await response.json() as {
      ok?: boolean;
      data?: RuntimeMetricsResponse | null;
      error?: { code?: string; message?: string } | null;
    };
    if (!response.ok || !payload.ok || !payload.data) {
      return {
        ok: false,
        data: null,
        error: {
          code: payload.error?.code ?? 'RUNTIME_METRICS_UNAVAILABLE',
          message: payload.error?.message ?? 'Não foi possível carregar as métricas históricas.',
        },
      };
    }
    return { ok: true, data: payload.data, error: null };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: {
        code: 'RUNTIME_METRICS_UNAVAILABLE',
        message: error instanceof Error ? error.message : 'Não foi possível carregar as métricas históricas.',
      },
    };
  }
}

export function latestRuntimeMetricSamples(samples: RuntimeMetricSample[]): RuntimeMetricSample[] {
  const latestByInstance = new Map<string, RuntimeMetricSample>();
  for (const sample of samples) {
    const current = latestByInstance.get(sample.processInstance);
    if (!current || current.sampledAt < sample.sampledAt) {
      latestByInstance.set(sample.processInstance, sample);
    }
  }
  return [...latestByInstance.values()].sort((left, right) => left.processInstance.localeCompare(right.processInstance));
}

export function averageRuntimeMetric(
  samples: RuntimeMetricSample[],
  value: (sample: RuntimeMetricSample) => number,
): number | null {
  if (samples.length === 0) {
    return null;
  }
  return samples.reduce((total, sample) => total + value(sample), 0) / samples.length;
}

export function buildRuntimeMetricChart(
  samples: RuntimeMetricSample[],
  key: RuntimeMetricKey,
): RuntimeMetricChart {
  const option = RUNTIME_METRIC_OPTIONS.find((candidate) => candidate.key === key) ?? RUNTIME_METRIC_OPTIONS[0];
  const pointsByInstance = new Map<string, RuntimeMetricChartPoint[]>();
  for (const sample of samples) {
    const sampledAt = Date.parse(sample.sampledAt);
    if (!Number.isFinite(sampledAt)) continue;
    const points = pointsByInstance.get(sample.processInstance) ?? [];
    points.push({ timestamp: sampledAt, value: option.value(sample) });
    pointsByInstance.set(sample.processInstance, points);
  }
  const series = [...pointsByInstance.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([processInstance, points]) => ({
      processInstance,
      points: points.sort((left, right) => left.timestamp - right.timestamp),
    }));
  const values = series.flatMap((entry) => entry.points.map((point) => point.value));

  if (values.length === 0) {
    return { series, minValue: 0, maxValue: 0 };
  }

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const rawRange = rawMax - rawMin;
  const padding = rawRange > 0 ? rawRange * 0.1 : Math.max(Math.abs(rawMax) * 0.1, 1);
  const minValue = Math.max(0, rawMin - padding);
  const maxValue = rawMax + padding;

  return { series, minValue, maxValue };
}
