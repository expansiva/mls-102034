/// <mls fileReference="_102034_/l2/monitor/shared/contracts/messages.ts" enhancement="_blank" />

export interface MonitorMessagesStorage {
  dynamoRegion?: string;
  s3Region?: string;
  bucket?: string;
  tablePrefix?: string;
  instanceId?: string | null;
  accountId?: string;
  ok?: boolean;
  error?: string;
}

export interface MonitorMessagesHealth {
  reachable: boolean;
  url: string;
  statusCode: number | null;
  error?: string;
  storage: MonitorMessagesStorage | null;
}

export interface MonitorMessagesReady {
  reachable: boolean;
  url: string;
  statusCode: number | null;
  status?: string;
  error?: string;
}

export interface MonitorMessagesPm2Process {
  name: string;
  instances: number;
  status: string;
  restarts: number;
  uptimeMs: number | null;
  memoryMb: number | null;
  cpu: number | null;
}

export interface MonitorMessagesStatusResponse {
  generatedAt: string;
  target: string;
  local: boolean;
  health: MonitorMessagesHealth;
  ready: MonitorMessagesReady;
  pm2: MonitorMessagesPm2Process[];
  pm2Error?: string;
}
