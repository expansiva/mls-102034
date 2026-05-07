/// <mls fileReference="_102034_/l2/monitor/shared/contracts/process.ts" enhancement="_blank" />
export interface MonitorProcessResponse {
  generatedAt: string;
  memory: {
    heapUsedMb: number;
    heapTotalMb: number;
    rssMb: number;
    externalMb: number;
    heapUsedPercent: number;
  };
  system: {
    freememMb: number;
    totalMemMb: number;
    freeMemPercent: number;
    cpuCount: number;
    loadAvg1m: number;
    loadAvg5m: number;
    loadAvg15m: number;
  };
  process: {
    uptimeSeconds: number;
    nodeVersion: string;
    pid: number;
  };
}
