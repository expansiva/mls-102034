/// <mls fileReference="_102034_/l1/monitor/layer_1_external/cache/BffExecutionSeriesStore.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BffExecutionSeriesStore,
} from '/_102034_/l1/monitor/layer_1_external/cache/BffExecutionSeriesStore.js';

test('bff execution series store aggregates counts by second and status group', () => {
  const store = new BffExecutionSeriesStore(100);
  const timestamp = new Date().toISOString();

  store.record({
    requestId: 'r1',
    traceId: 't1',
    userId: 'anonymous',
    routine: 'mdm.entity.create',
    module: 'mdm',
    pageName: 'entity',
    command: 'create',
    source: 'http',
    statusCode: 200,
    statusGroup: 'success',
    ok: true,
    durationMs: 20,
    errorCode: null,
    startedAt: '2026-03-18T18:00:04.980Z',
    finishedAt: timestamp,
  });
  store.record({
    requestId: 'r2',
    traceId: 't2',
    userId: 'anonymous',
    routine: 'mdm.entity.create',
    module: 'mdm',
    pageName: 'entity',
    command: 'create',
    source: 'http',
    statusCode: 404,
    statusGroup: 'not_found',
    ok: false,
    durationMs: 8,
    errorCode: 'NOT_FOUND',
    startedAt: '2026-03-18T18:00:04.992Z',
    finishedAt: timestamp,
  });

  const lastPoint = store.getSeries({ windowSeconds: 2 }).at(-1);
  assert.ok(lastPoint);
  assert.equal(lastPoint.total, 2);
  assert.equal(lastPoint.success, 1);
  assert.equal(lastPoint.notFound, 1);
});
