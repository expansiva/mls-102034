/// <mls fileReference="_102034_/l1/audit/layer_2_controllers/router.ts" enhancement="_blank" />
import type { BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  auditAuditLogDetailsHandler,
  auditAuditLogLoadHandler,
  auditHomeLoadHandler,
  auditStatusHistoryLoadHandler,
} from '/_102034_/l1/audit/layer_2_controllers/auditHandlers.js';

export function createAuditRouter(): Map<string, BffHandler> {
  return new Map<string, BffHandler>([
    ['audit.home.load', auditHomeLoadHandler],
    ['audit.auditLog.load', auditAuditLogLoadHandler],
    ['audit.auditLog.details', auditAuditLogDetailsHandler],
    ['audit.statusHistory.load', auditStatusHistoryLoadHandler],
  ]);
}
