/// <mls fileReference="_102034_/l1/mdm/defs/ontology.ts" enhancement="_blank" />
/**
 * MDM — Master Data Model
 * Ontology: conceptual source of truth for all shared entities.
 *
 * Storage strategy: hybrid
 *   - DynamoDB  → single document store, 3 columns: mdmId | version | details
 *   - PostgreSQL → two lean indexes:
 *       MdmEntity      → permanent, qualified, deduplicated records
 *       MdmProspect    → transient records (leads, unverified imports, anonymous captures)
 *
 * Every entity is identified by a universal mdmId.
 * The mdmId is stable from creation through promotion — references never break.
 * Any module may reference an mdmId without knowing its subtype.
 *
 * Default country: US (ISO 3166-1 alpha-2: "US")
 *
 * Naming: PascalCase for entity/type names, camelCase for fields.
 */

// ---------------------------------------------------------------------------
// Shared value sets
// ---------------------------------------------------------------------------

export type MdmSubtype =
  | 'Person'
  | 'Company'
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
  | 'ContactChannel';

export type MdmStatus = 'Active' | 'Inactive' | 'Merged' | 'Blocked';

export type MdmProspectStatus =
  | 'New'
  | 'InProgress'
  | 'PendingMerge'   // dedup check found a potential match in MdmEntity — awaiting operator decision
  | 'Promoted'       // successfully moved to MdmEntity
  | 'Expired'        // TTL elapsed without qualification
  | 'Discarded';

export type DocType =
  | 'SSN'            // US Social Security Number
  | 'EIN'            // US Employer Identification Number
  | 'Passport'
  | 'DriversLicense'
  | 'NationalId'     // generic national ID for non-US countries
  | 'CPF'            // Brazil individual
  | 'CNPJ'           // Brazil company
  | 'VAT'            // EU VAT number
  | 'Other';

export type RelationshipType =
  | 'Owns'           // person/company → asset
  | 'Employs'        // company → person
  | 'OffersProduct'  // company → product
  | 'OffersService'  // company/person → service
  | 'StocksAt'       // product/equipment → location
  | 'Teaches'        // person → service
  | 'HappensAt'      // service → location
  | 'FranchiseOf'    // company → company
  | 'BelongsToGroup' // company/unit/team → company group
  | 'PartOfUnit'     // company/unit/team → company unit
  | 'ManagedBy'      // person → company/service
  | 'ReportsTo'      // person → person
  | 'AssignedTo'     // person → company/service
  | 'Attends'        // person → service cohort
  | 'SuppliesProduct'// company → product
  | 'PartnersWith'   // person → company (equity partnership)
  | 'Family'         // person ↔ person
  | 'GuardianOf'     // person → animal
  | 'CustomerOf'     // person/company → company
  | 'SupplierOf'     // company → company
  | 'MemberOf'       // person → company/group
  | 'HoldsAccount'   // person/company → bank_account
  | 'SubsidiaryOf'   // company → company
  | 'LocatedAt'      // company/person → asset_property
  | 'Signed'         // person/company → document
  | 'HasContact';    // any entity → contact channel

// ---------------------------------------------------------------------------
// Address — embedded type (not a MDM entity, no mdmId)
// ---------------------------------------------------------------------------

/**
 * Address
 * Global address model based on Google / Apple / USPS international format.
 * Embedded as an array inside Person, Company, and AssetProperty documents.
 * Never stored as a standalone row or MDM entity.
 *
 * line1 + line2 + line3 cover the full range of international address formats:
 *   US:     line1="123 Main St", line2="Apt 4B"
 *   Brazil: line1="Rua das Flores 100", line2="Apto 42", line3="Jardim Paulista"
 *   Japan:  line1="1-2-3 Shinjuku", line2="Shinjuku-ku", line3="Tokyo"
 */
export const Address = {
  description: 'A physical or mailing address. Embedded inline in entity documents — not a standalone MDM entity.',
  fields: {
    type: {
      type: "'Residential' | 'Commercial' | 'Billing' | 'Delivery' | 'Other'",
    },
    label: {
      type: 'string | null',
      required: false,
      description: 'Short human label for this address.',
      constraints: 'max 60 chars. Examples: home, headquarters, warehouse, branch',
    },
    line1: {
      type: 'string',
      description: 'Primary address line: street and number, PO Box, or rural route.',
    },
    line2: {
      type: 'string | null',
      required: false,
      description: 'Secondary line: apartment, suite, floor, unit, building.',
    },
    line3: {
      type: 'string | null',
      required: false,
      description: 'Tertiary line: neighborhood, district, borough, ward. Required in some countries (Brazil, India, Japan).',
    },
    city: {
      type: 'string | null',
      required: false,
    },
    stateOrProvince: {
      type: 'string | null',
      required: false,
      description: 'State, province, prefecture, or canton. For US use 2-letter code (CA, NY, TX).',
    },
    postalCode: {
      type: 'string | null',
      required: false,
      description: 'ZIP, postcode, CEP, PIN — format varies by country. MDM does not enforce format.',
    },
    countryCode: {
      type: 'string',
      description: 'ISO 3166-1 alpha-2. Drives address format display in UI.',
      constraints: 'Default: US',
    },
    formatted: {
      type: 'string | null',
      required: false,
      description: 'Cached full address string as it would appear on an envelope. Async-generated. Avoids per-country format reconstruction at render time.',
    },
    geolocation: {
      type: '{ lat: number; lng: number } | null',
      required: false,
    },
    isPrimary: {
      type: 'boolean',
    },
  },
} as const;

