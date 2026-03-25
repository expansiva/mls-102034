/// <mls fileReference="_102034_/l2/monitor/web/shared/tableDetailsDynamodb.ts" enhancement="_blank" />
import type { BffClientOptions } from '/_102029_/l2/bffClient.js';
import type { MonitorDynamoTableDetailsResponse } from '/_102034_/l2/monitor/shared/contracts/table-details-dynamodb.js';
import { execBff } from '/_102029_/l2/bffClient.js';

export async function loadMonitorDynamoTableDetails(input: {
  tableName: string;
}, options?: BffClientOptions) {
  return execBff<MonitorDynamoTableDetailsResponse>('monitor.dynamodbTable.details', input, options);
}
