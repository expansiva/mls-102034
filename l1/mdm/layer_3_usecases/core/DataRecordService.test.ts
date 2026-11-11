/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/core/DataRecordService.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { DataRecordService } from '/_102034_/l1/mdm/layer_3_usecases/core/DataRecordService.js';
import { mdmEntityDef } from '/_102034_/l1/mdm/layer_3_usecases/core/mdmEntityDefs.js';
import { buildEntityIndex, normalizeDetailInput } from '/_102034_/l1/mdm/layer_3_usecases/mdmSupport.js';
import { MdmDocumentEntity } from '/_102034_/l1/mdm/layer_3_usecases/internal/MdmDocumentStore.js';
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

// rt206: the memory index does not refuse a repeated mdmId, Postgres does (primary key). The wrapper gives it the
// same rule so the tests below fail the way the app failed on the lima.
function enforceIndexPrimaryKey(runtime: ReturnType<typeof createMemoryDataRuntime>) {
  const table = runtime.mdmEntityIndex;
  const insert = table.insert.bind(table);
  table.insert = async (input) => {
    if (await table.findOne({ where: { mdmId: input.record.mdmId } })) {
      throw new Error('duplicate key value violates unique constraint "mdm_documents_entities_index_pkey"');
    }
    await insert(input);
  };
}

function captureWarnings(): { lines: string[]; restore: () => void } {
  const original = console.warn;
  const lines: string[] = [];
  console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  return { lines, restore: () => { console.warn = original; } };
}

test('DataRecordService.create replaces an index row whose document is gone (the leftover of a Postgres crash)', async () => {
  const runtime = createMemoryDataRuntime();
  enforceIndexPrimaryKey(runtime);
  const ctx = createRequestContext(runtime);
  const detail = createCompanyDetail(ctx);
  // the crash emptied mdm_documents; the index kept the row
  await runtime.mdmEntityIndex.insert({ record: buildEntityIndex(detail) });
  assert.equal(await runtime.mdmDocument.get({ mdmId: detail.mdmId }), null);

  const warnings = captureWarnings();
  try {
    const result = await DataRecordService.create(ctx, mdmEntityDef, {
      after: detail,
      meta: { module: 'mdm', routine: 'mdm.entity.create' },
    });
    assert.equal(result.version, 1);
  } finally {
    warnings.restore();
  }

  assert.equal((await runtime.mdmEntityIndex.findMany({ where: { mdmId: detail.mdmId } })).length, 1);
  assert.equal((await runtime.mdmDocument.get({ mdmId: detail.mdmId }))?.version, 1);
  assert.equal(warnings.lines.filter((line) => line.includes(`orphan index row replaced ${detail.mdmId}`)).length, 1);
});

test('DataRecordService.create still refuses a real duplicate (document and index present)', async () => {
  const runtime = createMemoryDataRuntime();
  enforceIndexPrimaryKey(runtime);
  const ctx = createRequestContext(runtime);
  const detail = createCompanyDetail(ctx);
  await DataRecordService.create(ctx, mdmEntityDef, { after: detail, meta: { module: 'mdm', routine: 'mdm.entity.create' } });

  const warnings = captureWarnings();
  try {
    await assert.rejects(
      DataRecordService.create(ctx, mdmEntityDef, { after: detail, meta: { module: 'mdm', routine: 'mdm.entity.create' } }),
      /Document already exists|mdm_documents_entities_index_pkey/u, // memory refuses at the document, Postgres at the index key
    );
  } finally {
    warnings.restore();
  }
  assert.equal(warnings.lines.some((line) => line.includes('orphan index row replaced')), false, 'a real duplicate is not an orphan');
  assert.equal((await runtime.mdmEntityIndex.findMany({ where: { mdmId: detail.mdmId } })).length, 1);
});

test('DataRecordService.create writes no warning and touches no index row in the normal case', async () => {
  const runtime = createMemoryDataRuntime();
  enforceIndexPrimaryKey(runtime);
  const ctx = createRequestContext(runtime);
  const warnings = captureWarnings();
  try {
    await DataRecordService.create(ctx, mdmEntityDef, { after: createCompanyDetail(ctx), meta: { module: 'mdm', routine: 'mdm.entity.create' } });
  } finally {
    warnings.restore();
  }
  assert.equal(warnings.lines.length, 0);
});