// ---------------------------------------------------------------------------
// PrivacyConsent — embedded type
// ---------------------------------------------------------------------------

export const PrivacyConsent = {
  description: 'Privacy / data protection consent record embedded in Person documents. Required when countryCode is BR (LGPD) or an EU member state (GDPR).',
  fields: {
    consentedAt: { type: 'timestamp' },
    consentVersion: { type: 'string', description: 'Version of the privacy policy accepted.' },
    channel: {
      type: 'string',
      description: 'How consent was obtained.',
      constraints: 'Examples: web-signup, paper-form, whatsapp, verbal',
    },
    revokedAt: { type: 'timestamp | null', required: false },
    notes: { type: 'string | null', required: false },
  },
} as const;

// ---------------------------------------------------------------------------
// ContactSummary — embedded type (slim reference only)
// ---------------------------------------------------------------------------

/**
 * ContactSummary
 * Embedded inside every entity detail as part of contacts[].
 * Contains only mdmId + title — zero contact data inline.
 * Full contact data (channel type, value, verified status) lives in the ContactChannel entity document.
 * This ensures traceability without duplicating sensitive data.
 */
export const ContactSummary = {
  description: 'Slim reference to a ContactChannel entity. Embedded in the detail of any entity that has associated contacts.',
  fields: {
    mdmId: {
      type: 'string (uuid)',
      description: 'mdmId of the ContactChannel entity. Required for traceability and cross-module linking.',
    },
    title: {
      type: 'string',
      description: 'Human-readable label for this contact in the context of the parent entity.',
      constraints: 'max 60 chars. Examples: Work email, Mobile, Support line, Personal WhatsApp',
    },
  },
} as const;

// ---------------------------------------------------------------------------
// CompactRelationshipRefs — embedded type
// ---------------------------------------------------------------------------

export const CompactRelationshipRefs = {
  description: 'Compact relationship reference buckets embedded in details. Each field stores only mdmId arrays and is derived from the relational relationship tables.',
  fields: {
    ownedAssets: { type: 'string[]', required: false },
    owners: { type: 'string[]', required: false },
    employees: { type: 'string[]', required: false },
    employers: { type: 'string[]', required: false },
    partners: { type: 'string[]', required: false },
    family: { type: 'string[]', required: false },
    pets: { type: 'string[]', required: false },
    guardians: { type: 'string[]', required: false },
    customers: { type: 'string[]', required: false },
    suppliers: { type: 'string[]', required: false },
    memberships: { type: 'string[]', required: false },
    members: { type: 'string[]', required: false },
    bankAccounts: { type: 'string[]', required: false },
    accountHolders: { type: 'string[]', required: false },
    subsidiaries: { type: 'string[]', required: false },
    parentCompanies: { type: 'string[]', required: false },
    locations: { type: 'string[]', required: false },
    locatedEntities: { type: 'string[]', required: false },
    documents: { type: 'string[]', required: false },
    signedBy: { type: 'string[]', required: false },
    contacts: { type: 'string[]', required: false },
    contactOwners: { type: 'string[]', required: false },
  },
} as const;

// ---------------------------------------------------------------------------
// DynamoDB document structure — applies to ALL subtypes
// ---------------------------------------------------------------------------

/**
 * MdmDocument
 * Three top-level columns only. All entity data lives inside details.
 * DynamoDB is used as a pure document store — no GSIs, no top-level attribute queries.
 * All querying is done via the PostgreSQL indexes (MdmEntity or MdmProspect).
 */
export const MdmDocument = {
  description: 'DynamoDB document structure for all MDM entities. Three columns only.',
  fields: {
    mdmId: {
      type: 'string (uuid)',
      description: 'Partition key. Matches the mdmId in the PostgreSQL index.',
    },
    version: {
      type: 'number',
      description: 'Monotonically incrementing integer. Incremented on every write. Used for optimistic concurrency — a write is rejected if version has changed since the last read.',
    },
    details: {
      type: 'object (JSON document)',
      description: 'Structured document containing all entity fields: subtype, name, addresses[], contacts[] (ContactSummary), relationshipRefs (CompactRelationshipRefs), optional module namespaced blocks such as compras, and all subtype-specific fields. Each module-owned namespaced block should stay compact, with a recommended ceiling of 50KB per module block. The async worker reads updatedAt from inside details to determine what needs syncing to PostgreSQL.',
    },
  },
} as const;

