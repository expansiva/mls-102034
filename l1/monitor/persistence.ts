/// <mls fileReference="_102034_/l1/monitor/persistence.ts" enhancement="_blank" />
import type { TableDefinition, ViewDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';

export const tableDefinitions: TableDefinition[] = [
  {
    moduleId: 'monitor',
    repositoryName: 'monitorBffExecutionLog',
    tableName: 'monitor_bff_execution_log',
    purpose: 'controle',
    description: 'BFF execution log — hypertable partitioned by finishedAt.',
    backupHot: false,
    storageProfile: 'postgres',
    writeMode: 'sync',
    columns: [
      { name: 'id', postgresType: 'TEXT' },
      { name: 'requestId', postgresType: 'TEXT' },
      { name: 'traceId', postgresType: 'TEXT' },
      { name: 'userId', postgresType: 'TEXT' },
      { name: 'routine', postgresType: 'TEXT' },
      { name: 'module', postgresType: 'TEXT' },
      { name: 'pageName', postgresType: 'TEXT' },
      { name: 'command', postgresType: 'TEXT' },
      { name: 'source', postgresType: 'TEXT' },
      { name: 'statusCode', postgresType: 'INTEGER' },
      { name: 'statusGroup', postgresType: 'TEXT' },
      { name: 'ok', postgresType: 'BOOLEAN' },
      { name: 'durationMs', postgresType: 'INTEGER' },
      { name: 'errorCode', postgresType: 'TEXT', nullable: true },
      { name: 'errorStack', postgresType: 'TEXT', nullable: true },
      { name: 'startedAt', postgresType: 'TIMESTAMPTZ' },
      { name: 'finishedAt', postgresType: 'TIMESTAMPTZ' },
    ],
    primaryKey: ['id', 'finishedAt'],
    indexes: [
      { name: 'idx_monitor_bff_log_request', columns: ['requestId'] },
      { name: 'idx_monitor_bff_log_trace', columns: ['traceId'] },
      { name: 'idx_monitor_bff_log_user', columns: ['userId'] },
      { name: 'idx_monitor_bff_log_routine', columns: ['routine'] },
      { name: 'idx_monitor_bff_log_module', columns: ['module'] },
      { name: 'idx_monitor_bff_log_status_group', columns: ['statusGroup'] },
      { name: 'idx_monitor_bff_log_finished_at', columns: ['finishedAt'] },
    ],
    timescale: {
      hypertable: {
        timeColumn: 'finishedAt',
        chunkTimeInterval: '1 day',
      },
    },
    version: 2,
  },
  {
    moduleId: 'monitor',
    repositoryName: 'monitorClientTelemetryEvent',
    tableName: 'monitor_client_telemetry_event',
    purpose: 'controle',
    description: 'Frontend telemetry events piggybacked on BFF requests — hypertable partitioned by recordedAt.',
    backupHot: false,
    storageProfile: 'postgres',
    writeMode: 'sync',
    columns: [
      { name: 'id', postgresType: 'TEXT' },
      { name: 'requestId', postgresType: 'TEXT' },
      { name: 'traceId', postgresType: 'TEXT' },
      { name: 'userId', postgresType: 'TEXT' },
      { name: 'module', postgresType: 'TEXT' },
      { name: 'routine', postgresType: 'TEXT' },
      { name: 'eventType', postgresType: 'TEXT' },
      { name: 'label', postgresType: 'TEXT', nullable: true },
      { name: 'durationMs', postgresType: 'INTEGER', nullable: true },
      { name: 'metadata', postgresType: 'JSONB', nullable: true },
      { name: 'recordedAt', postgresType: 'TIMESTAMPTZ' },
      { name: 'receivedAt', postgresType: 'TIMESTAMPTZ' },
    ],
    primaryKey: ['id', 'recordedAt'],
    indexes: [
      { name: 'idx_monitor_telemetry_request', columns: ['requestId'] },
      { name: 'idx_monitor_telemetry_user', columns: ['userId'] },
      { name: 'idx_monitor_telemetry_event_type', columns: ['eventType'] },
      { name: 'idx_monitor_telemetry_recorded_at', columns: ['recordedAt'] },
    ],
    timescale: {
      hypertable: {
        timeColumn: 'recordedAt',
        chunkTimeInterval: '1 day',
      },
    },
    version: 1,
  },
];

export const viewDefinitions: ViewDefinition[] = [
  {
    moduleId: 'monitor',
    viewName: 'monitor_bff_execution_agg_minute',
    statements: [
      `CREATE MATERIALIZED VIEW monitor_bff_execution_agg_minute
       WITH (timescaledb.continuous) AS
       SELECT
         time_bucket('1 minute', "finishedAt") AS "bucketStart",
         "routine", "module", "pageName", "command", "source",
         "statusCode", "statusGroup",
         count(*)                                                   AS "totalCount",
         count(*) FILTER (WHERE "statusGroup" = 'success')         AS "successCount",
         count(*) FILTER (WHERE "statusGroup" = 'client_error')    AS "clientErrorCount",
         count(*) FILTER (WHERE "statusGroup" = 'server_error')    AS "serverErrorCount",
         count(*) FILTER (WHERE "statusGroup" = 'not_found')       AS "notFoundCount",
         sum("durationMs")                                          AS "totalDurationMs"
       FROM monitor_bff_execution_log
       GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
       WITH NO DATA`,
      `SELECT add_continuous_aggregate_policy('monitor_bff_execution_agg_minute',
         start_offset     => INTERVAL '2 minutes',
         end_offset       => INTERVAL '10 seconds',
         schedule_interval => INTERVAL '30 seconds')`,
      `SELECT add_retention_policy('monitor_bff_execution_log', INTERVAL '90 days')`,
    ],
  },
];
