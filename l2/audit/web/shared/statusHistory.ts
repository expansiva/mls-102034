/// <mls fileReference="_102034_/l2/audit/web/shared/statusHistory.ts" enhancement="_blank" />
import type { BffClientOptions } from '/_102029_/l2/bffClient.js';
import type {
  AuditStatusHistoryLoadParams,
  AuditStatusHistoryResponse,
} from '/_102034_/l2/audit/shared/contracts/status-history.js';
import { execBff } from '/_102029_/l2/bffClient.js';

export async function loadAuditStatusHistory(input: AuditStatusHistoryLoadParams, options?: BffClientOptions) {
  return execBff<AuditStatusHistoryResponse>('audit.statusHistory.load', input, options);
}
