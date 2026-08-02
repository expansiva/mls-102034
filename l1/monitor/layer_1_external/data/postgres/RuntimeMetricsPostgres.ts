/// <mls fileReference="_102034_/l1/monitor/layer_1_external/data/postgres/RuntimeMetricsPostgres.ts" enhancement="_blank" />

import type { PoolClient } from 'pg';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { getSharedPgPool, queryRows } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';
import type { RuntimeMetricSample } from '/_102034_/l2/monitor/shared/contracts/runtimeMetrics.js';

export const RUNTIME_METRICS_INTERVAL_SECONDS = 5;
export const RUNTIME_METRICS_RETENTION_DAYS = 45;

const STORAGE_LOCK_NAME = 'collab_monitor.runtime_process_sample.v1';
const TABLE_NAME = 'collab_monitor.runtime_process_sample';

interface RuntimeMetricRow {
  sampledAt: string;
  projectId: string;
  processInstance: string;
  pid: number;
  releaseId: string | null;
  nodeVersion: string;
  allocator: 'system' | 'jemalloc';
  optimizeForSize: boolean;
  uptimeSeconds: number | string;
  rssBytes: number | string;
  heapUsedBytes: number | string;
  heapTotalBytes: number | string;
  heapLimitBytes: number | string;
  externalBytes: number | string;
  arrayBuffersBytes: number | string;
  cpuUserMicros: number | string;
  cpuSystemMicros: number | string;
  cpuPercent: number | string;
  eventLoopUtilization: number | string;
  eventLoopDelayP50Ms: number | string;
  eventLoopDelayP95Ms: number | string;
  eventLoopDelayP99Ms: number | string;
  systemTotalMemBytes: number | string;
  systemFreeMemBytes: number | string;
  systemLoadAvg1m: number | string;
  systemLoadAvg5m: number | string;
  systemLoadAvg15m: number | string;
}

function toNumber(value: number | string): number {
  return Number(value);
}

function mapRow(row: RuntimeMetricRow): RuntimeMetricSample {
  return {
    sampledAt: row.sampledAt,
    projectId: row.projectId,
    processInstance: row.processInstance,
    pid: row.pid,
    releaseId: row.releaseId,
    nodeVersion: row.nodeVersion,
    allocator: row.allocator,
    optimizeForSize: row.optimizeForSize,
    uptimeSeconds: toNumber(row.uptimeSeconds),
    rssBytes: toNumber(row.rssBytes),
    heapUsedBytes: toNumber(row.heapUsedBytes),
    heapTotalBytes: toNumber(row.heapTotalBytes),
    heapLimitBytes: toNumber(row.heapLimitBytes),
    externalBytes: toNumber(row.externalBytes),
    arrayBuffersBytes: toNumber(row.arrayBuffersBytes),
    cpuUserMicros: toNumber(row.cpuUserMicros),
    cpuSystemMicros: toNumber(row.cpuSystemMicros),
    cpuPercent: toNumber(row.cpuPercent),
    eventLoopUtilization: toNumber(row.eventLoopUtilization),
    eventLoopDelayP50Ms: toNumber(row.eventLoopDelayP50Ms),
    eventLoopDelayP95Ms: toNumber(row.eventLoopDelayP95Ms),
    eventLoopDelayP99Ms: toNumber(row.eventLoopDelayP99Ms),
    systemTotalMemBytes: toNumber(row.systemTotalMemBytes),
    systemFreeMemBytes: toNumber(row.systemFreeMemBytes),
    systemLoadAvg1m: toNumber(row.systemLoadAvg1m),
    systemLoadAvg5m: toNumber(row.systemLoadAvg5m),
    systemLoadAvg15m: toNumber(row.systemLoadAvg15m),
  };
}

async function ensureCompression(client: PoolClient): Promise<void> {
  try {
    await client.query(
      `ALTER TABLE ${TABLE_NAME} SET (
         timescaledb.compress,
         timescaledb.compress_segmentby = 'project_id,process_instance',
         timescaledb.compress_orderby = 'sampled_at DESC'
       )`,
    );
    await client.query(
      `SELECT add_compression_policy(
         '${TABLE_NAME}',
         INTERVAL '1 day',
         if_not_exists => TRUE
       )`,
    );
  } catch (error) {
    console.warn(
      '[runtimeMetrics] TimescaleDB compression is unavailable; retention and collection remain active:',
      error instanceof Error ? error.message : error,
    );
  }
}

export class RuntimeMetricsPostgres {
  public constructor(private readonly env: AppEnv = readAppEnv()) {}

  public async ensureStorage(): Promise<void> {
    if (this.env.runtimeMode !== 'postgres') {
      return;
    }

    const pool = getSharedPgPool(this.env);
    const client = await pool.connect();
    let locked = false;
    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [STORAGE_LOCK_NAME]);
      locked = true;
      const extension = await client.query(
        "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'",
      );
      if (extension.rowCount === 0) {
        throw new Error('TimescaleDB extension is not enabled in the runtime database');
      }

