/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/runtimeMetricsUsecases.test.ts" enhancement="_blank" />

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCpuPercent,
  parseRuntimeMetricsQuery,
} from '/_102034_/l1/monitor/layer_3_usecases/runtimeMetricsUsecases.js';

test('parseRuntimeMetricsQuery applies defaults and bounds', () => {
  assert.deepEqual(parseRuntimeMetricsQuery('/monitor/runtime-metrics'), {
    minutes: 10,
    limit: 1000,
  });
  assert.deepEqual(parseRuntimeMetricsQuery('/monitor/runtime-metrics?minutes=0&limit=999999'), {
    minutes: 1,
    limit: 5000,
  });
  assert.deepEqual(parseRuntimeMetricsQuery('/monitor/runtime-metrics?minutes=64801&limit=25'), {
    minutes: 64800,
    limit: 25,
  });
});

test('calculateCpuPercent uses the elapsed wall-clock interval', () => {
  assert.equal(calculateCpuPercent({ user: 250_000, system: 250_000 }, 500_000), 100);
  assert.equal(calculateCpuPercent({ user: 10, system: 10 }, 0), 0);
});
