/// <mls fileReference="_102034_/l2/monitor/shared/contracts/logs.ts" enhancement="_blank" />

export type MonitorLogApp = 'msg' | 'msg-worker';
export type MonitorLogStream = 'out' | 'error';

export interface MonitorLogPageInput {
  app: MonitorLogApp;
  stream: MonitorLogStream;
  startAt?: string;
  text?: string;
  cursor?: string;
  limit?: number;
}

export interface MonitorLogEntry {
  id: string;
  timestamp: string | null;
  text: string;
  truncated: boolean;
}

export interface MonitorLogPage {
  app: MonitorLogApp;
  stream: MonitorLogStream;
  file: string;
  updatedAt: string | null;
  entries: MonitorLogEntry[];
  nextCursor: string | null;
  hasMore: boolean;
  limited: boolean;
  scannedBytes: number;
  untimedEntries: number;
}

/** Server-side cursor. Opaque to the client. Carries no filesystem path. */
export interface MonitorLogCursor {
  v: 1;
  app: MonitorLogApp;
  stream: MonitorLogStream;
  filterKey: string;
  sourceKey: string;
  offset: number;
}
