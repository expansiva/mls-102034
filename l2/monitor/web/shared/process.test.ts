/// <mls fileReference="_102034_/l2/monitor/web/shared/process.test.ts" enhancement="_blank" />

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRuntimeMetricChart,
  latestRuntimeMetricSamples,
} from '/_102034_/l2/monitor/web/shared/process.js';
import type { RuntimeMetricSample } from '/_102034_/l2/monitor/shared/contracts/runtimeMetrics.js';

function sample(input: Partial<RuntimeMetricSample> & Pick<RuntimeMetricSample, 'sampledAt' | 'processInstance' | 'rssBytes'>): RuntimeMetricSample {
  return {
    projectId: '102045', pid: 1, releaseId: null, nodeVersion: 'v24', allocator: 'system',
    optimizeForSize: false, uptimeSeconds: 1, heapUsedBytes: 1, heapTotalBytes: 1,
    heapLimitBytes: 1, externalBytes: 1, arrayBuffersBytes: 1, cpuUserMicros: 1,
    cpuSystemMicros: 1, cpuPercent: 1, eventLoopUtilization: 0.1,
    eventLoopDelayP50Ms: 1, eventLoopDelayP95Ms: 1, eventLoopDelayP99Ms: 1,
    systemTotalMemBytes: 1, systemFreeMemBytes: 1, systemLoadAvg1m: 1,
    systemLoadAvg5m: 1, systemLoadAvg15m: 1,
    ...input,
  };
}

test('latestRuntimeMetricSamples keeps the newest sample from each worker', () => {
  const samples = [
    sample({ sampledAt: '2026-08-01T12:00:00.000Z', processInstance: '0', rssBytes: 10 }),
    sample({ sampledAt: '2026-08-01T12:00:05.000Z', processInstance: '0', rssBytes: 20 }),
    sample({ sampledAt: '2026-08-01T12:00:05.100Z', processInstance: '1', rssBytes: 30 }),
  ];
  assert.deepEqual(latestRuntimeMetricSamples(samples).map((entry) => entry.rssBytes), [20, 30]);
});

test('buildRuntimeMetricChart preserves a time series for each worker', () => {
  const chart = buildRuntimeMetricChart([
    sample({ sampledAt: '2026-08-01T12:00:05.000Z', processInstance: '0', rssBytes: 10 * 1024 * 1024 }),
    sample({ sampledAt: '2026-08-01T12:00:05.200Z', processInstance: '1', rssBytes: 30 * 1024 * 1024 }),
    sample({ sampledAt: '2026-08-01T12:00:10.000Z', processInstance: '0', rssBytes: 40 * 1024 * 1024 }),
  ], 'rssBytes');
  assert.deepEqual(chart.series.map((series) => ({
    processInstance: series.processInstance,
    values: series.points.map((point) => point.value),
  })), [
    { processInstance: '0', values: [10, 40] },
    { processInstance: '1', values: [30] },
  ]);
  assert.equal(chart.minValue, 7);
  assert.equal(chart.maxValue, 43);
});
