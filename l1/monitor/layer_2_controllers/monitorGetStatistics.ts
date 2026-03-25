/// <mls fileReference="_102034_/l1/monitor/layer_2_controllers/monitorGetStatistics.ts" enhancement="_blank" />
import { AppError, ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  getStatisticsSeries,
  getStatisticsSnapshot,
  loadMonitorArchitecture,
  loadMonitorDynamoTableDetails,
  loadMonitorDynamoTableInspect,
  loadMonitorDynamodb,
  loadMonitorHome,
  loadMonitorPostgresTableDetails,
  loadMonitorPostgresTableInspect,
  loadMonitorPostgres,
} from '/_102034_/l1/monitor/layer_3_usecases/statisticsUsecases.js';

function parseWindowSeconds(value: unknown): number {
  if (value === undefined) {
    return 100;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError('VALIDATION_ERROR', 'windowSeconds must be a positive integer', 400);
  }

  return Math.min(parsed, 100);
}

function parseOptionalDatabaseName(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_ERROR', 'databaseName must be a string', 400);
  }

  return value;
}

function parseRequiredTableName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'tableName must be a non-empty string', 400);
  }

  return value.trim();
}

function parsePage(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError('VALIDATION_ERROR', 'page must be a positive integer', 400);
  }

  return parsed;
}

function parseOptionalCursor(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_ERROR', 'cursor must be a string', 400);
  }
  return value;
}

function parseFilters(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('VALIDATION_ERROR', 'filters must be an object', 400);
  }

  const invalidEntry = Object.entries(value as Record<string, unknown>).find(([, entry]) => entry !== undefined && typeof entry !== 'string');
  if (invalidEntry) {
    throw new AppError('VALIDATION_ERROR', 'filters must contain only string values', 400);
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => typeof entry === 'string' && entry.trim().length > 0)
      .map(([key, entry]) => [key, (entry as string).trim()]),
  );
}

export const monitorGetStatisticsSnapshotHandler: BffHandler = async () => {
  return ok(await getStatisticsSnapshot());
};

export const monitorGetStatisticsSeriesHandler: BffHandler = async ({ request }) => {
  const params = (request.params ?? {}) as Record<string, unknown>;
  return ok(await getStatisticsSeries({
    windowSeconds: parseWindowSeconds(params.windowSeconds),
    routine: typeof params.routine === 'string' ? params.routine : undefined,
    source:
      params.source === 'http' || params.source === 'message' || params.source === 'test'
        ? params.source
        : undefined,
  }));
};

export const monitorHomeLoadHandler: BffHandler = async () => ok(await loadMonitorHome());

export const monitorPostgresLoadHandler: BffHandler = async ({ request }) => {
  const params = (request.params ?? {}) as Record<string, unknown>;
  return ok(await loadMonitorPostgres({
    databaseName: parseOptionalDatabaseName(params.databaseName),
  }));
};

export const monitorDynamodbLoadHandler: BffHandler = async () => ok(await loadMonitorDynamodb());
export const monitorArchitectureLoadHandler: BffHandler = async () => ok(await loadMonitorArchitecture());

export const monitorPostgresTableInspectHandler: BffHandler = async ({ request }) => {
  const params = (request.params ?? {}) as Record<string, unknown>;
  return ok(await loadMonitorPostgresTableInspect({
    databaseName: parseOptionalDatabaseName(params.databaseName),
    tableName: parseRequiredTableName(params.tableName),
    page: parsePage(params.page),
    filters: parseFilters(params.filters),
  }));
};

export const monitorPostgresTableDetailsHandler: BffHandler = async ({ request }) => {
  const params = (request.params ?? {}) as Record<string, unknown>;
  return ok(await loadMonitorPostgresTableDetails({
    databaseName: parseOptionalDatabaseName(params.databaseName),
    tableName: parseRequiredTableName(params.tableName),
  }));
};

export const monitorDynamodbTableInspectHandler: BffHandler = async ({ request }) => {
  const params = (request.params ?? {}) as Record<string, unknown>;
  return ok(await loadMonitorDynamoTableInspect({
    tableName: parseRequiredTableName(params.tableName),
    cursor: parseOptionalCursor(params.cursor),
    filters: parseFilters(params.filters),
  }));
};

export const monitorDynamodbTableDetailsHandler: BffHandler = async ({ request }) => {
  const params = (request.params ?? {}) as Record<string, unknown>;
  return ok(await loadMonitorDynamoTableDetails({
    tableName: parseRequiredTableName(params.tableName),
  }));
};
