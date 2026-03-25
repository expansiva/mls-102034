/// <mls fileReference="_102034_/l1/mdm/module.ts" enhancement="_blank" />
import type {
  DocType,
  MdmProspectStatus,
  MdmStatus,
  MdmSubtype,
  RelationshipType,
} from './defs/ontology.js';

export type AddressType =
  | 'Residential'
  | 'Commercial'
  | 'Billing'
  | 'Delivery'
  | 'Other';

export type RelationshipStatus = 'Active' | 'Inactive' | 'PendingConfirmation';

export interface AddressValue {
  type: AddressType;
  label?: string | null;
  line1: string;
  line2?: string | null;
  line3?: string | null;
  city?: string | null;
  stateOrProvince?: string | null;
  postalCode?: string | null;
  countryCode: string;
  formatted?: string | null;
  geolocation?: { lat: number; lng: number } | null;
  isPrimary: boolean;
}

export interface PrivacyConsentValue {
  consentedAt: string;
  consentVersion: string;
  channel: string;
  revokedAt?: string | null;
  notes?: string | null;
}

export interface ContactSummaryValue {
  mdmId: string;
  title: string;
}

export type CompanyKind =
  | 'LegalEntity'
  | 'Branch'
  | 'Franchise'
  | 'BusinessUnit'
  | 'Group'
  | 'Team'
  | 'Department'
  | 'InternalOrg';

export type ServiceKind =
  | 'Service'
  | 'Course'
  | 'Cohort'
  | 'Subscription'
  | 'AppointmentType';

export type MdmModuleNamespaceValue = Record<string, unknown>;

export type CompactRelationshipRefKey =
  | 'ownedAssets'
  | 'owners'
  | 'employees'
  | 'employers'
  | 'offeredProducts'
  | 'productSuppliers'
  | 'offeredServices'
  | 'serviceProviders'
  | 'stockLocations'
  | 'stockedItems'
  | 'taughtServices'
  | 'instructors'
  | 'serviceLocations'
  | 'scheduledServices'
  | 'franchisees'
  | 'franchisors'
  | 'groupParents'
  | 'groupMembers'
  | 'unitParents'
  | 'unitChildren'
  | 'managedOrganizations'
  | 'managers'
  | 'reports'
  | 'reportManagers'
  | 'assignments'
  | 'assignees'
  | 'attendedServices'
  | 'attendees'
  | 'suppliedProducts'
  | 'productVendors'
  | 'partners'
  | 'family'
  | 'pets'
  | 'guardians'
  | 'customers'
  | 'suppliers'
  | 'memberships'
  | 'members'
  | 'bankAccounts'
  | 'accountHolders'
  | 'subsidiaries'
  | 'parentCompanies'
  | 'locations'
  | 'locatedEntities'
  | 'documents'
  | 'signedBy'
  | 'contacts'
  | 'contactOwners';

export type CompactRelationshipRefs = Partial<Record<CompactRelationshipRefKey, string[]>>;

export interface BaseMdmDetailRecord {
  mdmId: string;
  subtype: MdmSubtype;
  name: string;
  status: MdmStatus | MdmProspectStatus;
  docType?: DocType | null;
  docId?: string | null;
  countryCode: string;
  tags: string[];
  aliases: string[];
  contacts: ContactSummaryValue[];
  relationshipRefs: CompactRelationshipRefs;
  addresses: AddressValue[];
  mergedInto?: string | null;
  createdAt: string;
  updatedAt: string;
  [moduleNamespace: string]: unknown;
}

export interface PersonDetailRecord extends BaseMdmDetailRecord {
  subtype: 'Person';
  privacyConsent?: PrivacyConsentValue | null;
  birthDate?: string | null;
  gender?: string | null;
  nationality?: string | null;
  occupation?: string | null;
  photoUrl?: string | null;
  notes?: string | null;
}