// ---------------------------------------------------------------------------
// PostgreSQL index — MdmEntity (permanent records)
// ---------------------------------------------------------------------------

/**
 * MdmEntity
 * Permanent, qualified, deduplicated MDM records.
 * Contains only the fields needed for filtering, searching, joining, and deduplication.
 * Full entity data is always read from DynamoDB by dynamoPk.
 *
 * Sync strategy:
 *   SYNC  → written to PostgreSQL in the same request as DynamoDB
 *   async → propagated by the background worker after each DynamoDB write
 */
export const MdmEntity = {
  description: 'PostgreSQL index for permanent MDM entities.',
  fields: {
    mdmId:       { type: 'string (uuid) PK',   sync: 'SYNC' },
    subtype:     { type: 'MdmSubtype',          sync: 'SYNC' },
    name:        { type: 'string',              sync: 'SYNC',  constraints: 'max 200 chars' },
    status:      { type: 'MdmStatus',           sync: 'SYNC' },
    docType:     { type: 'DocType | null',       sync: 'SYNC',  required: false },
    docId: {
      type: 'string | null',
      sync: 'SYNC',
      required: false,
      description: 'UNIQUE constraint on (docType, docId) — enforces deduplication for permanent records.',
      constraints: 'Formatted without punctuation.',
    },
    countryCode:    { type: 'string',            sync: 'async', constraints: 'Default: US' },
    tags:           { type: 'string[]',          sync: 'async', required: false },
    searchVector:   { type: 'tsvector',          sync: 'async', description: 'Full-text search vector generated from name + aliases + docId.' },
    mergedInto:     { type: 'string (uuid) | null', sync: 'SYNC', required: false, description: 'When status is Merged, points to the winning mdmId.' },
    dynamoPk:       { type: 'string',            sync: 'SYNC',  description: 'DynamoDB partition key for direct document reads.' },
    createdAt:      { type: 'timestamp',         sync: 'async', required: false },
    updatedAt:      { type: 'timestamp',         sync: 'async', required: false },
  },
  persistence: {
    module: 'mdm',
    table: 'MdmEntity',
    type: 'MDM',
    strategy: 'remote-document',
    remoteStore: 'dynamodb',
    consistencyContract: {
      sync:  ['mdmId', 'subtype', 'name', 'status', 'docType', 'docId', 'mergedInto', 'dynamoPk'],
      async: ['countryCode', 'tags', 'searchVector', 'createdAt', 'updatedAt'],
    },
  },
} as const;

// ---------------------------------------------------------------------------
// PostgreSQL index — MdmProspect (transient records)
// ---------------------------------------------------------------------------

/**
 * MdmProspect
 * Transient, unverified, or provisional entities: leads, anonymous visitors,
 * unconfirmed signups, bulk imports pending review.
 *
 * Key differences from MdmEntity:
 *   - No UNIQUE constraint on (docType, docId)
 *   - Has ttlExpiresAt for auto-expiry
 *   - Has promotionSource to track origin module
 *   - Status covers the full promotion lifecycle
 *
 * DynamoDB document structure is identical (mdmId, version, details).
 * The separation is PostgreSQL-only.
 *
 * Promotion flow:
 *   1. Module calls mdm.promoteProspect(prospectMdmId)
 *   2. MDM runs dedup: does MdmEntity have matching (docType, docId)?
 *   3a. No match  → insert into MdmEntity, delete from MdmProspect. Same mdmId survives.
 *   3b. Match     → set status PendingMerge. Operator confirms merge.
 *   4. Calling module updates its extension table to point to the final mdmId.
 */
