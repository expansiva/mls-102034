/// <mls fileReference="_102034_/l2/monitor/shared/contracts/abend.ts" enhancement="_blank" />
export interface MonitorAbendEntry {
  id: string;
  requestId: string;
  traceId: string;
  userId: string;
  routine: string;
  module: string;
  statusCode: number;
  statusGroup: string;
  durationMs: number;
  errorCode: string | null;
  errorStack: string | null;
  startedAt: string;
  finishedAt: string;
}

export interface MonitorAbendResponse {
  entries: MonitorAbendEntry[];
  totalCount: number;
  generatedAt: string;
}
