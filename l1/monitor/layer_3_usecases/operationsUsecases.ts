/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/operationsUsecases.ts" enhancement="_blank" />
import { existsSync, readlinkSync, statfsSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { MonitorRuntimePostgres } from '/_102034_/l1/monitor/layer_1_external/data/postgres/MonitorRuntimePostgres.js';
import { loadProcessHealth } from '/_102034_/l1/monitor/layer_3_usecases/processHealthUsecases.js';
import type {
  MonitorOperationsSeverity,
  MonitorOperationsSummaryResponse,
  MonitorOperationsWindow,
} from '/_102034_/l2/monitor/shared/contracts/operations.js';

const WINDOW_HOURS: Record<MonitorOperationsWindow, number> = {
  '1h': 1,
  '6h': 6,
  '24h': 24,
  '7d': 24 * 7,
};

const BASE_DIR = process.env.COLLAB_RUNTIME_DIR ?? resolve(process.cwd(), '..', '..');
const CURRENT_LINK = `${BASE_DIR}/current`;

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function toMb(bytes: number) {
  return round1(bytes / 1024 / 1024);
}

function activeRelease() {
  try {
    const target = readlinkSync(CURRENT_LINK).replace(/\/+$/u, '');
    const releasePath = resolve(BASE_DIR, target);
    return {
      activeId: basename(releasePath),
      activatedAt: statSync(releasePath).mtime.toISOString(),
      cwd: process.cwd(),
    };
  } catch {
    return {
      activeId: null,
      activatedAt: null,
      cwd: process.cwd(),
    };
  }
}

function readDisk(path: string): MonitorOperationsSummaryResponse['infra']['disks'][number] {
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      sizeBytes: null,
      freeBytes: null,
      usedPercent: null,
    };
  }
  const stats = statfsSync(path);
  const sizeBytes = Number(stats.blocks) * Number(stats.bsize);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  const usedBytes = Math.max(0, sizeBytes - freeBytes);
  return {
    path,
    exists: true,
    sizeBytes,
    freeBytes,
    usedPercent: sizeBytes > 0 ? round1((usedBytes / sizeBytes) * 100) : null,
  };
}

function calculateHealth(input: {
  executions: MonitorOperationsSummaryResponse['executions'];
  abends: MonitorOperationsSummaryResponse['abends'];
  frontendErrors: MonitorOperationsSummaryResponse['frontendErrors'];
  disks: MonitorOperationsSummaryResponse['infra']['disks'];
  postgres: MonitorOperationsSummaryResponse['infra']['postgres'];
}): { severity: MonitorOperationsSeverity; health: MonitorOperationsSummaryResponse['health'] } {
  const reasons: string[] = [];
  let score = 100;

  if (input.executions.serverError > 0) {
    score -= Math.min(40, input.executions.serverError * 4);
    reasons.push(`${input.executions.serverError} backend server error(s)`);
  }
  if (input.abends.total > 0) {
    score -= Math.min(30, input.abends.total * 3);
    reasons.push(`${input.abends.total} abend(s)`);
  }
  if (input.frontendErrors.total > 0) {
    score -= Math.min(20, input.frontendErrors.total * 2);
    reasons.push(`${input.frontendErrors.total} frontend error(s)`);
  }
  if (input.executions.total > 0 && input.executions.okPercent < 95) {
    score -= 15;
    reasons.push(`ok rate ${input.executions.okPercent}%`);
  }
  if (input.executions.p95DurationMs > 3000) {
    score -= 10;
    reasons.push(`p95 ${input.executions.p95DurationMs}ms`);
  }
  if (input.postgres.replicationFailures > 0) {
    score -= 15;
    reasons.push(`${input.postgres.replicationFailures} replication failure(s)`);
  }
  const highDisk = input.disks.find((disk) => disk.usedPercent !== null && disk.usedPercent >= 85);
  if (highDisk) {
    score -= 15;
    reasons.push(`${highDisk.path} disk ${highDisk.usedPercent}% used`);
  }

  const boundedScore = Math.max(0, Math.min(100, score));
  const severity: MonitorOperationsSeverity = boundedScore < 60 ? 'red' : boundedScore < 85 ? 'yellow' : 'green';
  return {
    severity,
    health: {
      score: boundedScore,
      reasons: reasons.length > 0 ? reasons : ['No relevant issue in the selected window'],
    },
  };
}