export const MdmProspect = {
  description: 'PostgreSQL index for transient MDM records. Isolated from MdmEntity to preserve query performance and deduplication integrity.',
  fields: {
    mdmId:           { type: 'string (uuid) PK', description: 'Same mdmId space as MdmEntity. Stable from creation through promotion.' },
    subtype:         { type: 'MdmSubtype' },
    name:            { type: 'string', constraints: 'max 200 chars' },
    status:          { type: 'MdmProspectStatus' },
    docType:         { type: 'DocType | null', required: false },
    docId:           { type: 'string | null', required: false, description: 'No UNIQUE constraint. Duplicates allowed — resolved on promotion.' },
    countryCode:     { type: 'string', constraints: 'Default: US' },
    tags:            { type: 'string[]', required: false },
    promotionSource: { type: 'string', description: 'Module that created this prospect.', constraints: 'Examples: crm, marketing-automation, web-capture, bulk-import' },
    promotedTo:      { type: 'string (uuid) | null', required: false, description: 'mdmId of the MdmEntity record this prospect was promoted or merged into.' },
    ttlExpiresAt:    { type: 'timestamp | null', required: false, description: 'Auto-expiry timestamp. Null means no expiry.' },
    dynamoPk:        { type: 'string' },
    createdAt:       { type: 'timestamp', required: false },
    updatedAt:       { type: 'timestamp', required: false },
  },
  persistence: {
    module: 'mdm',
    table: 'MdmProspect',
    type: 'MDM',
    strategy: 'remote-document',
    remoteStore: 'dynamodb',
    consistencyContract: {
      sync:  ['mdmId', 'subtype', 'name', 'status', 'dynamoPk'],
      async: ['countryCode', 'tags', 'ttlExpiresAt', 'createdAt', 'updatedAt'],
    },
  },
} as const;

// ---------------------------------------------------------------------------
// MdmRelationship — permanent entities
// ---------------------------------------------------------------------------

export const MdmRelationship = {
  description: 'Typed, versioned relationship between any two permanent MDM entities. PostgreSQL is the source of truth for relationship rows. DynamoDB details may also contain compact derived references in relationshipRefs for read optimization, and the full rows may be replicated to mdm_relationship_documents for recovery.',
  fields: {
    id:               { type: 'string (uuid) PK' },
    fromId:           { type: 'string (uuid)', description: 'Origin mdmId — must exist in MdmEntity' },
    toId:             { type: 'string (uuid)', description: 'Destination mdmId — must exist in MdmEntity' },
    type:             { type: 'RelationshipType' },
    role:             { type: 'string | null', required: false, constraints: 'max 120 chars. Examples: managing-partner, spouse, account-manager' },
    metadata:         { type: 'Record<string, unknown>', required: false, description: 'Rich relationship data as JSONB. See RelationshipCatalog for examples per type.' },
    isBidirectional:  { type: 'boolean', description: 'True for symmetric relationships (Family). False for directional (Employs, Owns).' },
    validFrom:        { type: 'date' },
    validTo:          { type: 'date | null', required: false, description: 'Null means currently active.' },
    status:           { type: "'Active' | 'Inactive' | 'PendingConfirmation'" },
    createdAt:        { type: 'timestamp', required: false },
    updatedAt:        { type: 'timestamp', required: false },
  },
  persistence: { module: 'mdm', table: 'MdmRelationship', type: 'MDM', strategy: 'relational' },
} as const;

// ---------------------------------------------------------------------------
// MdmProspectRelationship — prospect entities
// ---------------------------------------------------------------------------

/**
 * MdmProspectRelationship
 * Same schema as MdmRelationship, scoped to MdmProspect records.
 * fromId and toId may reference either MdmProspect or MdmEntity rows.
 * On promotion, relationships that reference a promoted entity are migrated
 * to MdmRelationship by the promotion workflow.
 */
export const MdmProspectRelationship = {
  description: 'Relationship table for prospect entities. Same structure as MdmRelationship. Isolated to preserve query performance on the permanent relationship graph. Compact derived references may also appear in details.relationshipRefs, and full rows may be replicated to mdm_relationship_documents.',
  fields: {
    id:               { type: 'string (uuid) PK' },
    fromId:           { type: 'string (uuid)', description: 'Origin mdmId — may be in MdmProspect or MdmEntity' },
    toId:             { type: 'string (uuid)', description: 'Destination mdmId — may be in MdmProspect or MdmEntity' },
    type:             { type: 'RelationshipType' },
    role:             { type: 'string | null', required: false, constraints: 'max 120 chars' },
    metadata:         { type: 'Record<string, unknown>', required: false },
    isBidirectional:  { type: 'boolean' },
    validFrom:        { type: 'date' },
    validTo:          { type: 'date | null', required: false },
    status:           { type: "'Active' | 'Inactive' | 'PendingConfirmation'" },
    createdAt:        { type: 'timestamp', required: false },
    updatedAt:        { type: 'timestamp', required: false },
  },
  persistence: { module: 'mdm', table: 'MdmProspectRelationship', type: 'MDM', strategy: 'relational' },
} as const;

// ---------------------------------------------------------------------------
// Entity subtype details
// Base fields present in every detail (all subtypes):
//   mdmId, subtype, name, status, docType, docId, countryCode,
//   tags, aliases, contacts (ContactSummary[]), relationshipRefs (CompactRelationshipRefs),
//   addresses (Address[]),
//   mergedInto, createdAt, updatedAt
// The fields below are additions specific to each subtype.
// ---------------------------------------------------------------------------

