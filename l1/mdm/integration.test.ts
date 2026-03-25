/// <mls fileReference="_102034_/l1/mdm/integration.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import type { CompanyKind, ServiceKind } from '/_102034_/l1/mdm/integration.js';
import {
  toMdmLookupResult,
  toMdmRelationshipSummary,
} from '/_102034_/l1/mdm/integration.js';

test('mdm integration contract maps lookup results with company and service kinds', () => {
  const companyKind: CompanyKind = 'Branch';
  const serviceKind: ServiceKind = 'Cohort';

  const company = toMdmLookupResult({
    mdmId: 'company-1',
    subtype: 'Company',
    name: 'Branch 1',
    status: 'Active',
    docType: null,
    docId: null,
    countryCode: 'US',
    tags: [],
    aliases: [],
    contacts: [],
    relationshipRefs: {},
    addresses: [],
    createdAt: '2026-03-19T10:00:00.000Z',
    updatedAt: '2026-03-19T10:00:00.000Z',
    legalName: 'Branch 1 LLC',
    companyKind,
    parentCompanyId: 'company-root',
    externalCode: 'BR-1',
    compras: {
      supplierRank: 'gold',
    },
  });

  const cohort = toMdmLookupResult({
    mdmId: 'service-1',
    subtype: 'Service',
    name: 'Engineering 1 - 2026',
    status: 'Active',
    docType: null,
    docId: null,
    countryCode: 'US',
    tags: [],
    aliases: [],
    contacts: [],
    relationshipRefs: {},
    addresses: [],
    createdAt: '2026-03-19T10:00:00.000Z',
    updatedAt: '2026-03-19T10:00:00.000Z',
    serviceKind,
    parentServiceId: 'service-root',
  });

  assert.equal(company.companyKind, 'Branch');
  assert.equal(company.parentCompanyId, 'company-root');
  assert.equal(company.moduleNamespaces?.compras?.supplierRank, 'gold');
  assert.equal(cohort.serviceKind, 'Cohort');
  assert.equal(cohort.parentServiceId, 'service-root');
});

test('mdm integration contract maps relationship summary', () => {
  const summary = toMdmRelationshipSummary({
    id: 'rel-1',
    fromId: 'person-1',
    toId: 'service-1',
    type: 'Attends',
    role: 'student',
    metadata: {},
    isBidirectional: false,
    validFrom: '2026-03-19',
    validTo: null,
    status: 'Active',
    createdAt: '2026-03-19T10:00:00.000Z',
    updatedAt: '2026-03-19T10:00:00.000Z',
  });

  assert.equal(summary.type, 'Attends');
  assert.equal(summary.role, 'student');
});
