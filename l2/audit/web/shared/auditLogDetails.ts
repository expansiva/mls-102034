/// <mls fileReference="_102034_/l2/audit/web/shared/auditLogDetails.ts" enhancement="_blank" />
import type { BffClientOptions } from '/_102029_/l2/bffClient.js';
import type {
  AuditLogDetailsParams,
  AuditLogDetailsResponse,
} from '/_102034_/l2/audit/shared/contracts/audit-log.js';
import { execBff } from '/_102029_/l2/bffClient.js';

export async function loadAuditLogDetails(input: AuditLogDetailsParams, options?: BffClientOptions) {
  return execBff<AuditLogDetailsResponse>('audit.auditLog.details', input, options);
}