export const PersonDetail = {
  description: 'Subtype Person — natural persons: customers, employees, partners, dependents.',
  fields: {
    birthDate:       { type: 'string (ISO date) | null', required: false },
    gender:          { type: "'Male' | 'Female' | 'NonBinary' | 'NotDisclosed' | null", required: false },
    nationality:     { type: 'string | null', required: false, description: 'ISO 3166-1 alpha-2 country of nationality.' },
    occupation:      { type: 'string | null', required: false, constraints: 'max 120 chars' },
    photoUrl:        { type: 'string | null', required: false },
    privacyConsent:  { type: 'PrivacyConsent | null', required: false, description: 'Required for BR (LGPD) and EU (GDPR) residents.' },
    notes:           { type: 'string | null', required: false, constraints: 'max 1000 chars' },
  },
  rules: ['rule-person-ssn-unique-for-us', 'rule-person-privacy-consent-required-br-eu'],
} as const;

export const CompanyDetail = {
  description: 'Subtype Company — corporations, LLCs, nonprofits, government entities.',
  fields: {
    companyKind:  { type: "'LegalEntity' | 'Branch' | 'Franchise' | 'BusinessUnit' | 'Group' | 'Team' | 'Department' | 'InternalOrg'", description: 'Organizational classification for legal and internal structures.' },
    parentCompanyId:{ type: 'string | null', required: false, description: 'Optional parent mdmId for organizational trees.' },
    externalCode: { type: 'string | null', required: false, description: 'ERP/HR/legacy code used by consuming modules.' },
    tradeName:    { type: 'string | null', required: false, description: 'DBA name. Also stored in aliases for full-text search.' },
    legalName:    { type: 'string', description: 'Official registered name.' },
    legalType:    { type: "'Corporation' | 'LLC' | 'SoleProp' | 'Partnership' | 'Nonprofit' | 'Government' | 'Other' | null", required: false },
    foundingDate: { type: 'string (ISO date) | null', required: false },
    taxRegime:    { type: 'string | null', required: false, description: 'Country-specific tax class. Examples: S-Corp, C-Corp (US); Simples Nacional (BR).' },
    industryCode: { type: 'string | null', required: false, description: 'NAICS code (US), CNAE (BR), or equivalent.' },
    website:      { type: 'string | null', required: false },
    notes:        { type: 'string | null', required: false, constraints: 'max 1000 chars' },
  },
  rules: ['rule-company-ein-unique-for-us', 'rule-company-legal-name-required'],
} as const;

export const ProductDetail = {
  description: 'Subtype Product — inventory or catalog item that may be bought, stocked, sold, or offered by suppliers.',
  fields: {
    sku:           { type: 'string | null', required: false, description: 'Internal stock keeping unit.' },
    productType:   { type: "'Physical' | 'Digital' | 'Bundle' | 'Consumable' | 'Other' | null", required: false },
    category:      { type: 'string | null', required: false },
    brand:         { type: 'string | null', required: false },
    unitOfMeasure: { type: 'string | null', required: false, description: 'Examples: unit, box, kg, liter, hour.' },
    isInventoried: { type: 'boolean', required: false, description: 'True when stock is tracked by location.' },
    notes:         { type: 'string | null', required: false, constraints: 'max 1000 chars' },
  },
} as const;

export const ServiceDetail = {
  description: 'Subtype Service — reusable service or offering that may be sold, scheduled, taught, or assigned to a location. Also covers course-like offerings.',
  fields: {
    serviceCode:    { type: 'string | null', required: false },
    serviceKind:    { type: "'Service' | 'Course' | 'Cohort' | 'Subscription' | 'AppointmentType'", required: false, description: 'Use Cohort for a concrete class/offering instance.' },
    parentServiceId:{ type: 'string | null', required: false, description: 'Parent mdmId when this service is a cohort or derived offering from a base service.' },
    serviceType:    { type: "'Course' | 'Consulting' | 'Maintenance' | 'Appointment' | 'Subscription' | 'Other' | null", required: false },
    durationMinutes:{ type: 'number | null', required: false },
    deliveryMode:   { type: "'Onsite' | 'Remote' | 'Hybrid' | 'Other' | null", required: false },
    notes:          { type: 'string | null', required: false, constraints: 'max 1000 chars' },
  },
} as const;

export const LocationDetail = {
  description: 'Subtype Location — room, warehouse, campus, store, branch, shelf area, or any physical place used for stock or service allocation.',
  fields: {
    locationType:     { type: "'Room' | 'Warehouse' | 'Building' | 'Campus' | 'Store' | 'Office' | 'Shelf' | 'Other'" },
    locationCode:     { type: 'string | null', required: false },
    parentLocationId: { type: 'string | null', required: false, description: 'Optional parent mdmId when this place belongs to a larger place.' },
    capacity:         { type: 'number | null', required: false },
    propertyAddress:  { type: 'Address | null', required: false },
    notes:            { type: 'string | null', required: false, constraints: 'max 1000 chars' },
  },
} as const;

