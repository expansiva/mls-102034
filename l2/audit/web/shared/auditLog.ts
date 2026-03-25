/// <mls fileReference="_102034_/l2/audit/web/shared/auditLog.ts" enhancement="_blank" />
import type { BffClientOptions } from '/_102029_/l2/bffClient.js';
import type { AuditLogLoadParams, AuditLogResponse } from '/_102034_/l2/audit/shared/contracts/audit-log.js';
import { execBff } from '/_102029_/l2/bffClient.js';

export async function loadAuditLog(input: AuditLogLoadParams, options?: BffClientOptions) {
  return execBff<AuditLogResponse>('audit.auditLog.load', input, options);
}
