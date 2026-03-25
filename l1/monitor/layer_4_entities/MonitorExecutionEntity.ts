/// <mls fileReference="_102034_/l1/monitor/layer_4_entities/MonitorExecutionEntity.ts" enhancement="_blank" />
import type { MonitorExecutionEvent } from '/_102034_/l1/monitor/module.js';
import { MonitorRuntimePostgres } from '/_102034_/l1/monitor/layer_1_external/data/postgres/MonitorRuntimePostgres.js';
import { getSharedBffExecutionSeriesStore } from '/_102034_/l1/monitor/layer_1_external/cache/BffExecutionSeriesStore.js';

export class MonitorExecutionEntity {
  public static async record(event: MonitorExecutionEvent): Promise<void> {
    getSharedBffExecutionSeriesStore().record(event);
    try {
      await new MonitorRuntimePostgres().recordExecution(event);
    } catch (error) {
      if (MonitorRuntimePostgres.isMissingMonitorStorageError(error)) {
        return;
      }
      throw error;
    }
  }
}