export const AssetVehicleDetail = {
  description: 'Subtype AssetVehicle — cars, trucks, motorcycles, boats.',
  fields: {
    plate:    { type: 'string | null', required: false },
    vin:      { type: 'string | null', required: false, description: 'Vehicle Identification Number.' },
    brand:    { type: 'string | null', required: false },
    model:    { type: 'string | null', required: false },
    year:     { type: 'number | null', required: false },
    color:    { type: 'string | null', required: false },
    fuelType: { type: "'Gasoline' | 'Diesel' | 'Electric' | 'Hybrid' | 'Flex' | 'Other' | null", required: false },
    notes:    { type: 'string | null', required: false, constraints: 'max 400 chars' },
  },
} as const;

export const AssetPropertyDetail = {
  description: 'Subtype AssetProperty — residential, commercial, rural, or industrial real estate.',
  fields: {
    registrationNumber: { type: 'string | null', required: false, description: 'Deed number, cadastral reference, or equivalent.' },
    propertyAddress:    { type: 'Address | null', required: false },
    areaSqft:           { type: 'number | null', required: false, description: 'Area in square feet (primary unit for US).' },
    areaM2:             { type: 'number | null', required: false, description: 'Area in square meters (non-US markets).' },
    propertyType:       { type: "'Residential' | 'Commercial' | 'Rural' | 'UrbanLot' | 'Industrial' | 'Other' | null", required: false },
    taxParcelId:        { type: 'string | null', required: false, description: 'Tax parcel / assessor ID (US) or equivalent.' },
    notes:              { type: 'string | null', required: false, constraints: 'max 400 chars' },
  },
} as const;

export const AssetEquipmentDetail = {
  description: 'Subtype AssetEquipment — machinery, devices, infrastructure equipment.',
  fields: {
    serialNumber:    { type: 'string | null', required: false },
    brand:           { type: 'string | null', required: false },
    model:           { type: 'string | null', required: false },
    category:        { type: 'string | null', required: false, constraints: 'Examples: printer, server, forklift, medical device' },
    acquisitionDate: { type: 'string (ISO date) | null', required: false },
    notes:           { type: 'string | null', required: false, constraints: 'max 400 chars' },
  },
} as const;

export const AssetGenericDetail = {
  description: 'Subtype AssetGeneric — fallback asset for cases that do not fit vehicle, property, or equipment cleanly.',
  fields: {
    assetCategory: { type: 'string | null', required: false, description: 'Examples: furniture, lab-item, signage, toolkit, decor.' },
    serialNumber:  { type: 'string | null', required: false },
    manufacturer:  { type: 'string | null', required: false },
    model:         { type: 'string | null', required: false },
    notes:         { type: 'string | null', required: false, constraints: 'max 400 chars' },
  },
} as const;

export const AnimalDetail = {
  description: 'Subtype Animal — pets, livestock, working animals.',
  fields: {
    species:            { type: 'string | null', required: false, constraints: 'Examples: Dog, Cat, Horse, Bovine, Bird' },
    breed:              { type: 'string | null', required: false },
    birthDate:          { type: 'string (ISO date) | null', required: false },
    sex:                { type: "'Male' | 'Female' | 'Unknown' | null", required: false },
    color:              { type: 'string | null', required: false },
    microchip:          { type: 'string | null', required: false },
    registrationNumber: { type: 'string | null', required: false, description: 'Breed registry, USDA tag, or official animal ID.' },
    isNeutered:         { type: 'boolean | null', required: false },
    notes:              { type: 'string | null', required: false, constraints: 'max 400 chars' },
  },
} as const;

export const BankAccountDetail = {
  description: 'Subtype BankAccount — routing data only. Balances and transactions belong in the finance module.',
  fields: {
    bankRoutingNumber: { type: 'string | null', required: false, description: 'ABA routing number (US). Use swift for international.' },
    bankName:          { type: 'string | null', required: false },
    accountNumber:     { type: 'string | null', required: false },
    accountType:       { type: "'Checking' | 'Savings' | 'MoneyMarket' | 'Payment' | 'Other' | null", required: false },
    swift:             { type: 'string | null', required: false, description: 'BIC/SWIFT for international transfers.' },
    iban:              { type: 'string | null', required: false },
    pixKey:            { type: 'string | null', required: false },
    pixKeyType:        { type: "'CPF' | 'CNPJ' | 'Phone' | 'Email' | 'RandomKey' | null", required: false },
    isVerified:        { type: 'boolean', description: 'Verified via micro-deposit, open banking, or manual review.' },
    notes:             { type: 'string | null', required: false, constraints: 'max 400 chars' },
  },
  rules: ['rule-bank-account-holder-via-relationship', 'rule-bank-account-routing-required-for-us'],
} as const;