      await client.query('CREATE SCHEMA IF NOT EXISTS collab_monitor');
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          sampled_at TIMESTAMPTZ NOT NULL,
          project_id TEXT NOT NULL,
          process_instance TEXT NOT NULL,
          pid INTEGER NOT NULL,
          release_id TEXT NULL,
          node_version TEXT NOT NULL,
          allocator TEXT NOT NULL,
          optimize_for_size BOOLEAN NOT NULL,
          uptime_seconds DOUBLE PRECISION NOT NULL,
          rss_bytes BIGINT NOT NULL,
          heap_used_bytes BIGINT NOT NULL,
          heap_total_bytes BIGINT NOT NULL,
          heap_limit_bytes BIGINT NOT NULL,
          external_bytes BIGINT NOT NULL,
          array_buffers_bytes BIGINT NOT NULL,
          cpu_user_micros BIGINT NOT NULL,
          cpu_system_micros BIGINT NOT NULL,
          cpu_percent DOUBLE PRECISION NOT NULL,
          event_loop_utilization DOUBLE PRECISION NOT NULL,
          event_loop_delay_p50_ms DOUBLE PRECISION NOT NULL,
          event_loop_delay_p95_ms DOUBLE PRECISION NOT NULL,
          event_loop_delay_p99_ms DOUBLE PRECISION NOT NULL,
          system_total_mem_bytes BIGINT NOT NULL,
          system_free_mem_bytes BIGINT NOT NULL,
          system_load_avg_1m DOUBLE PRECISION NOT NULL,
          system_load_avg_5m DOUBLE PRECISION NOT NULL,
          system_load_avg_15m DOUBLE PRECISION NOT NULL,
          PRIMARY KEY (sampled_at, project_id, process_instance)
        )`,
      );
      await client.query(
        `SELECT create_hypertable(
           '${TABLE_NAME}',
           'sampled_at',
           chunk_time_interval => INTERVAL '1 day',
           if_not_exists => TRUE
         )`,
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_runtime_process_sample_project_time
         ON ${TABLE_NAME} (project_id, sampled_at DESC)`,
      );
      await client.query(
        `SELECT add_retention_policy(
           '${TABLE_NAME}',
           INTERVAL '${RUNTIME_METRICS_RETENTION_DAYS} days',
           if_not_exists => TRUE
         )`,
      );
      await ensureCompression(client);
    } finally {
      try {
        if (locked) {
          await client.query('SELECT pg_advisory_unlock(hashtext($1))', [STORAGE_LOCK_NAME]);
        }
      } finally {
        client.release();
      }
    }
  }

  public async insert(sample: RuntimeMetricSample): Promise<void> {
    if (this.env.runtimeMode !== 'postgres') {
      return;
    }

    await getSharedPgPool(this.env).query(
      `INSERT INTO ${TABLE_NAME} (
        sampled_at, project_id, process_instance, pid, release_id, node_version,
        allocator, optimize_for_size, uptime_seconds, rss_bytes, heap_used_bytes,
        heap_total_bytes, heap_limit_bytes, external_bytes, array_buffers_bytes,
        cpu_user_micros, cpu_system_micros, cpu_percent, event_loop_utilization,
        event_loop_delay_p50_ms, event_loop_delay_p95_ms, event_loop_delay_p99_ms,
        system_total_mem_bytes, system_free_mem_bytes, system_load_avg_1m,
        system_load_avg_5m, system_load_avg_15m
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27
      )`,
      [
        sample.sampledAt,
        sample.projectId,
        sample.processInstance,
        sample.pid,
        sample.releaseId,
        sample.nodeVersion,
        sample.allocator,
        sample.optimizeForSize,
        sample.uptimeSeconds,
        sample.rssBytes,
        sample.heapUsedBytes,
        sample.heapTotalBytes,
        sample.heapLimitBytes,
        sample.externalBytes,
        sample.arrayBuffersBytes,
        sample.cpuUserMicros,
        sample.cpuSystemMicros,
        sample.cpuPercent,
        sample.eventLoopUtilization,
        sample.eventLoopDelayP50Ms,
        sample.eventLoopDelayP95Ms,
        sample.eventLoopDelayP99Ms,
        sample.systemTotalMemBytes,
        sample.systemFreeMemBytes,
        sample.systemLoadAvg1m,
        sample.systemLoadAvg5m,
        sample.systemLoadAvg15m,
      ],
    );
  }

  public async list(input: {
    projectId: string;
    minutes: number;
    limit: number;
  }): Promise<RuntimeMetricSample[]> {
    if (this.env.runtimeMode !== 'postgres') {
      return [];
    }

    const rows = await queryRows<RuntimeMetricRow>(
      getSharedPgPool(this.env),
      `SELECT
         sampled_at AS "sampledAt",
         project_id AS "projectId",
         process_instance AS "processInstance",
         pid,
         release_id AS "releaseId",
         node_version AS "nodeVersion",
         allocator,
         optimize_for_size AS "optimizeForSize",
         uptime_seconds AS "uptimeSeconds",
         rss_bytes AS "rssBytes",
         heap_used_bytes AS "heapUsedBytes",
         heap_total_bytes AS "heapTotalBytes",
         heap_limit_bytes AS "heapLimitBytes",
         external_bytes AS "externalBytes",
         array_buffers_bytes AS "arrayBuffersBytes",
         cpu_user_micros AS "cpuUserMicros",
         cpu_system_micros AS "cpuSystemMicros",
         cpu_percent AS "cpuPercent",
         event_loop_utilization AS "eventLoopUtilization",
         event_loop_delay_p50_ms AS "eventLoopDelayP50Ms",
         event_loop_delay_p95_ms AS "eventLoopDelayP95Ms",
         event_loop_delay_p99_ms AS "eventLoopDelayP99Ms",
         system_total_mem_bytes AS "systemTotalMemBytes",
         system_free_mem_bytes AS "systemFreeMemBytes",
         system_load_avg_1m AS "systemLoadAvg1m",
         system_load_avg_5m AS "systemLoadAvg5m",
         system_load_avg_15m AS "systemLoadAvg15m"
       FROM ${TABLE_NAME}
       WHERE project_id = $1
         AND sampled_at >= NOW() - ($2::double precision * INTERVAL '1 minute')
       ORDER BY sampled_at DESC
       LIMIT $3`,
      [input.projectId, input.minutes, input.limit],
    );

    return rows.map(mapRow).reverse();
  }
}
