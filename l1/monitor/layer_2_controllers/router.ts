/// <mls fileReference="_102034_/l1/monitor/layer_2_controllers/router.ts" enhancement="_blank" />
import { ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  monitorArchitectureLoadHandler,
  monitorDynamodbLoadHandler,
  monitorDynamodbTableDetailsHandler,
  monitorDynamodbTableInspectHandler,
  monitorHomeLoadHandler,
  monitorPostgresLoadHandler,
  monitorPostgresTableDetailsHandler,
  monitorPostgresTableInspectHandler,
  monitorGetStatisticsSeriesHandler,
  monitorGetStatisticsSnapshotHandler,
} from '/_102034_/l1/monitor/layer_2_controllers/monitorGetStatistics.js';
import { monitorAbendLoadHandler } from '/_102034_/l1/monitor/layer_2_controllers/abendHandlers.js';
import { monitorProcessLoadHandler } from '/_102034_/l1/monitor/layer_2_controllers/processHealthHandlers.js';
import { monitorRequestTraceLoadHandler } from '/_102034_/l1/monitor/layer_2_controllers/traceHandlers.js';

export function createMonitorRouter(): Map<string, BffHandler> {
  return new Map<string, BffHandler>([
    ['monitor.home.load', monitorHomeLoadHandler],
    ['monitor.architecture.load', monitorArchitectureLoadHandler],
    ['monitor.postgres.load', monitorPostgresLoadHandler],
    ['monitor.dynamodb.load', monitorDynamodbLoadHandler],
    ['monitor.postgresTable.inspect', monitorPostgresTableInspectHandler],
    ['monitor.postgresTable.details', monitorPostgresTableDetailsHandler],
    ['monitor.dynamodbTable.inspect', monitorDynamodbTableInspectHandler],
    ['monitor.dynamodbTable.details', monitorDynamodbTableDetailsHandler],
    ['monitor.monitorGetStatistics.getSnapshot', monitorGetStatisticsSnapshotHandler],
    ['monitor.monitorGetStatistics.getSeries', monitorGetStatisticsSeriesHandler],
    ['monitor.abend.load', monitorAbendLoadHandler],
    ['monitor.process.load', monitorProcessLoadHandler],
    ['monitor.requestTrace.load', monitorRequestTraceLoadHandler],
    ['monitor.telemetry.flush', async () => ok(null)],
  ]);
}
