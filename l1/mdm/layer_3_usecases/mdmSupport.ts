/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/mdmSupport.ts" enhancement="_blank" />
import type {
  DocType,
  MdmProspectStatus,
  MdmStatus,
  MdmSubtype,
  RelationshipType,
} from '../defs/ontology.js';
import { MdmDocumentEntity } from '/_102034_/l1/mdm/layer_4_entities/MdmDocumentEntity.js';
import type {
  CompactRelationshipRefKey,
  CompactRelationshipRefs,
  CompanyKind,
  CreateRecordParams,
  MdmDetailRecord,
  MdmEntityIndexRecord,
  MdmProspectIndexRecord,
  MdmRelationshipRecord,
  PrivacyConsentValue,
  ServiceKind,
} from '/_102034_/l1/mdm/module.js';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES',
  'SE',
]);

const BIDIRECTIONAL_RELATIONSHIP_TYPES = new Set<RelationshipType>(['Family']);

const RELATIONSHIP_REF_KEYS = [
  'ownedAssets',
  'owners',
  'employees',
  'employers',
  'offeredProducts',
  'productSuppliers',
  'offeredServices',
  'serviceProviders',
  'stockLocations',
  'stockedItems',
  'taughtServices',
  'instructors',
  'serviceLocations',
  'scheduledServices',
  'franchisees',
  'franchisors',
  'groupParents',
  'groupMembers',
  'unitParents',
  'unitChildren',
  'managedOrganizations',
  'managers',
  'reports',
  'reportManagers',
  'assignments',
  'assignees',
  'attendedServices',
  'attendees',
  'suppliedProducts',
  'productVendors',
  'partners',
  'family',
  'pets',
  'guardians',
  'customers',
  'suppliers',
  'memberships',
  'members',
  'bankAccounts',
  'accountHolders',
  'subsidiaries',
  'parentCompanies',
  'locations',
  'locatedEntities',
  'documents',
  'signedBy',
  'contacts',
  'contactOwners',
] as const satisfies CompactRelationshipRefKey[];

type RelationshipScope = 'entity' | 'prospect';
type RelationshipEndpointScope = 'entity' | 'prospect' | null;