export const DocumentDetail = {
  description: 'Subtype Document — indexed reference to an external file. The file never lives in MDM.',
  fields: {
    originModule:  { type: 'string', description: 'Module that created this record.', constraints: 'Examples: legal, maintenance, hr, finance' },
    docCategory:   { type: "'Contract' | 'Certificate' | 'IdDocument' | 'Invoice' | 'Receipt' | 'Report' | 'Photo' | 'Other'" },
    storageBucket: { type: 'string', description: 'S3 bucket (or equivalent) where the file resides.' },
    storagePath:   { type: 'string', description: 'Relative path within the bucket. Immutable after creation.', constraints: 'Example: doc/2026/03/17/contract-001.pdf' },
    fileName:      { type: 'string' },
    mimeType:      { type: 'string | null', required: false },
    fileSizeKb:    { type: 'number | null', required: false },
    issuedAt:      { type: 'string (ISO date) | null', required: false },
    expiresAt:     { type: 'string (ISO date) | null', required: false },
    issuer:        { type: 'string | null', required: false, description: 'Free text issuing authority name. Not an mdmId.' },
    notes:         { type: 'string | null', required: false, constraints: 'max 400 chars' },
  },
  rules: ['rule-document-parties-via-relationships', 'rule-document-path-immutable'],
} as const;

export const ContactChannelDetail = {
  description: 'Subtype ContactChannel — phone, email, or social handle as a first-class traceable communication channel.',
  fields: {
    contactType: { type: "'Phone' | 'Email' | 'WhatsApp' | 'Instagram' | 'LinkedIn' | 'X' | 'Other'" },
    value:       { type: 'string', description: 'Full contact value. Stored unmasked.', constraints: 'Access control enforced at the BFF layer. Examples: +12125550100, john@company.com' },
    isVerified:  { type: 'boolean' },
    verifiedAt:  { type: 'timestamp | null', required: false },
    notes:       { type: 'string | null', required: false, constraints: 'max 400 chars' },
  },
  rules: ['rule-contact-value-unique-per-type'],
} as const;

// ---------------------------------------------------------------------------
// Relationship catalog
// ---------------------------------------------------------------------------

export const RelationshipCatalog = {
  description: 'All supported relationship types with cardinality, bidirectionality, and metadata examples.',
  entries: [
    { type: 'Owns',          from: 'Person | Company', to: 'AssetGeneric | AssetVehicle | AssetProperty | AssetEquipment', bidirectional: false, metadataExample: '{ since: "2022-01-01", ownershipPct: 100 }' },
    { type: 'Employs',       from: 'Company',           to: 'Person',       bidirectional: false, metadataExample: '{ role: "Software Engineer", department: "Engineering", startDate: "2023-06-01" }' },
    { type: 'OffersProduct', from: 'Company',           to: 'Product',      bidirectional: false, metadataExample: '{ since: "2024-01-01", supplierSku: "CHAIR-01" }' },
    { type: 'OffersService', from: 'Company | Person',  to: 'Service',      bidirectional: false, metadataExample: '{ since: "2024-01-01", priceTable: "default" }' },
    { type: 'StocksAt',      from: 'Product | AssetEquipment', to: 'Location', bidirectional: false, metadataExample: '{ quantity: 20, unit: "unit", minLevel: 5 }' },
    { type: 'Teaches',       from: 'Person',            to: 'Service',      bidirectional: false, metadataExample: '{ role: "primary-instructor", since: "2026-03-01" }' },
    { type: 'HappensAt',     from: 'Service',           to: 'Location',     bidirectional: false, metadataExample: '{ scheduleLabel: "Engineering 1 - morning", weekday: "Mon" }' },
    { type: 'FranchiseOf',   from: 'Company',           to: 'Company',      bidirectional: false, metadataExample: '{ contractId: "uuid", territory: "south-zone" }' },
    { type: 'BelongsToGroup',from: 'Company',           to: 'Company',      bidirectional: false, metadataExample: '{ role: "subsidiary-brand" }' },
    { type: 'PartOfUnit',    from: 'Company',           to: 'Company',      bidirectional: false, metadataExample: '{ role: "department" | "team" | "branch-unit" }' },
    { type: 'ManagedBy',     from: 'Person',            to: 'Company | Service', bidirectional: false, metadataExample: '{ role: "manager" | "coordinator" }' },
    { type: 'ReportsTo',     from: 'Person',            to: 'Person',       bidirectional: false, metadataExample: '{ role: "direct-report" }' },
    { type: 'AssignedTo',    from: 'Person',            to: 'Company | Service', bidirectional: false, metadataExample: '{ role: "member" | "assistant" | "instructor" }' },
    { type: 'Attends',       from: 'Person',            to: 'Service',      bidirectional: false, metadataExample: '{ attendanceStatus: "enrolled" | "completed" }' },
    { type: 'SuppliesProduct',from: 'Company',          to: 'Product',      bidirectional: false, metadataExample: '{ leadTimeDays: 7, catalogCode: "SUP-001" }' },
    { type: 'PartnersWith',  from: 'Person',            to: 'Company',      bidirectional: false, metadataExample: '{ equityPct: 30, role: "managing-partner" }' },
    { type: 'Family',        from: 'Person',            to: 'Person',       bidirectional: true,  metadataExample: '{ degree: "spouse" | "child" | "parent" | "sibling" }' },
    { type: 'GuardianOf',    from: 'Person',            to: 'Animal',       bidirectional: false, metadataExample: '{ since: "2020-05-10", guardianType: "owner" | "foster" }' },
    { type: 'CustomerOf',    from: 'Person | Company',  to: 'Company',      bidirectional: false, metadataExample: '{ since: "2021-01-01", segment: "retail" }' },
    { type: 'SupplierOf',    from: 'Company',           to: 'Company',      bidirectional: false, metadataExample: '{ category: "raw-materials", contractMdmId: "uuid" }' },
    { type: 'MemberOf',      from: 'Person',            to: 'Company',      bidirectional: false, metadataExample: '{ role: "board-member", membershipType: "honorary" }' },
    { type: 'HoldsAccount',  from: 'Person | Company',  to: 'BankAccount',  bidirectional: false, metadataExample: '{ isPrimary: true, since: "2019-03-15" }' },
    { type: 'SubsidiaryOf',  from: 'Company',           to: 'Company',      bidirectional: false, metadataExample: '{ equityPct: 100, type: "wholly-owned" | "affiliate" }' },
    { type: 'LocatedAt',     from: 'Person | Company',  to: 'AssetProperty',bidirectional: false, metadataExample: '{ locationType: "headquarters" | "branch" | "warehouse" }' },
    { type: 'Signed',        from: 'Person | Company',  to: 'Document',     bidirectional: false, metadataExample: '{ role: "contractor" | "client" | "witness" | "notary" }' },
    { type: 'HasContact',    from: 'any',               to: 'ContactChannel', bidirectional: false, metadataExample: '{ isPrimary: true }' },
  ],
} as const;