export interface CompanyDetailRecord extends BaseMdmDetailRecord {
  subtype: 'Company';
  companyKind: CompanyKind;
  parentCompanyId?: string | null;
  externalCode?: string | null;
  legalName: string;
  tradeName?: string | null;
  legalType?: string | null;
  foundingDate?: string | null;
  taxRegime?: string | null;
  industryCode?: string | null;
  website?: string | null;
  notes?: string | null;
}

export interface ProductDetailRecord extends BaseMdmDetailRecord {
  subtype: 'Product';
  sku?: string | null;
  productType?: string | null;
  category?: string | null;
  brand?: string | null;
  unitOfMeasure?: string | null;
  isInventoried?: boolean;
  notes?: string | null;
}

export interface ServiceDetailRecord extends BaseMdmDetailRecord {
  subtype: 'Service';
  serviceCode?: string | null;
  serviceKind?: ServiceKind;
  parentServiceId?: string | null;
  serviceType?: string | null;
  durationMinutes?: number | null;
  deliveryMode?: string | null;
  notes?: string | null;
}

export interface LocationDetailRecord extends BaseMdmDetailRecord {
  subtype: 'Location';
  locationType: string;
  locationCode?: string | null;
  parentLocationId?: string | null;
  capacity?: number | null;
  propertyAddress?: AddressValue | null;
  notes?: string | null;
}

export interface AssetGenericDetailRecord extends BaseMdmDetailRecord {
  subtype: 'AssetGeneric';
  assetCategory?: string | null;
  serialNumber?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  notes?: string | null;
}

export interface ContactChannelDetailRecord extends BaseMdmDetailRecord {
  subtype: 'ContactChannel';
  contactType: string;
  value: string;
  isVerified?: boolean;
  verifiedAt?: string | null;
  notes?: string | null;
}

export interface DocumentDetailRecord extends BaseMdmDetailRecord {
  subtype: 'Document';
  storageBucket: string;
  storagePath: string;
  originModule: string;
  docCategory: string;
  fileName: string;
  mimeType?: string | null;
  notes?: string | null;
}

export interface BankAccountDetailRecord extends BaseMdmDetailRecord {
  subtype: 'BankAccount';
  bankRoutingNumber?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  accountType?: string | null;
  swift?: string | null;
  iban?: string | null;
  pixKey?: string | null;
  pixKeyType?: string | null;
  isVerified?: boolean;
  notes?: string | null;
}

export interface ProspectLifecycleFields {
  promotionSource?: string;
  promotedTo?: string | null;
  ttlExpiresAt?: string | null;
}

export interface GenericMdmDetailRecord extends BaseMdmDetailRecord, ProspectLifecycleFields {
  subtype:
  | 'Product'
  | 'Service'
  | 'Location'
  | 'AssetGeneric'
  | 'AssetVehicle'
  | 'AssetProperty'
  | 'AssetEquipment'
  | 'Animal'
  | 'BankAccount'
  | 'Document'
  | 'ContactChannel'
  | 'Person'
  | 'Company';
  legalName?: string;
  companyKind?: CompanyKind;
  parentCompanyId?: string | null;
  externalCode?: string | null;
  serviceKind?: ServiceKind;
  parentServiceId?: string | null;
  privacyConsent?: PrivacyConsentValue | null;
  contactType?: string;
  value?: string;
  storageBucket?: string;
  storagePath?: string;
  [key: string]: unknown;
}

export type MdmDetailRecord =
  | (PersonDetailRecord & ProspectLifecycleFields)
  | (CompanyDetailRecord & ProspectLifecycleFields)
  | (ProductDetailRecord & ProspectLifecycleFields)
  | (ServiceDetailRecord & ProspectLifecycleFields)
  | (LocationDetailRecord & ProspectLifecycleFields)
  | (AssetGenericDetailRecord & ProspectLifecycleFields)
  | (ContactChannelDetailRecord & ProspectLifecycleFields)
  | (DocumentDetailRecord & ProspectLifecycleFields)
  | (BankAccountDetailRecord & ProspectLifecycleFields)
  | GenericMdmDetailRecord;

