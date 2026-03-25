/// <mls fileReference="_102034_/l2/monitor/web/shared/dynamodb.ts" enhancement="_blank" />
import type { BffClientOptions } from '/_102029_/l2/bffClient.js';
import type { MonitorDynamoResponse } from '/_102034_/l2/monitor/shared/contracts/dynamodb.js';
import { execBff } from '/_102029_/l2/bffClient.js';

export async function loadMonitorDynamodb(options?: BffClientOptions) {
  return execBff<MonitorDynamoResponse>('monitor.dynamodb.load', {}, options);
}
