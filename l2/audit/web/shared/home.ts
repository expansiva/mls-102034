/// <mls fileReference="_102034_/l2/audit/web/shared/home.ts" enhancement="_blank" />
import type { BffClientOptions } from '/_102029_/l2/bffClient.js';
import type { AuditHomeResponse } from '/_102034_/l2/audit/shared/contracts/home.js';
import { execBff } from '/_102029_/l2/bffClient.js';

export async function loadAuditHome(options?: BffClientOptions) {
  return execBff<AuditHomeResponse>('audit.home.load', {}, options);
}