export type CreateableMdmDetailInput = {
  subtype: MdmSubtype;
  name: string;
  status: MdmStatus | MdmProspectStatus;
  docType?: DocType | null;
  docId?: string | null;
  countryCode?: string;
  tags?: string[];
  aliases?: string[];
  contacts?: ContactSummaryValue[];
  relationshipRefs?: CompactRelationshipRefs;
  addresses?: AddressValue[];
  mergedInto?: string | null;
  promotionSource?: string;
  promotedTo?: string | null;
  ttlExpiresAt?: string | null;
  privacyConsent?: PrivacyConsentValue | null;
  legalName?: string;
  contactType?: string;
  value?: string;
  storageBucket?: string;
  storagePath?: string;
  [key: string]: unknown;
};

export interface MdmDocumentRecord {
  mdmId: string;
  version: number;
  details: MdmDetailRecord;
}

export interface MdmEntityIndexRecord {
  mdmId: string;
  subtype: MdmSubtype;
  name: string;
  status: MdmStatus;
  docType?: DocType | null;
  docId?: string | null;
  countryCode: string;
  tags: string[];
  searchVector: string;
  mergedInto?: string | null;
  dynamoPk: string;
  createdAt: string;
  updatedAt: string;
}

export interface MdmProspectIndexRecord {
  mdmId: string;
  subtype: MdmSubtype;
  name: string;
  status: MdmProspectStatus;
  docType?: DocType | null;
  docId?: string | null;
  countryCode: string;
  tags: string[];
  promotionSource: string;
  promotedTo?: string | null;
  ttlExpiresAt?: string | null;
  dynamoPk: string;
  createdAt: string;
  updatedAt: string;
}

