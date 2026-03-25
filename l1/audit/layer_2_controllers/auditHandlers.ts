/// <mls fileReference="_102034_/l1/audit/layer_2_controllers/auditHandlers.ts" enhancement="_blank" />
import { ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  loadAuditHome,
  loadAuditLog,
  loadAuditLogDetails,
  loadAuditStatusHistory,
} from '/_102034_/l1/audit/layer_3_usecases/auditUsecases.js';
import type {
  AuditLogDetailsParams,
  AuditLogLoadParams,
  AuditStatusHistoryLoadParams,
} from '/_102034_/l1/audit/module.js';

export const auditHomeLoadHandler: BffHandler = async ({ ctx }) =>
  ok(await loadAuditHome(ctx));

export const auditAuditLogLoadHandler: BffHandler = async ({ ctx, request }) =>
  ok(await loadAuditLog(ctx, request.params as AuditLogLoadParams));

export const auditAuditLogDetailsHandler: BffHandler = async ({ ctx, request }) =>
  ok(await loadAuditLogDetails(ctx, request.params as AuditLogDetailsParams));

export const auditStatusHistoryLoadHandler: BffHandler = async ({ ctx, request }) =>
  ok(await loadAuditStatusHistory(ctx, request.params as AuditStatusHistoryLoadParams));
