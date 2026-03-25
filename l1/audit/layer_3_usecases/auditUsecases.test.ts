/// <mls fileReference="_102034_/l1/audit/layer_3_usecases/auditUsecases.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import {
  loadAuditHome,
  loadAuditLog,
  loadAuditStatusHistory,
} from '/_102034_/l1/audit/layer_3_usecases/auditUsecases.js';

test('audit home summarizes audit and status tables', async () => {
  const runtime = createMemoryDataRuntime();
  const ctx = createRequestContext(runtime);

  await runtime.mdmAuditLog.insert({
    record: {
      id: 'audit-1',
      entityType: 'PurchaseOrder',
      entityId: 'po-1',
      action: 'update',
      actorId: 'user-1',
      actorType: 'user',
      module: 'purchasing',
      routine: 'purchaseOrder.update',
      createdAt: '2026-03-22T10:00:00.000Z',
    },
  });
  await runtime.mdmStatusHistory.insert({
    record: {
      id: 'status-1',
      entityType: 'PurchaseOrder',
      entityId: 'po-1',
      fromStatus: 'draft',
      toStatus: 'approved',
      reason: 'manager approval',
      reasonCode: 'APPROVED',
      actorId: 'user-1',
      actorType: 'user',
      module: 'purchasing',
      routine: 'purchaseOrder.approve',
      metadata: { level: 2 },
      createdAt: '2026-03-22T10:05:00.000Z',
    },
  });

  const result = await loadAuditHome(ctx);

  assert.equal(result.summary.auditLog.total, 1);
  assert.equal(result.summary.statusHistory.total, 1);
  assert.equal(result.distribution.byModule[0]?.label, 'purchasing');
});

test('audit log filters and paginates records', async () => {
  const runtime = createMemoryDataRuntime();
  const ctx = createRequestContext(runtime);

  await runtime.mdmAuditLog.insert({
    record: {
      id: 'audit-1',
      entityType: 'PurchaseOrder',
      entityId: 'po-1',
      action: 'create',
      actorId: 'user-1',
      actorType: 'user',
      module: 'purchasing',
      routine: 'purchaseOrder.create',
      createdAt: '2026-03-22T09:00:00.000Z',
    },
  });
  await runtime.mdmAuditLog.insert({
    record: {
      id: 'audit-2',
      entityType: 'PurchaseOrder',
      entityId: 'po-2',
      action: 'update',
      actorId: 'user-2',
      actorType: 'user',
      module: 'sales',
      routine: 'order.update',
      createdAt: '2026-03-22T11:00:00.000Z',
    },
  });

  const result = await loadAuditLog(ctx, {
    module: 'sales',
    page: 1,
    pageSize: 10,
  });

  assert.equal(result.summary.total, 1);
  assert.equal(result.events[0]?.id, 'audit-2');
  assert.equal(result.groups.byAction[0]?.label, 'update');
});

test('status history groups transitions and current statuses', async () => {
  const runtime = createMemoryDataRuntime();
  const ctx = createRequestContext(runtime);

  await runtime.mdmStatusHistory.insert({
    record: {
      id: 'status-1',
      entityType: 'Invoice',
      entityId: 'inv-1',
      fromStatus: null,
      toStatus: 'draft',
      reason: null,
      reasonCode: null,
      actorId: 'user-1',
      actorType: 'user',
      module: 'fiscal',
      routine: 'invoice.create',
      metadata: null,
      createdAt: '2026-03-22T08:00:00.000Z',
    },
  });
  await runtime.mdmStatusHistory.insert({
    record: {
      id: 'status-2',
      entityType: 'Invoice',
      entityId: 'inv-1',
      fromStatus: 'draft',
      toStatus: 'approved',
      reason: 'validated',
      reasonCode: 'VALID',
      actorId: 'user-2',
      actorType: 'user',
      module: 'fiscal',
      routine: 'invoice.approve',
      metadata: { reviewed: true },
      createdAt: '2026-03-22T09:00:00.000Z',
    },
  });

  const result = await loadAuditStatusHistory(ctx, {
    entityType: 'Invoice',
  });

  assert.equal(result.summary.total, 2);
  assert.equal(result.groups.byTransition[0]?.label, 'draft -> approved');
  assert.equal(result.groups.currentStatuses[0]?.label, 'approved');
});