export interface MdmRelationshipRecord {
  id: string;
  fromId: string;
  toId: string;
  type: RelationshipType;
  role?: string | null;
  metadata?: Record<string, unknown>;
  isBidirectional: boolean;
  validFrom: string;
  validTo?: string | null;
  status: RelationshipStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MdmRelationshipDocumentRecord extends MdmRelationshipRecord {
  scope: 'entity' | 'prospect';
}

export type MdmAuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'restore'
  | 'transitionStatus';

export type MdmActorType = 'user' | 'agent' | 'system';
export type MdmAuditDiffType = 'CHANGE' | 'CREATE' | 'REMOVE';

export interface MdmAuditDiffEntry {
  type: MdmAuditDiffType;
  path: Array<string | number>;
  oldValue?: unknown;
  value?: unknown;
}

export interface MdmAuditLogIndexRecord {
  id: string;
  entityType: string;
  entityId: string;
  action: MdmAuditAction;
  actorId: string;
  actorType: MdmActorType;
  module: string;
  routine: string;
  createdAt: string;
}

export interface MdmAuditLogDocumentRecord extends MdmAuditLogIndexRecord {
  diff: MdmAuditDiffEntry[] | null;
}

export interface MdmMonitoringWriteRecord {
  id: string;
  entityType: string;
  entityId?: string | null;
  module: string;
  routine: string;
  action: MdmAuditAction;
  success: boolean;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  actorType: MdmActorType;
  source: 'http' | 'message' | 'test' | 'system';
  errorCode?: string | null;
}

export interface MdmErrorLogRecord {
  id: string;
  entityType?: string | null;
  entityId?: string | null;
  module: string;
  routine: string;
  action: MdmAuditAction;
  errorCode: string;
  message: string;
  details?: Record<string, unknown> | null;
  stack?: string | null;
  createdAt: string;
}

export interface MdmStatusHistoryRecord {
  id: string;
  entityType: string;
  entityId: string;
  fromStatus?: string | null;
  toStatus: string;
  reason?: string | null;
  reasonCode?: string | null;
  actorId: string;
  actorType: MdmActorType;
  module: string;
  routine: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface MdmTagRecord {
  id: string;
  entityType: string;
  entityId: string;
  tag: string;
  namespace?: string | null;
  module: string;
  createdBy: string;
  createdByType: MdmActorType;
  createdAt: string;
}

export interface MdmCommentRecord {
  id: string;
  entityType: string;
  entityId: string;
  parentCommentId?: string | null;
  text: string;
  authorId: string;
  authorType: MdmActorType;
  module: string;
  isSystemGenerated: boolean;
  editedAt?: string | null;
  deletedAt?: string | null;
  createdAt: string;
}

export interface MdmAttachmentRecord {
  id: string;
  entityType: string;
  entityId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  storageProvider: 's3' | 'local';
  category?: string | null;
  uploadedBy: string;
  uploadedAt: string;
  deletedAt?: string | null;
  details?: Record<string, unknown> | null;
}

export type NumberSequenceScopeType = 'global' | 'company' | 'branch';

export interface MdmNumberSequenceRecord {
  id: string;
  sequenceKey: string;
  prefix?: string | null;
  currentValue: number;
  increment: number;
  padding?: number | null;
  yearSegment: boolean;
  scopeType: NumberSequenceScopeType;
  scopeId?: string | null;
  lastIssuedAt: string;
  createdAt: string;
  details?: Record<string, unknown> | null;
}

export interface MdmKvRecord {
  key: string;
  value: Record<string, unknown> | null;
}

export interface MdmOutboxRecord {
  id: string;
  topic: string;
  aggregateType:
    | 'MdmDocument'
    | 'MdmRelationship'
    | 'MdmAuditLog'
    | 'MdmTag'
    | 'MdmComment'
    | 'MdmAttachment'
    | 'MdmNumberSequence'
    | 'RegistryTable';
  aggregateId: string;
  eventType:
  | 'UpsertDocument'
  | 'DeleteDocument'
  | 'UpsertRelationship'
  | 'DeleteRelationship'
  | 'UpsertAuditLog'
  | 'UpsertTag'
  | 'UpsertComment'
  | 'UpsertAttachment'
  | 'UpsertNumberSequence'
  | 'UpsertRegistryTableRecord'
  | 'DeleteRegistryTableRecord';
  payload: Record<string, unknown>;
  attemptCount: number;
  processedAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRecordParams<TDetail extends CreateableMdmDetailInput = CreateableMdmDetailInput> {
  detail: TDetail;
}

export interface UpdateRecordParams {
  mdmId: string;
  expectedVersion: number;
  patch: Partial<MdmDetailRecord>;
}

export interface ListRecordsParams {
  subtype?: MdmSubtype;
  status?: string;
  countryCode?: string;
  limit?: number;
  orderBy?: {
    field: 'name' | 'createdAt' | 'updatedAt' | 'status';
    direction: 'asc' | 'desc';
  };
}

export interface PromoteProspectParams {
  mdmId: string;
}

export interface MergeEntityParams {
  winnerMdmId: string;
  loserMdmId: string;
}

export interface CreateRelationshipParams {
  fromId: string;
  toId: string;
  type: RelationshipType;
  role?: string | null;
  metadata?: Record<string, unknown>;
  validFrom: string;
  validTo?: string | null;
  status?: RelationshipStatus;
  isBidirectional?: boolean;
}

export interface UpdateRelationshipParams {
  id: string;
  patch: Partial<
    Pick<MdmRelationshipRecord, 'role' | 'metadata' | 'validFrom' | 'validTo' | 'status'>
  >;
}

export interface ListRelationshipsParams {
  entityId?: string;
  scope?: 'entity' | 'prospect' | 'all';
  status?: RelationshipStatus;
  type?: RelationshipType;
}

export interface SearchParams {
  query?: string;
  subtype?: MdmSubtype;
  status?: string;
  scope?: 'entity' | 'prospect' | 'all';
  limit?: number;
}

export interface AddTagParams {
  entityType: string;
  entityId: string;
  tag: string;
  namespace?: string | null;
  module: string;
  createdBy?: string;
  createdByType?: MdmActorType;
}

export interface RemoveTagParams {
  entityType: string;
  entityId: string;
  tag: string;
  module: string;
}

export interface FindTagsByEntityParams {
  entityType: string;
  entityId: string;
}

export interface FindTagsByTagParams {
  entityType: string;
  tag: string;
  module?: string;
  namespace?: string | null;
}

export interface AddCommentParams {
  entityType: string;
  entityId: string;
  parentCommentId?: string | null;
  text: string;
  module: string;
  authorId?: string;
  authorType?: MdmActorType;
  isSystemGenerated?: boolean;
}

export interface EditCommentParams {
  id: string;
  text: string;
  editorId?: string;
}

export interface RemoveCommentParams {
  id: string;
}

export interface FindCommentsByEntityParams {
  entityType: string;
  entityId: string;
}

export interface AttachFileParams {
  entityType: string;
  entityId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  storageProvider: 's3' | 'local';
  category?: string | null;
  uploadedBy?: string;
  details?: Record<string, unknown> | null;
}

export interface DetachFileParams {
  id: string;
}

export interface FindAttachmentsByEntityParams {
  entityType: string;
  entityId: string;
  category?: string | null;
}

export interface NumberSequenceNextParams {
  sequenceKey: string;
  prefix?: string | null;
  increment?: number;
  padding?: number | null;
  yearSegment?: boolean;
  scopeType: NumberSequenceScopeType;
  scopeId?: string | null;
  details?: Record<string, unknown> | null;
}

export interface GetMdmKvParams {
  key: string;
}

export interface PutMdmKvParams {
  key: string;
  value: Record<string, unknown> | null;
}

export interface FindStatusHistoryByEntityParams {
  entityType: string;
  entityId: string;
  limit?: number;
}

export interface FindLatestStatusByEntityParams {
  entityType: string;
  entityId: string;
}

export interface RecordDetailResponse {
  index: MdmEntityIndexRecord | MdmProspectIndexRecord;
  document: MdmDocumentRecord;
  details: MdmDetailRecord;
}

export type ModuleIdStrategy = 'uuidv7';
export type ModuleLocalStore = 'postgres';
export type ModuleRemoteStore = 'dynamodb';
export type ModuleWriteMode = 'sync' | 'writeBehind';

export interface ModulePersistenceConfig {
  idStrategy: ModuleIdStrategy;
  localStore: ModuleLocalStore;
  remoteStore: ModuleRemoteStore;
  writeMode: ModuleWriteMode;
  remoteSourceOfTruth: boolean;
  restoreLocalFromRemote: boolean;
}

export interface ModuleConfig {
  moduleId: 'mdm';
  persistence: ModulePersistenceConfig;
}

export interface EntityDef<TDetail, TIndex> {
  entityType: string;
  moduleName: string;
  getIndexRuntime(runtime: import('/_102034_/l1/server/layer_1_external/data/runtime.js').IDataRuntime): import('/_102034_/l1/server/layer_1_external/data/runtime.js').ITableRuntime<TIndex>;
  buildIndex(detail: TDetail): TIndex;
  toDocument(detail: TDetail, version: number): MdmDocumentRecord;
  getId(detail: TDetail): string;
  getAuditSnapshot(detail: TDetail, index: TIndex): Record<string, unknown>;
}

export const moduleConfig: ModuleConfig = {
  moduleId: 'mdm',
  persistence: {
    idStrategy: 'uuidv7',
    localStore: 'postgres',
    remoteStore: 'dynamodb',
    writeMode: 'writeBehind',
    remoteSourceOfTruth: true,
    restoreLocalFromRemote: true,
  },
};
