/// <mls fileReference="_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import type { MdmEntityIndexRecord } from '/_102034_/l1/mdm/module.js';

function buildIndexRecord(input: {
  mdmId: string;
  subtype: MdmEntityIndexRecord['subtype'];
  name: string;
  status: MdmEntityIndexRecord['status'];
  docType?: MdmEntityIndexRecord['docType'];
  docId?: string | null;
  countryCode: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}): MdmEntityIndexRecord {
  return {
    mdmId: input.mdmId,
    subtype: input.subtype,
    name: input.name,
    status: input.status,
    docType: input.docType ?? null,
    docId: input.docId ?? null,
    countryCode: input.countryCode,
    tags: input.tags,
    searchVector: [input.name, input.docId, ...input.tags].filter(Boolean).join(' ').toLowerCase(),
    mergedInto: null,
    dynamoPk: input.mdmId,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

test('memory index runtime supports querying indexed columns across 10 records', async () => {
  const runtime = createMemoryDataRuntime();

  const records: MdmEntityIndexRecord[] = [
    buildIndexRecord({ mdmId: 'id-001', subtype: 'Person', name: 'Alice Johnson', status: 'Active', docType: 'SSN', docId: '111111111', countryCode: 'US', tags: ['vip', 'north'], createdAt: '2026-03-18T10:00:01.000Z', updatedAt: '2026-03-18T10:10:01.000Z' }),
    buildIndexRecord({ mdmId: 'id-002', subtype: 'Person', name: 'Bruno Lima', status: 'Inactive', docType: 'CPF', docId: '22222222222', countryCode: 'BR', tags: ['south'], createdAt: '2026-03-18T10:00:02.000Z', updatedAt: '2026-03-18T10:10:02.000Z' }),
    buildIndexRecord({ mdmId: 'id-003', subtype: 'Company', name: 'Cobalt Labs', status: 'Active', docType: 'EIN', docId: '333333333', countryCode: 'US', tags: ['lab', 'innovation'], createdAt: '2026-03-18T10:00:03.000Z', updatedAt: '2026-03-18T10:10:03.000Z' }),
    buildIndexRecord({ mdmId: 'id-004', subtype: 'Company', name: 'Delta Motors', status: 'Blocked', docType: 'CNPJ', docId: '44444444000144', countryCode: 'BR', tags: ['fleet'], createdAt: '2026-03-18T10:00:04.000Z', updatedAt: '2026-03-18T10:10:04.000Z' }),
    buildIndexRecord({ mdmId: 'id-005', subtype: 'ContactChannel', name: 'Email Support', status: 'Active', countryCode: 'US', tags: ['support'], createdAt: '2026-03-18T10:00:05.000Z', updatedAt: '2026-03-18T10:10:05.000Z' }),
    buildIndexRecord({ mdmId: 'id-006', subtype: 'Document', name: 'Employment Contract', status: 'Active', countryCode: 'US', tags: ['legal'], createdAt: '2026-03-18T10:00:06.000Z', updatedAt: '2026-03-18T10:10:06.000Z' }),
    buildIndexRecord({ mdmId: 'id-007', subtype: 'BankAccount', name: 'Primary Checking', status: 'Active', countryCode: 'US', tags: ['finance'], createdAt: '2026-03-18T10:00:07.000Z', updatedAt: '2026-03-18T10:10:07.000Z' }),
    buildIndexRecord({ mdmId: 'id-008', subtype: 'AssetVehicle', name: 'Truck 8', status: 'Inactive', countryCode: 'US', tags: ['fleet'], createdAt: '2026-03-18T10:00:08.000Z', updatedAt: '2026-03-18T10:10:08.000Z' }),
    buildIndexRecord({ mdmId: 'id-009', subtype: 'AssetProperty', name: 'Warehouse 9', status: 'Merged', countryCode: 'US', tags: ['warehouse'], createdAt: '2026-03-18T10:00:09.000Z', updatedAt: '2026-03-18T10:10:09.000Z' }),
    buildIndexRecord({ mdmId: 'id-010', subtype: 'Animal', name: 'Canine Unit', status: 'Active', countryCode: 'US', tags: ['field'], createdAt: '2026-03-18T10:00:10.000Z', updatedAt: '2026-03-18T10:10:10.000Z' }),
  ];

  for (const record of records) {
    await runtime.mdmEntityIndex.insert({ record });
  }

  const byMdmId = await runtime.mdmEntityIndex.findOne({ where: { mdmId: 'id-003' } });
  const bySubtype = await runtime.mdmEntityIndex.findMany({ where: { subtype: 'Company' } });
  const byName = await runtime.mdmEntityIndex.findMany({ where: { name: 'Delta Motors' } });
  const byStatus = await runtime.mdmEntityIndex.findMany({ where: { status: 'Active' } });
  const byDocType = await runtime.mdmEntityIndex.findMany({ where: { docType: 'CPF' } });
  const byDocId = await runtime.mdmEntityIndex.findMany({ where: { docId: '44444444000144' } });
  const byCountryCode = await runtime.mdmEntityIndex.findMany({ where: { countryCode: 'BR' } });
  const byDynamoPk = await runtime.mdmEntityIndex.findMany({ where: { dynamoPk: 'id-007' } });
  const byCreatedAt = await runtime.mdmEntityIndex.findMany({ where: { createdAt: '2026-03-18T10:00:08.000Z' } });
  const byUpdatedAt = await runtime.mdmEntityIndex.findMany({ where: { updatedAt: '2026-03-18T10:10:10.000Z' } });
  const ordered = await runtime.mdmEntityIndex.findMany({ orderBy: { field: 'name', direction: 'asc' }, limit: 3 });
  const byManyIds = await runtime.mdmEntityIndex.findManyByValues({
    field: 'mdmId',
    values: ['id-002', 'id-004', 'id-010'],
  });

  assert.equal(byMdmId?.name, 'Cobalt Labs');
  assert.deepEqual(bySubtype.map((item) => item.mdmId), ['id-003', 'id-004']);
  assert.deepEqual(byName.map((item) => item.mdmId), ['id-004']);
  assert.equal(byStatus.length, 6);
  assert.deepEqual(byDocType.map((item) => item.mdmId), ['id-002']);
  assert.deepEqual(byDocId.map((item) => item.mdmId), ['id-004']);
  assert.deepEqual(byCountryCode.map((item) => item.mdmId), ['id-002', 'id-004']);
  assert.deepEqual(byDynamoPk.map((item) => item.mdmId), ['id-007']);
  assert.deepEqual(byCreatedAt.map((item) => item.mdmId), ['id-008']);
  assert.deepEqual(byUpdatedAt.map((item) => item.mdmId), ['id-010']);
  assert.deepEqual(ordered.map((item) => item.name), ['Alice Johnson', 'Bruno Lima', 'Canine Unit']);
  assert.deepEqual(byManyIds.map((item) => item.mdmId), ['id-002', 'id-004', 'id-010']);
});
