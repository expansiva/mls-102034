/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/core/DataRecordService.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { DataRecordService } from '/_102034_/l1/mdm/layer_3_usecases/core/DataRecordService.js';
import { mdmEntityDef } from '/_102034_/l1/mdm/layer_3_usecases/core/mdmEntityDefs.js';
import { normalizeDetailInput } from '/_102034_/l1/mdm/layer_3_usecases/mdmSupport.js';
import { MdmDocumentEntity } from '/_102034_/l1/mdm/layer_4_entities/MdmDocumentEntity.js';
import type { MdmDetailRecord } from '/_102034_/l1/mdm/module.js';

function createCompanyDetail(ctx: ReturnType<typeof createRequestContext>, overrides: Record<string, unknown> = {}): MdmDetailRecord {
  return normalizeDetailInput(
    {
      subtype: 'Company',
      name: 'Acme Core',
      status: 'Active',
      legalName: 'Acme Core LLC',
      countryCode: 'US',
      docType: 'EIN',
      docId: '12-3456789',
      ...overrides,
    },
    ctx,
    ctx.idGenerator.newId(),
  );
}

test('DataRecordService.create writes audit and monitoring records', async () => {
  const runtime = createMemoryDataRuntime();
  const ctx = createRequestContext(runtime);
  const detail = createCompanyDetail(ctx);

  const result = await DataRecordService.create(ctx, mdmEntityDef, {
    after: detail,
    meta: {
      module: 'mdm',
      routine: 'mdm.entity.create',
    },
  });

  assert.equal(result.version, 1);
  assert.equal(result.after.mdmId, detail.mdmId);

  const auditRows = await runtime.mdmAuditLog.findMany();
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0]?.action, 'create');
  assert.equal(auditRows[0]?.entityId, detail.mdmId);

  const monitorRows = await runtime.mdmMonitoringWrite.findMany();
  assert.equal(monitorRows.length, 1);
  assert.equal(monitorRows[0]?.success, true);
  assert.equal(monitorRows[0]?.action, 'create');
});

test('DataRecordService.update uses provided before and records audit diff', async () => {
  const runtime = createMemoryDataRuntime();
  const ctx = createRequestContext(runtime);
  const detail = createCompanyDetail(ctx, { name: 'Acme Before', legalName: 'Acme Before LLC' });

  const created = await DataRecordService.create(ctx, mdmEntityDef, {
    after: detail,
    meta: {
      module: 'mdm',
      routine: 'mdm.entity.create',
    },
  });

  runtime.mdmDocument.get = async () => {
    throw new Error('update should not reload the document');
  };

  const beforeDocument = mdmEntityDef.toDocument(created.after, created.version);
  const updated = await DataRecordService.update(ctx, mdmEntityDef, {
    id: detail.mdmId,
    before: beforeDocument,
    expectedVersion: 1,
    patch: {
      name: 'Acme After',
      legalName: 'Acme After LLC',
    },
    applyPatch(before, patch) {
      return {
        ...before,
        ...patch,
        updatedAt: ctx.clock.nowIso(),
      };
    },
    meta: {
      module: 'mdm',
      routine: 'mdm.entity.update',
    },
  });

  assert.equal(updated.version, 2);
  assert.equal(updated.after.name, 'Acme After');

  const stored = await runtime.mdmDocument.getMany({ mdmIds: [detail.mdmId] });
  const parsed = MdmDocumentEntity.parseDetails(stored[0]!);
  assert.equal(parsed.name, 'Acme After');

  const auditRows = await runtime.mdmAuditLog.findMany({
    where: { entityId: detail.mdmId, action: 'update' },
  });
  assert.equal(auditRows.length, 1);

  const outboxRows = await runtime.mdmOutbox.findMany({
    where: { aggregateType: 'MdmAuditLog' },
  });
  assert.equal(outboxRows.length, 2);
});

test('DataRecordService.update records monitor failure and error log on conflict', async () => {
  const runtime = createMemoryDataRuntime();
  const ctx = createRequestContext(runtime);
  const detail = createCompanyDetail(ctx, { name: 'Acme Conflict', legalName: 'Acme Conflict LLC' });

  const created = await DataRecordService.create(ctx, mdmEntityDef, {
    after: detail,
    meta: {
      module: 'mdm',
      routine: 'mdm.entity.create',
    },
  });

  const beforeDocument = mdmEntityDef.toDocument(created.after, created.version);
  await assert.rejects(
    () =>
      DataRecordService.update(ctx, mdmEntityDef, {
        id: detail.mdmId,
        before: beforeDocument,
        expectedVersion: 99,
        after: {
          ...created.after,
          name: 'Acme Conflict After',
          updatedAt: ctx.clock.nowIso(),
        },
        meta: {
          module: 'mdm',
          routine: 'mdm.entity.update',
        },
      }),
    /Version mismatch/,
  );

  const errorRows = await runtime.mdmErrorLog.findMany();
  assert.equal(errorRows.length, 1);
  assert.equal(errorRows[0]?.errorCode, 'CONCURRENCY_CONFLICT');

  const monitorRows = await runtime.mdmMonitoringWrite.findMany({
    where: { action: 'update', success: false },
  });
  assert.equal(monitorRows.length, 1);
  assert.equal(monitorRows[0]?.errorCode, 'CONCURRENCY_CONFLICT');
});
