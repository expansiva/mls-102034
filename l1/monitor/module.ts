/// <mls fileReference="_102034_/l1/monitor/module.ts" enhancement="_blank" />
export type MonitorStatusGroup =
  | 'success'
  | 'client_error'
  | 'server_error'
  | 'not_found';

export interface MonitorBffExecutionLogRecord {
  id: string;
  requestId: string;
  traceId: string;
  routine: string;
  module: string;
  pageName: string;
  command: string;
  source: 'http' | 'message' | 'test';
  statusCode: number;
  statusGroup: MonitorStatusGroup;
  ok: boolean;
  durationMs: number;
  errorCode?: string | null;
  startedAt: string;
  finishedAt: string;
}

export interface MonitorBffExecutionAggregateMinuteRecord {
  id: string;
  bucketStart: string;
  routine: string;
  module: string;
  pageName: string;
  command: string;
  source: 'http' | 'message' | 'test';
  statusCode: number;
  statusGroup: MonitorStatusGroup;
  totalCount: number;
  successCount: number;
  clientErrorCount: number;
  serverErrorCount: number;
  notFoundCount: number;
  totalDurationMs: number;
  updatedAt: string;
}

export interface MonitorSeriesPoint {
  timestamp: string;
  total: number;
  success: number;
  clientError: number;
  serverError: number;
  notFound: number;
}

export interface MonitorExecutionEvent {
  requestId: string;
  traceId: string;
  routine: string;
  module: string;
  pageName: string;
  command: string;
  source: 'http' | 'message' | 'test';
  statusCode: number;
  statusGroup: MonitorStatusGroup;
  ok: boolean;
  durationMs: number;
  errorCode?: string | null;
  startedAt: string;
  finishedAt: string;
}
