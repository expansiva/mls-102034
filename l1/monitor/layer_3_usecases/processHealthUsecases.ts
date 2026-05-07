/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/processHealthUsecases.ts" enhancement="_blank" />
import { cpus, freemem, loadavg, totalmem } from 'node:os';
import type { MonitorProcessResponse } from '/_102034_/l2/monitor/shared/contracts/process.js';

function toMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function toPercent(value: number, total: number): number {
  if (total === 0) {
    return 0;
  }
  return Math.round((value / total) * 1000) / 10;
}

export function loadProcessHealth(): MonitorProcessResponse {
  const mem = process.memoryUsage();
  const totalMem = totalmem();
  const freeMem = freemem();
  const usedMem = totalMem - freeMem;
  const [avg1m, avg5m, avg15m] = loadavg();

  return {
    generatedAt: new Date().toISOString(),
    memory: {
      heapUsedMb: toMb(mem.heapUsed),
      heapTotalMb: toMb(mem.heapTotal),
      rssMb: toMb(mem.rss),
      externalMb: toMb(mem.external),
      heapUsedPercent: toPercent(mem.heapUsed, mem.heapTotal),
    },
    system: {
      freememMb: toMb(freeMem),
      totalMemMb: toMb(totalMem),
      freeMemPercent: toPercent(freeMem, totalMem),
      cpuCount: cpus().length,
      loadAvg1m: Math.round((avg1m ?? 0) * 100) / 100,
      loadAvg5m: Math.round((avg5m ?? 0) * 100) / 100,
      loadAvg15m: Math.round((avg15m ?? 0) * 100) / 100,
    },
    process: {
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      pid: process.pid,
    },
  };
}