function buildCopyText(summary: Omit<MonitorOperationsSummaryResponse, 'copyText'>) {
  const lines = [
    `collab monitor operation summary`,
    `generatedAt: ${summary.generatedAt}`,
    `window: ${summary.window.label} (${summary.window.startedAt} -> ${summary.window.finishedAt})`,
    `severity: ${summary.severity} score=${summary.health.score}`,
    `reasons: ${summary.health.reasons.join('; ')}`,
    ``,
    `executions: total=${summary.executions.total} ok=${summary.executions.okPercent}% serverErrors=${summary.executions.serverError} p95=${summary.executions.p95DurationMs}ms p99=${summary.executions.p99DurationMs}ms`,
    `previous: total=${summary.executions.previous.total} ok=${summary.executions.previous.okPercent}% serverErrors=${summary.executions.previous.serverError} p95=${summary.executions.previous.p95DurationMs}ms`,
    ``,
    `abends (${summary.abends.total})`,
    ...summary.abends.groups.slice(0, 10).map((entry) => `- ${entry.routine}: count=${entry.count} last=${entry.lastAt} error=${entry.latest.errorCode ?? 'n/a'}`),
    ``,
    `frontend errors (${summary.frontendErrors.total})`,
    ...summary.frontendErrors.groups.slice(0, 10).map((entry) => `- ${entry.routine}/${entry.eventType}: count=${entry.count} last=${entry.lastAt} label=${entry.latestLabel ?? 'n/a'}`),
    ``,
    `slowest routines`,
    ...summary.executions.slowestRoutines.map((entry) => `- ${entry.routine}: p95=${entry.p95DurationMs}ms avg=${entry.avgDurationMs}ms total=${entry.total}`),
    ``,
    `failing routines`,
    ...summary.executions.failingRoutines.map((entry) => `- ${entry.routine}: failures=${entry.failures}/${entry.total} (${entry.failurePercent}%) lastError=${entry.lastErrorCode ?? 'n/a'}`),
  ];
  return lines.join('\n');
}

export async function loadOperationsSummary(input: {
  window?: MonitorOperationsWindow;
  module?: string;
}): Promise<MonitorOperationsSummaryResponse> {
  const windowLabel = input.window ?? '24h';
  const windowHours = WINDOW_HOURS[windowLabel] ?? WINDOW_HOURS['24h'];
  const now = new Date();
  const startedAt = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const previousStartedAt = new Date(now.getTime() - windowHours * 2 * 60 * 60 * 1000);

  const env = readAppEnv();
  const runtime = new MonitorRuntimePostgres(env);
  const [operationData, processHealth] = await Promise.all([
    runtime.loadOperationsSummaryData({
      windowHours,
      module: input.module,
    }),
    Promise.resolve(loadProcessHealth()),
  ]);
  const disks = [readDisk('/'), readDisk('/data')];
  const healthResult = calculateHealth({
    executions: operationData.executions,
    abends: operationData.abends,
    frontendErrors: operationData.frontendErrors,
    disks,
    postgres: operationData.postgres,
  });
  const withoutCopyText: Omit<MonitorOperationsSummaryResponse, 'copyText'> = {
    generatedAt: now.toISOString(),
    window: {
      label: windowLabel,
      hours: windowHours,
      startedAt: startedAt.toISOString(),
      finishedAt: now.toISOString(),
      previousStartedAt: previousStartedAt.toISOString(),
      previousFinishedAt: startedAt.toISOString(),
    },
    severity: healthResult.severity,
    health: healthResult.health,
    filters: {
      module: input.module ?? null,
    },
    executions: operationData.executions,
    abends: operationData.abends,
    frontendErrors: operationData.frontendErrors,
    release: activeRelease(),
    infra: {
      process: {
        uptimeSeconds: processHealth.process.uptimeSeconds,
        nodeVersion: processHealth.process.nodeVersion,
        pid: processHealth.process.pid,
        rssMb: processHealth.memory.rssMb,
        heapUsedMb: processHealth.memory.heapUsedMb,
      },
      system: {
        totalMemMb: processHealth.system.totalMemMb,
        freeMemMb: processHealth.system.freememMb,
        freeMemPercent: processHealth.system.freeMemPercent,
        cpuCount: processHealth.system.cpuCount,
        loadAvg1m: processHealth.system.loadAvg1m,
        loadAvg5m: processHealth.system.loadAvg5m,
        loadAvg15m: processHealth.system.loadAvg15m,
      },
      postgres: operationData.postgres,
      disks,
    },
  };

  return {
    ...withoutCopyText,
    copyText: buildCopyText(withoutCopyText),
  };
}