function normalizeRelationshipRefs(
  relationshipRefs?: CompactRelationshipRefs | null,
): CompactRelationshipRefs {
  const normalized: CompactRelationshipRefs = {};
  for (const key of RELATIONSHIP_REF_KEYS) {
    const values = relationshipRefs?.[key];
    if (!Array.isArray(values) || values.length === 0) {
      continue;
    }

    normalized[key] = [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
  }

  return normalized;
}

function mapRelationshipKeys(
  relationshipType: RelationshipType,
  side: 'from' | 'to',
): CompactRelationshipRefKey[] {
  switch (relationshipType) {
    case 'Owns':
      return side === 'from' ? ['ownedAssets'] : ['owners'];
    case 'Employs':
      return side === 'from' ? ['employees'] : ['employers'];
    case 'OffersProduct':
      return side === 'from' ? ['offeredProducts'] : ['productSuppliers'];
    case 'OffersService':
      return side === 'from' ? ['offeredServices'] : ['serviceProviders'];
    case 'StocksAt':
      return side === 'from' ? ['stockLocations'] : ['stockedItems'];
    case 'Teaches':
      return side === 'from' ? ['taughtServices'] : ['instructors'];
    case 'HappensAt':
      return side === 'from' ? ['serviceLocations'] : ['scheduledServices'];
    case 'FranchiseOf':
      return side === 'from' ? ['franchisors'] : ['franchisees'];
    case 'BelongsToGroup':
      return side === 'from' ? ['groupParents'] : ['groupMembers'];
    case 'PartOfUnit':
      return side === 'from' ? ['unitParents'] : ['unitChildren'];
    case 'ManagedBy':
      return side === 'from' ? ['managedOrganizations'] : ['managers'];
    case 'ReportsTo':
      return side === 'from' ? ['reportManagers'] : ['reports'];
    case 'AssignedTo':
      return side === 'from' ? ['assignments'] : ['assignees'];
    case 'Attends':
      return side === 'from' ? ['attendedServices'] : ['attendees'];
    case 'SuppliesProduct':
      return side === 'from' ? ['suppliedProducts'] : ['productVendors'];
    case 'PartnersWith':
      return ['partners'];
    case 'Family':
      return ['family'];
    case 'GuardianOf':
      return side === 'from' ? ['pets'] : ['guardians'];
    case 'CustomerOf':
      return side === 'from' ? ['suppliers'] : ['customers'];
    case 'SupplierOf':
      return side === 'from' ? ['customers'] : ['suppliers'];
    case 'MemberOf':
      return side === 'from' ? ['memberships'] : ['members'];
    case 'HoldsAccount':
      return side === 'from' ? ['bankAccounts'] : ['accountHolders'];
    case 'SubsidiaryOf':
      return side === 'from' ? ['parentCompanies'] : ['subsidiaries'];
    case 'LocatedAt':
      return side === 'from' ? ['locations'] : ['locatedEntities'];
    case 'Signed':
      return side === 'from' ? ['documents'] : ['signedBy'];
    case 'HasContact':
      return side === 'from' ? ['contacts'] : ['contactOwners'];
    default:
      return [];
  }
}

function buildCompactRelationshipRefs(
  mdmId: string,
  relationships: MdmRelationshipRecord[],
): CompactRelationshipRefs {
  const buckets = new Map<CompactRelationshipRefKey, Set<string>>();
  for (const relationship of relationships) {
    if (relationship.status !== 'Active') {
      continue;
    }

    if (relationship.fromId === mdmId) {
      for (const key of mapRelationshipKeys(relationship.type, 'from')) {
        const ids = buckets.get(key) ?? new Set<string>();
        ids.add(relationship.toId);
        buckets.set(key, ids);
      }
    }

    if (relationship.toId === mdmId) {
      for (const key of mapRelationshipKeys(relationship.type, 'to')) {
        const ids = buckets.get(key) ?? new Set<string>();
        ids.add(relationship.fromId);
        buckets.set(key, ids);
      }
    }
  }

  const refs: CompactRelationshipRefs = {};
  for (const [key, values] of buckets.entries()) {
    refs[key] = [...values];
  }
  return refs;
}

async function resolveEndpointScopes(
  ctx: RequestContext,
  mdmIds: string[],
): Promise<Map<string, RelationshipEndpointScope>> {
  const scopeById = new Map<string, RelationshipEndpointScope>();
  const uniqueIds = [...new Set(mdmIds)];
  const entityIndexes = await ctx.data.mdmEntityIndex.findManyByValues({
    field: 'mdmId',
    values: uniqueIds,
  });
  const prospectIndexes = await ctx.data.mdmProspectIndex.findManyByValues({
    field: 'mdmId',
    values: uniqueIds,
  });

  for (const record of entityIndexes) {
    scopeById.set(record.mdmId, 'entity');
  }
  for (const record of prospectIndexes) {
    scopeById.set(record.mdmId, 'prospect');
  }
  for (const mdmId of uniqueIds) {
    if (!scopeById.has(mdmId)) {
      scopeById.set(mdmId, null);
    }
  }

  return scopeById;
}

export async function refreshRelationshipRefs(
  ctx: RequestContext,
  relationshipScope: RelationshipScope,
  mdmIds: string[],
  enqueueDocumentWrite: (document: { mdmId: string; version: number; details: MdmDetailRecord }) => Promise<void>,
): Promise<void> {
  const uniqueIds = [...new Set(mdmIds)];
  if (uniqueIds.length === 0) {
    return;
  }

  const fromMatches =
    relationshipScope === 'entity'
      ? await ctx.data.mdmRelationship.findManyByValues({ field: 'fromId', values: uniqueIds })
      : await ctx.data.mdmProspectRelationship.findManyByValues({ field: 'fromId', values: uniqueIds });
  const toMatches =
    relationshipScope === 'entity'
      ? await ctx.data.mdmRelationship.findManyByValues({ field: 'toId', values: uniqueIds })
      : await ctx.data.mdmProspectRelationship.findManyByValues({ field: 'toId', values: uniqueIds });
  const documents = await ctx.data.mdmDocument.getMany({ mdmIds: uniqueIds });
  const scopeById = await resolveEndpointScopes(ctx, uniqueIds);

  const relationships = [...fromMatches, ...toMatches].filter(
    (relationship, index, all) => all.findIndex((candidate) => candidate.id === relationship.id) === index,
  );
  const documentsById = new Map(documents.map((document) => [document.mdmId, document]));

  for (const mdmId of uniqueIds) {
    const document = documentsById.get(mdmId);
    const endpointScope = scopeById.get(mdmId) ?? null;
    if (!document || !endpointScope) {
      continue;
    }

    const detail = MdmDocumentEntity.parseDetails(document);
    const nextRefs = buildCompactRelationshipRefs(mdmId, relationships);
    const currentRefs = normalizeRelationshipRefs(detail.relationshipRefs);
    if (JSON.stringify(currentRefs) === JSON.stringify(nextRefs)) {
      continue;
    }

    const nextDetail: MdmDetailRecord = {
      ...detail,
      relationshipRefs: nextRefs,
      updatedAt: ctx.clock.nowIso(),
    };
    const nextDocument = toDocumentRecord(nextDetail, document.version + 1);

    await ctx.data.mdmDocument.put({
      record: nextDocument,
      expectedVersion: document.version,
    });

    if (endpointScope === 'entity') {
      await ctx.data.mdmEntityIndex.update({
        where: { mdmId },
        patch: buildEntityIndex(nextDetail),
      });
    } else {
      await ctx.data.mdmProspectIndex.update({
        where: { mdmId },
        patch: buildProspectIndex(nextDetail),
      });
    }

    await enqueueDocumentWrite(nextDocument);
  }
}

export function normalizeCountryCode(countryCode?: string | null): string {
  return countryCode?.trim().toUpperCase() || 'US';
}

export function normalizeDocumentId(docId?: string | null): string | null {
  if (!docId) {
    return null;
  }

  const normalized = docId.replace(/[^\dA-Za-z]/g, '').trim();
  return normalized || null;
}

export function normalizeContactValue(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.trim().toLowerCase();
}

export function isProtectedPrivacyCountry(countryCode: string): boolean {
  return countryCode === 'BR' || EU_COUNTRY_CODES.has(countryCode);
}

export function normalizeDetailInput(
  input: CreateRecordParams['detail'],
  ctx: RequestContext,
  mdmId: string,
): MdmDetailRecord {
  const rawInput = input as Record<string, unknown>;
  const nowIso = ctx.clock.nowIso();
  const countryCode = normalizeCountryCode(
    typeof rawInput.countryCode === 'string' ? rawInput.countryCode : null,
  );
  const docId = normalizeDocumentId(
    typeof rawInput.docId === 'string' ? rawInput.docId : null,
  );
  const value = normalizeContactValue(
    typeof rawInput.value === 'string' ? rawInput.value : null,
  );
  const detail: MdmDetailRecord = {
    mdmId,
    subtype: rawInput.subtype as MdmSubtype,
    name: String(rawInput.name),
    status: rawInput.status as MdmStatus | MdmProspectStatus,
    docType: (rawInput.docType as DocType | null | undefined) ?? null,
    countryCode,
    docId,
    promotionSource:
      typeof rawInput.promotionSource === 'string' ? rawInput.promotionSource : undefined,
    promotedTo:
      typeof rawInput.promotedTo === 'string' ? rawInput.promotedTo : null,
    ttlExpiresAt:
      typeof rawInput.ttlExpiresAt === 'string' ? rawInput.ttlExpiresAt : null,
    privacyConsent: (rawInput.privacyConsent as PrivacyConsentValue | null | undefined) ?? null,
    legalName: typeof rawInput.legalName === 'string' ? rawInput.legalName : undefined,
    companyKind:
      typeof rawInput.companyKind === 'string'
        ? (rawInput.companyKind as CompanyKind)
        : rawInput.subtype === 'Company'
          ? 'LegalEntity'
          : undefined,
    parentCompanyId:
      typeof rawInput.parentCompanyId === 'string' ? rawInput.parentCompanyId : null,
    externalCode: typeof rawInput.externalCode === 'string' ? rawInput.externalCode : undefined,
    serviceKind:
      typeof rawInput.serviceKind === 'string'
        ? (rawInput.serviceKind as ServiceKind)
        : rawInput.subtype === 'Service'
          ? 'Service'
          : undefined,
    parentServiceId:
      typeof rawInput.parentServiceId === 'string' ? rawInput.parentServiceId : null,
    contactType: typeof rawInput.contactType === 'string' ? rawInput.contactType : undefined,
    storageBucket: typeof rawInput.storageBucket === 'string' ? rawInput.storageBucket : undefined,
    storagePath: typeof rawInput.storagePath === 'string' ? rawInput.storagePath : undefined,
    value: value ?? undefined,
    tags: Array.isArray(rawInput.tags) ? [...(rawInput.tags as string[])] : [],
    aliases: Array.isArray(rawInput.aliases) ? [...(rawInput.aliases as string[])] : [],
    contacts: Array.isArray(rawInput.contacts)
      ? [...(rawInput.contacts as MdmDetailRecord['contacts'])]
      : [],
    relationshipRefs: normalizeRelationshipRefs(
      (rawInput.relationshipRefs as CompactRelationshipRefs | undefined) ?? undefined,
    ),
    addresses: Array.isArray(rawInput.addresses)
      ? [...(rawInput.addresses as MdmDetailRecord['addresses'])]
      : [],
    mergedInto: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  Object.assign(detail, rawInput);
  const mutableDetail = detail as MdmDetailRecord & Record<string, unknown>;
  mutableDetail.mdmId = mdmId;
  mutableDetail.countryCode = countryCode;
  mutableDetail.docId = docId;
  mutableDetail.value = value ?? undefined;
  mutableDetail.tags = Array.isArray(rawInput.tags) ? [...(rawInput.tags as string[])] : [];
  mutableDetail.aliases = Array.isArray(rawInput.aliases) ? [...(rawInput.aliases as string[])] : [];
  mutableDetail.contacts = Array.isArray(rawInput.contacts)
    ? [...(rawInput.contacts as MdmDetailRecord['contacts'])]
    : [];
  mutableDetail.relationshipRefs = normalizeRelationshipRefs(
    (rawInput.relationshipRefs as CompactRelationshipRefs | undefined) ?? undefined,
  );
  mutableDetail.addresses = Array.isArray(rawInput.addresses)
    ? [...(rawInput.addresses as MdmDetailRecord['addresses'])]
    : [];
  mutableDetail.mergedInto = null;
  mutableDetail.createdAt = nowIso;
  mutableDetail.updatedAt = nowIso;
  detail.status = normalizeStatus(detail);
  validateDetail(detail);
  return detail;
}

export function applyPatchToDetail(
  currentDetail: MdmDetailRecord,
  patch: Partial<MdmDetailRecord>,
  ctx: RequestContext,
): MdmDetailRecord {
  const patchRecord = patch as Record<string, unknown>;
  const currentRecord = currentDetail as Record<string, unknown>;
  if (
    currentDetail.subtype === 'Document' &&
    ((typeof patchRecord.storageBucket === 'string' &&
      patchRecord.storageBucket !== currentRecord.storageBucket) ||
      (typeof patchRecord.storagePath === 'string' &&
        patchRecord.storagePath !== currentRecord.storagePath))
  ) {
    throw new AppError(
      'DOCUMENT_PATH_IMMUTABLE',
      'Document storage path is immutable',
      400,
    );
  }

  const nextDetail: MdmDetailRecord = {
    ...currentDetail,
    ...patch,
    countryCode: normalizeCountryCode(patch.countryCode ?? currentDetail.countryCode),
    docId: normalizeDocumentId(
      (patch.docId as string | undefined) ?? (currentDetail.docId as string | undefined),
    ),
    value: normalizeContactValue(
      (patchRecord.value as string | undefined) ??
      ((currentRecord.value as string | undefined) ?? undefined),
    ) ?? undefined,
    updatedAt: ctx.clock.nowIso(),
  };
  nextDetail.relationshipRefs = normalizeRelationshipRefs(
    (patchRecord.relationshipRefs as CompactRelationshipRefs | undefined) ?? currentDetail.relationshipRefs,
  );

  nextDetail.status = normalizeStatus(nextDetail);
  validateDetail(nextDetail);
  return nextDetail;
}

export function normalizeStatus(detail: MdmDetailRecord): MdmStatus | MdmProspectStatus {
  if (detail.status === 'New' || detail.status === 'InProgress' || detail.status === 'PendingMerge') {
    return detail.status;
  }

  if (detail.status === 'Promoted' || detail.status === 'Expired' || detail.status === 'Discarded') {
    return detail.status;
  }

  if (
    detail.subtype === 'Person' &&
    isProtectedPrivacyCountry(detail.countryCode) &&
    (!detail.privacyConsent || detail.privacyConsent.revokedAt)
  ) {
    return 'Inactive';
  }

  if (detail.status === 'Merged') {
    return 'Merged';
  }

  return (detail.status as MdmStatus | undefined) ?? 'Active';
}

export function validateDetail(detail: MdmDetailRecord): void {
  if (!detail.name?.trim()) {
    throw new AppError('VALIDATION_ERROR', 'Name is required', 400, { field: 'name' });
  }

  if (detail.subtype === 'Company' && !String(detail.legalName ?? '').trim()) {
    throw new AppError('VALIDATION_ERROR', 'legalName is required for Company', 400, {
      field: 'legalName',
    });
  }

  if (
    detail.subtype === 'BankAccount' &&
    detail.countryCode === 'US' &&
    (detail.accountType === 'Checking' || detail.accountType === 'Savings') &&
    !String(detail.bankRoutingNumber ?? '').trim()
  ) {
    throw new AppError(
      'VALIDATION_ERROR',
      'bankRoutingNumber is required for US checking or savings accounts',
      400,
      { field: 'bankRoutingNumber' },
    );
  }

  if (
    detail.subtype === 'ContactChannel' &&
    (!String(detail.contactType ?? '').trim() || !String(detail.value ?? '').trim())
  ) {
    throw new AppError('VALIDATION_ERROR', 'ContactChannel requires contactType and value', 400);
  }
}

export function toDocumentRecord(detail: MdmDetailRecord, version: number) {
  return {
    mdmId: detail.mdmId,
    version,
    details: detail,
  };
}

export function buildEntityIndex(detail: MdmDetailRecord): MdmEntityIndexRecord {
  return {
    mdmId: detail.mdmId,
    subtype: detail.subtype,
    name: detail.name,
    status: normalizeEntityStatus(detail),
    docType: detail.docType ?? null,
    docId: detail.docId ?? null,
    countryCode: detail.countryCode,
    tags: [...detail.tags],
    searchVector: buildSearchVector(detail),
    mergedInto: detail.mergedInto ?? null,
    dynamoPk: detail.mdmId,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };
}

export function buildProspectIndex(detail: MdmDetailRecord): MdmProspectIndexRecord {
  return {
    mdmId: detail.mdmId,
    subtype: detail.subtype,
    name: detail.name,
    status: normalizeProspectStatus(detail),
    docType: detail.docType ?? null,
    docId: detail.docId ?? null,
    countryCode: detail.countryCode,
    tags: [...detail.tags],
    promotionSource: String(detail.promotionSource ?? 'unknown'),
    promotedTo: (detail.promotedTo as string | null | undefined) ?? null,
    ttlExpiresAt: (detail.ttlExpiresAt as string | null | undefined) ?? null,
    dynamoPk: detail.mdmId,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };
}

export function normalizeEntityStatus(detail: MdmDetailRecord): MdmStatus {
  if (detail.status === 'Merged') {
    return 'Merged';
  }

  if (
    detail.subtype === 'Person' &&
    isProtectedPrivacyCountry(detail.countryCode) &&
    (!detail.privacyConsent || detail.privacyConsent.revokedAt)
  ) {
    return 'Inactive';
  }

  if (detail.status === 'Blocked' || detail.status === 'Inactive') {
    return detail.status;
  }

  return 'Active';
}

export function normalizeProspectStatus(detail: MdmDetailRecord): MdmProspectStatus {
  if (
    detail.status === 'InProgress' ||
    detail.status === 'PendingMerge' ||
    detail.status === 'Promoted' ||
    detail.status === 'Expired' ||
    detail.status === 'Discarded'
  ) {
    return detail.status;
  }

  return 'New';
}

export function buildSearchVector(detail: MdmDetailRecord): string {
  return [detail.name, detail.docId, ...detail.aliases, ...detail.tags]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function relationshipIsBidirectional(type: RelationshipType): boolean {
  return BIDIRECTIONAL_RELATIONSHIP_TYPES.has(type);
}

export async function migrateProspectRelationships(
  ctx: RequestContext,
  prospectMdmId: string,
): Promise<{ affectedIds: string[]; migratedRelationships: MdmRelationshipRecord[] }> {
  const relationships = await ctx.data.mdmProspectRelationship.findMany();
  const affectedIds = new Set<string>();
  const migratedRelationships: MdmRelationshipRecord[] = [];
  for (const relationship of relationships) {
    if (relationship.fromId !== prospectMdmId && relationship.toId !== prospectMdmId) {
      continue;
    }

    await ctx.data.mdmRelationship.insert({ record: relationship });
    await ctx.data.mdmProspectRelationship.delete({ where: { id: relationship.id } });
    affectedIds.add(relationship.fromId);
    affectedIds.add(relationship.toId);
    migratedRelationships.push(relationship);
  }

  return {
    affectedIds: [...affectedIds],
    migratedRelationships,
  };
}

export function buildRelationshipSearchText(relationship: MdmRelationshipRecord): string {
  return [
    relationship.type,
    relationship.role,
    relationship.fromId,
    relationship.toId,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}