// ---------------------------------------------------------------------------
// Module ontology export
// ---------------------------------------------------------------------------

export const MdmOntology = {
  module: 'mdm',
  description: 'Master Data Model — shared reference entities for all platform modules',
  defaultCountry: 'US',
  storageStrategy: 'hybrid',
  storageNotes: [
    'DynamoDB is the source of truth. Three columns per document: mdmId | version | details.',
    'details is a structured JSON document object containing all entity fields.',
    'details may embed compact relationshipRefs arrays for fast reads and restore support.',
    'Full relationship rows are replicated to DynamoDB table mdm_relationship_documents for backup and PostgreSQL rebuilds.',
    'No DynamoDB GSIs. All querying goes through PostgreSQL indexes.',
    'PostgreSQL has two index tables: MdmEntity (permanent) and MdmProspect (transient).',
    'MdmEntity enforces UNIQUE(docType, docId). MdmProspect does not.',
    'SYNC fields are written to PostgreSQL in the same request as DynamoDB.',
    'Async fields are propagated by a background worker reading updatedAt from details.',
    'Module extensions use a separate table per module (e.g. CrmMdmExt) with mdmId as FK.',
    'MDM has no knowledge of any consuming module — dependency is always module → MDM.',
    'On prospect promotion: mdmId is preserved. Merge conflicts require operator confirmation.',
  ],
  postgresIndexes: {
    MdmEntity:                'Permanent, qualified, deduplicated records. UNIQUE(docType, docId).',
    MdmProspect:              'Transient records. No unique constraint on docId. Supports TTL expiry.',
    MdmRelationship:          'Relationship graph for permanent entities.',
    MdmProspectRelationship:  'Relationship graph for prospect entities. Same schema as MdmRelationship.',
  },
  dynamoDocumentSchema: MdmDocument,
  entitySubtypes: {
    Person:         PersonDetail,
    Company:        CompanyDetail,
    Product:        ProductDetail,
    Service:        ServiceDetail,
    Location:       LocationDetail,
    AssetGeneric:   AssetGenericDetail,
    AssetVehicle:   AssetVehicleDetail,
    AssetProperty:  AssetPropertyDetail,
    AssetEquipment: AssetEquipmentDetail,
    Animal:         AnimalDetail,
    BankAccount:    BankAccountDetail,
    Document:       DocumentDetail,
    ContactChannel: ContactChannelDetail,
  },
  embeddedTypes: {
    Address,
    PrivacyConsent,
    ContactSummary,
    CompactRelationshipRefs,
  },
  relationships: RelationshipCatalog,
} as const;
