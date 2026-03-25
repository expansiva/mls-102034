/// <mls fileReference="_102034_/l2/monitor/web/shared/tableInspectDynamodb.ts" enhancement="_blank" />
import type { BffClientOptions } from '/_102029_/l2/bffClient.js';
import type { MonitorDynamoTableInspectResponse } from '/_102034_/l2/monitor/shared/contracts/table-inspect-dynamodb.js';
import { execBff } from '/_102029_/l2/bffClient.js';

export async function loadMonitorDynamoTableInspect(input: {
  tableName: string;
  cursor?: string;
  filters?: Record<string, string>;
}, options?: BffClientOptions) {
  return execBff<MonitorDynamoTableInspectResponse>('monitor.dynamodbTable.inspect', input, options);
}
