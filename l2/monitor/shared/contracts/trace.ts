/// <mls fileReference="_102034_/l2/monitor/shared/contracts/trace.ts" enhancement="_blank" />
export interface MonitorTraceEntry {
  id: string;
  requestId: string;
  traceId: string;
  userId: string;
  routine: string;
  module: string;
  statusCode: number;
  statusGroup: string;
  ok: boolean;
  durationMs: number;
  errorCode?: string | null;
  errorStack?: string | null;
  startedAt: string;
  finishedAt: string;
}

export interface MonitorTraceResponse {
  requestId: string | null;
  traceId: string | null;
  entries: MonitorTraceEntry[];
  totalCount: number;
}
