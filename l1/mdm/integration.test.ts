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

test('lookup keeps platform objects, general and computed namespaces out of module namespaces', () => {
  const lookedUp = toMdmLookupResult({
    mdmId: 'vehicle-1',
    subtype: 'AssetVehicle',
    name: 'Truck',
    status: 'Active',
    docType: null,
    docId: null,
    countryCode: 'US',
    tags: [],
    aliases: [],
    contacts: [],
    relationshipRefs: {},
    addresses: [{ type: 'Commercial', line1: '1 Main', countryCode: 'US', isPrimary: true }],
    createdAt: '2026-03-19T10:00:00.000Z',
    updatedAt: '2026-03-19T10:00:00.000Z',
    vin: '1HGCM82633A004352',
    propertyAddress: { type: 'Commercial', line1: '1 Main' },
    privacyConsent: { consentedAt: '2026-01-01T00:00:00.000Z', consentVersion: 'v1', channel: 'web' },
    general: { segment: 'vip' },
    namespaces: ['clinica'],
    clinica: { allergy: 'penicillin' },
  });

  assert.equal(lookedUp.moduleNamespaces?.clinica?.allergy, 'penicillin');
  assert.equal('propertyAddress' in (lookedUp.moduleNamespaces ?? {}), false);
  assert.equal('addresses' in (lookedUp.moduleNamespaces ?? {}), false);
  assert.equal('privacyConsent' in (lookedUp.moduleNamespaces ?? {}), false);
  assert.equal('general' in (lookedUp.moduleNamespaces ?? {}), false);
  assert.equal('namespaces' in (lookedUp.moduleNamespaces ?? {}), false);
  assert.equal('vin' in (lookedUp.moduleNamespaces ?? {}), false);
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
