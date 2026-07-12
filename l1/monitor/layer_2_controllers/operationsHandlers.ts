/// <mls fileReference="_102034_/l1/monitor/layer_2_controllers/operationsHandlers.ts" enhancement="_blank" />
import { AppError, ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { loadOperationsSummary } from '/_102034_/l1/monitor/layer_3_usecases/operationsUsecases.js';
import type { MonitorOperationsWindow } from '/_102034_/l2/monitor/shared/contracts/operations.js';

const VALID_WINDOWS = new Set<MonitorOperationsWindow>(['1h', '6h', '24h', '7d']);
const SAFE_MODULE_RE = /^[A-Za-z0-9_.-]{1,80}$/u;

function parseWindow(value: unknown): MonitorOperationsWindow {
  if (value === undefined || value === null || value === '') {
    return '24h';
  }
  if (typeof value !== 'string' || !VALID_WINDOWS.has(value as MonitorOperationsWindow)) {
    throw new AppError('VALIDATION_ERROR', 'window must be one of: 1h, 6h, 24h, 7d', 400);
  }
  return value as MonitorOperationsWindow;
}

function parseModule(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !SAFE_MODULE_RE.test(value)) {
    throw new AppError('VALIDATION_ERROR', 'module must contain only letters, numbers, dot, dash or underscore', 400);
  }
  return value;
}

export const monitorOperationsSummaryHandler: BffHandler = async ({ request }) => {
  const params = (request.params ?? {}) as Record<string, unknown>;
  return ok(await loadOperationsSummary({
    window: parseWindow(params.window),
    module: parseModule(params.module),
  }));
};
