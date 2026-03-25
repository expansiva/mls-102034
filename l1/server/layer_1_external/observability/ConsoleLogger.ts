/// <mls fileReference="_102034_/l1/server/layer_1_external/observability/ConsoleLogger.ts" enhancement="_blank" />
import type { ILogger } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

export class ConsoleLogger implements ILogger {
  public info(message: string, data?: unknown): void {
    console.info(message, data ?? '');
  }

  public error(message: string, data?: unknown): void {
    console.error(message, data ?? '');
  }
}
