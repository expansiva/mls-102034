/// <mls fileReference="_102034_/l1/mdm/integration.ts" enhancement="_blank" />
import type { MdmStatus, MdmSubtype, RelationshipType } from './defs/ontology.js';
import type {
  CompactRelationshipRefs,
  CompanyKind,
  MdmDetailRecord,
  MdmEntityIndexRecord,
  MdmModuleNamespaceValue,
  MdmProspectIndexRecord,
  MdmRelationshipRecord,
  ServiceKind,
} from '/_102034_/l1/mdm/module.js';

export type MdmSubtypeRef = MdmSubtype;
export type { CompanyKind, ServiceKind };

export interface MdmRef {
  mdmId: string;
  subtype: MdmSubtypeRef;
  name: string;
}

export interface MdmLookupResult extends MdmRef {
  status: MdmStatus | string;
  countryCode?: string | null;
  docType?: string | null;
  docId?: string | null;
  companyKind?: CompanyKind | null;
  serviceKind?: ServiceKind | null;
  parentCompanyId?: string | null;
  parentServiceId?: string | null;
  relationshipRefs?: CompactRelationshipRefs;
  moduleNamespaces?: Record<string, MdmModuleNamespaceValue>;
}

export interface MdmRelationshipSummary {
  id: string;
  fromId: string;
  toId: string;
  type: RelationshipType;
  status: MdmRelationshipRecord['status'];
  role?: string | null;
}

export interface MdmSearchFilter {
  subtype?: MdmSubtypeRef;
  status?: string;
  countryCode?: string;
  companyKind?: CompanyKind;
  serviceKind?: ServiceKind;
  docType?: string;
  docId?: string;
  query?: string;
  limit?: number;
}

export interface MdmIntegrationContract {
  getByMdmId(input: { mdmId: string }): Promise<MdmLookupResult | null>;
  search(input: MdmSearchFilter): Promise<MdmLookupResult[]>;
  listRelationships(input: {
    mdmId: string;
    type?: RelationshipType;
    scope?: 'entity' | 'prospect' | 'all';
  }): Promise<MdmRelationshipSummary[]>;
  resolveCourseHierarchy(input: {
    mdmId: string;
  }): Promise<{
    current: MdmLookupResult | null;
    parentCourse: MdmLookupResult | null;
    cohorts: MdmLookupResult[];
  }>;
  resolveOrganizationTree(input: {
    mdmId: string;
  }): Promise<{
    current: MdmLookupResult | null;
    parent: MdmLookupResult | null;
    children: MdmLookupResult[];
  }>;
}

export type MdmRecordSummary = MdmEntityIndexRecord | MdmProspectIndexRecord;

export function toMdmLookupResult(
  detail: MdmDetailRecord,
  summary?: Partial<MdmRecordSummary>,
): MdmLookupResult {
  const reservedKeys = new Set([
    'mdmId',
    'subtype',
    'name',
    'status',
    'docType',
    'docId',
    'countryCode',
    'tags',
    'aliases',
    'contacts',
    'relationshipRefs',
    'addresses',
    'mergedInto',
    'createdAt',
    'updatedAt',
    'companyKind',
    'parentCompanyId',
    'externalCode',
    'serviceCode',
    'serviceKind',
    'parentServiceId',
    'serviceType',
    'durationMinutes',
    'deliveryMode',
    'privacyConsent',
    'legalName',
    'contactType',
    'value',
    'storageBucket',
    'storagePath',
    'promotionSource',
    'promotedTo',
    'ttlExpiresAt',
  ]);
  const moduleNamespaces = Object.fromEntries(
    Object.entries(detail).filter(([key, value]) => !reservedKeys.has(key) && value && typeof value === 'object'),
  ) as Record<string, MdmModuleNamespaceValue>;

  return {
    mdmId: detail.mdmId,
    subtype: detail.subtype,
    name: detail.name,
    status: detail.status,
    countryCode: summary?.countryCode ?? detail.countryCode,
    docType: summary?.docType ?? detail.docType ?? null,
    docId: summary?.docId ?? detail.docId ?? null,
    companyKind: detail.subtype === 'Company' ? detail.companyKind ?? null : null,
    serviceKind: detail.subtype === 'Service' ? detail.serviceKind ?? null : null,
    parentCompanyId: detail.subtype === 'Company' ? detail.parentCompanyId ?? null : null,
    parentServiceId: detail.subtype === 'Service' ? detail.parentServiceId ?? null : null,
    relationshipRefs: detail.relationshipRefs,
    moduleNamespaces,
  };
}

export function toMdmRelationshipSummary(
  relationship: MdmRelationshipRecord,
): MdmRelationshipSummary {
  return {
    id: relationship.id,
    fromId: relationship.fromId,
    toId: relationship.toId,
    type: relationship.type,
    status: relationship.status,
    role: relationship.role ?? null,
  };
}
