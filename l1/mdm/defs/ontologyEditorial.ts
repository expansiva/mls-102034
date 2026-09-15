/// <mls fileReference="_102034_/l1/mdm/defs/ontologyEditorial.ts" enhancement="_blank" />
/**
 * Editorial input of the level-1 ontology: the part that exists in no source and therefore cannot be
 * emitted — relationship roles, the capability catalog with its measured platform status, the text of the
 * engine rules, and the divergences that are known and not yet fixed.
 *
 * `scripts/emitOntology.ts` merges this with what it derives from the engine (`defs/ontology.ts`,
 * `module.ts`, `mdmSupport.ts`, `persistence.ts`). Keeping the two apart is what lets the drift test check
 * the derived half strictly while this half stays reviewable by a person.
 *
 * Every `platform` status is measured, never guessed; `evidence` says where. Source of the measurements:
 * `l1/mdm/mdmImplementation.md` (written 15/09/2026 from a line-by-line inventory).
 */

import type { MdmCapability, MdmKnownDivergence, MdmRule, MdmTrigger } from '/_102034_/l1/mdm/defs/ontologyTypes.js';

/**
 * Values `mdm_relationship.role` accepts per type. The column is free text (`mdmImplementation.md` §4);
 * this list is what a module may choose from. Seeded from each catalog entry's own `metadataExample` in
 * `defs/ontology.ts`, so the vocabulary is the engine's documented intent rather than an invention.
 * A type with no meaningful role keeps `[]`.
 */
export const MDM_RELATIONSHIP_ROLES: Readonly<Record<string, readonly string[]>> = {
  Owns: [],
  Employs: ['employee', 'contractor', 'intern'],
  OffersProduct: [],
  OffersService: [],
  StocksAt: [],
  Teaches: ['primary-instructor', 'assistant-instructor', 'substitute'],
  HappensAt: [],
  FranchiseOf: [],
  BelongsToGroup: ['subsidiary-brand'],
  PartOfUnit: ['department', 'team', 'branch-unit'],
  ManagedBy: ['manager', 'coordinator'],
  ReportsTo: ['direct-report', 'manager'],
  AssignedTo: ['member', 'assistant', 'instructor'],
  Attends: ['enrolled', 'completed'],
  SuppliesProduct: [],
  PartnersWith: ['managing-partner', 'silent-partner'],
  // `emergency` is the simulation's emergency contact: the catalog has no EmergencyContactOf type, so a
  // Family link carries the meaning in `role` (known gap, `MDM_KNOWN_DIVERGENCES`).
  Family: ['spouse', 'child', 'parent', 'sibling', 'emergency'],
  // parent/guardian when the target is a Person; owner/foster when it is an Animal.
  GuardianOf: ['parent', 'guardian', 'owner', 'foster'],
  CustomerOf: [],
  SupplierOf: [],
  MemberOf: ['board-member', 'honorary'],
  HoldsAccount: [],
  SubsidiaryOf: ['wholly-owned', 'affiliate'],
  LocatedAt: ['headquarters', 'branch', 'warehouse'],
  Signed: ['contractor', 'client', 'witness', 'notary'],
  HasContact: [],
};

/**
 * What can be done with a master-data record. A module picks ids from here; the sentence stays here
 * (`ontologia_definitiva.md` §8.7 — otherwise the 24 sentences repeat in every role of every module).
 */
export const MDM_CAPABILITIES: Readonly<Record<string, MdmCapability>> = {
  'locate.byName': {
    title: 'Locate by name',
    what: 'Finds records whose name or alias matches the typed text.',
    how: 'listByType with the `name` filter over the index table; `name` is the only text filter.',
    who: 'Anyone registering or looking a record up.',
    platform: 'ready',
    evidence: 'mdmImplementation.md §5 (listByType)',
  },
  'locate.byDocument': {
    title: 'Locate by document',
    what: 'Finds the single record that holds a national document (CPF, CNPJ, SSN, EIN…).',
    how: 'findByDocument(docType, docId); loads the index and filters in JS.',
    who: 'Whoever registers, to deduplicate before creating.',
    platform: 'partial',
    evidence: 'mdmImplementation.md §5 (full scan) and §9 (UNIQUE(docType, docId) promised, absent)',
  },
  'locate.byContact': {
    title: 'Locate by contact',
    what: 'Finds the record that owns a phone, WhatsApp handle or e-mail.',
    how: 'findByContact(contactType, value); loads every ContactChannel record.',
    who: 'Whoever answers an inbound call or message.',
    platform: 'partial',
    evidence: 'mdmImplementation.md §5 (full scan, no HTTP route)',
  },
  'locate.byLogin': {
    title: 'Locate by login',
    what: 'Finds the person behind a login e-mail.',
    how: "mdm_tag row with namespace 'login', partial unique index (namespace, tag, module).",
    who: 'The session resolver.',
    platform: 'ready',
    evidence: 'mdmImplementation.md §5, §6 (identityUsecases)',
    appliesTo: ['Person'],
  },
  'locate.semantic': {
    title: 'Locate by approximate name',
    what: 'Finds a record through a misspelling, a phonetic match or a partial name.',
    how: 'Needs a trigram/tsvector index or embeddings; searchVector is TEXT compared literally.',
    who: 'Reception, when the spelling is uncertain.',
    platform: 'missing',
    evidence: 'mdmImplementation.md §5 (searchVector is TEXT), §9 (tsvector promised)',
  },
  'locate.byDocumentField': {
    title: 'Locate by a field inside the document',
    what: 'Filters or sorts by something that lives only in the JSONB (birth month, city, any module field).',
    how: 'Needs the field promoted to an index column or a GIN/expression index on details.',
    who: 'Marketing, reporting.',
    platform: 'missing',
    evidence: 'mdmImplementation.md §1 (nothing inside the JSONB is indexed today)',
  },
  'register.createOrAttach': {
    title: 'Register, or attach the role to an existing record',
    what: 'Creates the record when it does not exist and, either way, marks it with the module role.',
    how: 'locate.byDocument, then create when absent, then attachRole(<module>.<Entity>) writing details[moduleId].',
    who: 'Whoever registers.',
    platform: 'ready',
    evidence: 'mdmImplementation.md §2.1 (attachRole); no dedicated route',
  },
  'register.asProspect': {
    title: 'Capture as a prospect',
    what: 'Records an interested party with no document yet (site, phone) and promotes it later.',
    how: 'prospect.create with promotionSource and ttlExpiresAt, then promoteToEntity; same mdmId.',
    who: 'Reception, the public site.',
    platform: 'ready',
    // No `appliesTo`: measured, not defaulted. `prospect.create` restricts no subtype and the prospect index
    // carries a free `subtype` column (persistence.ts); what is subtype-specific is only the dedup key of
    // `promoteToEntity` (docType/docId for Person and Company, contactType/value for ContactChannel).
    evidence: 'mdmImplementation.md §8; mdm_documents_prospects_index.subtype',
  },
  'edit.platformFields': {
    title: 'Edit the platform fields',
    what: 'Changes name, document, addresses, consent and the other fields the platform owns.',
    how: 'entity.update; identification also rewrites the index row.',
    who: 'Whoever maintains the record.',
    platform: 'partial',
    evidence: 'mdmImplementation.md §7 (almost nothing is validated on write)',
  },
  'edit.moduleNamespace': {
    title: 'Edit the module namespace',
    what: 'Changes only details[<moduleId>] — what this module knows about the record.',
    how: 'attachRole / update with the module key; another module key is refused.',
    who: 'The module itself.',
    platform: 'ready',
    evidence: 'mdmImplementation.md §2.1 (MDM_FOREIGN_NAMESPACE)',
  },
  inactivate: {
    title: 'Inactivate and reactivate',
    what: 'Takes the record out of use without deleting it.',
    how: 'status Active → Inactive; reactivate undoes it.',
    who: 'Whoever maintains the record.',
    platform: 'partial',
    evidence: 'mdmImplementation.md §6 (inactivate does not write status history); no route',
  },
  merge: {
    title: 'Merge duplicates',
    what: 'Joins two records of the same subject; the loser points at the winner.',
    how: 'mergeEntity sets status Merged and mergedInto.',
    who: 'An administrator.',
    platform: 'missing',
    evidence: 'mdmImplementation.md §8 (not exported by the facade nor routed)',
  },
  delete: {
    title: 'Delete',
    what: 'Removes the record physically; refused while an active relationship exists.',
    how: 'entity.delete; MDM_DELETE_BLOCKED_BY_RELATIONSHIPS.',
    who: 'An administrator.',
    platform: 'ready',
    evidence: 'mdmImplementation.md §8',
  },
  link: {
    title: 'Link to another record',
    what: 'Creates a versioned relationship, with a role, between two permanent records.',
    how: 'link(from, to, type, role); the engine recomputes the compact keys on both sides.',
    who: 'Whoever maintains the record.',
    platform: 'ready',
    evidence: 'mdmImplementation.md §4',
  },
  unlink: {
    title: 'End a link',
    what: 'Closes a relationship keeping its history.',
    how: "unlink sets status 'Inactive'; the row is never deleted.",
    who: 'Whoever maintains the record.',
    platform: 'ready',
    evidence: 'mdmImplementation.md §4',
  },
  'link.contact': {
    title: 'Add a contact channel',
    what: 'Adds a phone, WhatsApp handle or e-mail belonging to this record.',
    how: 'Create a ContactChannel record and link it with HasContact; the engine fills relationshipRefs.contacts.',
    who: 'Whoever maintains the record.',
    platform: 'ready',
    evidence: 'mdmImplementation.md §4 (contacts)',
  },
  listLinks: {
    title: 'List the links',
    what: 'Shows the related records, with validity and role.',
    how: 'relationship.list / relatedOfMany.',
    who: 'The record screen.',
    platform: 'ready',
    evidence: 'mdmImplementation.md §4',
  },
  'attach.document': {
    title: 'Attach a file',
    what: 'Stores a photo, a scan or a signed document against the record, by category.',
    how: 'Upload to S3 or local disk, row in mdm_attachment, presigned GET.',
    who: 'Whoever maintains the record.',
    platform: 'partial',
    evidence: 'mdmImplementation.md §6 (no `module` column; no upload widget in the base frontend)',
  },
  comment: {
    title: 'Comment',
    what: 'Leaves a note on the record; one reply level, 15-minute edit window.',
    how: 'mdm_comment anchored by (entityType, entityId, module).',
    who: 'Whoever maintains the record.',
    platform: 'ready',
    evidence: 'mdmImplementation.md §6',
  },
  tag: {
    title: 'Tag',
    what: 'Marks the record with free labels inside the module namespace.',
    how: 'mdm_tag; unique (entityType, entityId, tag, module).',
    who: 'Whoever maintains the record.',
    platform: 'ready',
    evidence: 'mdmImplementation.md §6',
  },
  'sequence.next': {
    title: 'Next sequence number',
    what: 'Issues the next number of a counter (record number, order number).',
    how: 'mdm_number_sequence with SELECT … FOR UPDATE; key {module}.{entityType}.{scope}.',
    who: 'The module, on create.',
    platform: 'ready',
    evidence: 'mdmImplementation.md §6',
  },
  'statusHistory.read': {
    title: 'Status history',
    what: 'Shows when the record changed status and who changed it.',
    how: 'mdm_status_history.',
    who: 'The record screen.',
    platform: 'partial',
    evidence: 'mdmImplementation.md §6 (inactivate/reactivate do not write it)',
  },
  audit: {
    title: 'Audit',
    what: 'Who changed what and when.',
    how: 'mdm_audit_log, insert-only.',
    who: 'An administrator.',
    platform: 'partial',
    evidence: 'mdmImplementation.md §6 (no reader, no route; diff only in the Dynamo copy)',
  },
  'invite.login': {
    title: 'Invite to log in',
    what: 'Gives the person a login so they can see their own data.',
    how: "identity.invite writes the mdm_tag login row and calls collab-auth.",
    who: 'Whoever maintains the record.',
    platform: 'ready',
    evidence: 'mdmImplementation.md §6 (facade; no route)',
    appliesTo: ['Person'],
  },
  'export.personalData': {
    title: 'Export personal data',
    what: 'Hands the subject their own data on request (LGPD art. 18 / GDPR art. 15).',
    how: 'Would need document + links + attachments in one export.',
    who: 'An administrator.',
    platform: 'missing',
    evidence: 'ontologia_definitiva.md §8.3 (no implementation in l1/mdm)',
    appliesTo: ['Person'],
  },
  anonymize: {
    title: 'Anonymize',
    what: 'Erases the personal data while keeping the record for statistics.',
    how: 'Would pseudonymize identification keeping the mdmId.',
    who: 'An administrator.',
    platform: 'missing',
    evidence: 'ontologia_definitiva.md §8.3 (no implementation in l1/mdm)',
    appliesTo: ['Person'],
  },
};

/**
 * Engine rules. The nine ids come from `*Detail.rules` in `defs/ontology.ts` (the emitter reads which
 * subtype cites which); the text and the status live here, plus the rules the engine applies to every
 * subtype and that no `*Detail` cites.
 */
export const MDM_RULES: Readonly<Record<string, MdmRule>> = {
  'rule-person-ssn-unique-for-us': {
    title: 'One SSN per person (US)',
    text: 'Two permanent people in the US must not share the same SSN.',
    enforcedBy: 'engine',
    platform: 'partial',
    evidence: 'mdmImplementation.md §8 (dedup on promotion only) and §9 (no UNIQUE(docType, docId))',
  },
  'rule-person-privacy-consent-required-br-eu': {
    title: 'Consent required in BR and EU',
    text: 'A person resident in Brazil or the EU without a valid privacy consent is forced to Inactive.',
    enforcedBy: 'engine',
    platform: 'ready',
    evidence: 'mdmImplementation.md §7 (normalizeStatus)',
  },
  'rule-company-ein-unique-for-us': {
    title: 'One EIN per company (US)',
    text: 'Two permanent companies in the US must not share the same EIN.',
    enforcedBy: 'engine',
    platform: 'partial',
    evidence: 'mdmImplementation.md §8, §9',
  },
  'rule-company-legal-name-required': {
    title: 'Company needs a legal name',
    text: 'A company record is refused without legalName.',
    enforcedBy: 'engine',
    platform: 'ready',
    evidence: 'mdmImplementation.md §7 (validated on write)',
  },
  'rule-contact-value-unique-per-type': {
    title: 'One contact channel per type and value',
    text: 'Two contact channels must not share the same contactType and value.',
    enforcedBy: 'engine',
    platform: 'partial',
    evidence: 'mdmImplementation.md §8 (deduped on promotion) and §5 (findByContact is a full scan)',
  },
  'rule-bank-account-routing-required-for-us': {
    title: 'Routing number required (US)',
    text: 'A US bank account is refused without bankRoutingNumber.',
    enforcedBy: 'engine',
    platform: 'ready',
    evidence: 'mdmImplementation.md §7 (validated on write)',
  },
  'rule-bank-account-holder-via-relationship': {
    title: 'The account holder is a relationship',
    text: 'Who holds a bank account is the HoldsAccount link, never a field of the account.',
    enforcedBy: 'engine',
    platform: 'ready',
    evidence: 'defs/ontology.ts (BankAccountDetail.rules); mdmImplementation.md §4',
  },
  'rule-document-parties-via-relationships': {
    title: 'The parties of a document are relationships',
    text: 'Who signed a document is the Signed link, never a field of the document.',
    enforcedBy: 'engine',
    platform: 'ready',
    evidence: 'defs/ontology.ts (DocumentDetail.rules); mdmImplementation.md §4',
  },
  'rule-document-path-immutable': {
    title: 'The stored path of a document does not change',
    text: 'Once stored, the storage key of a document is never rewritten.',
    enforcedBy: 'engine',
    platform: 'ready',
    evidence: 'defs/ontology.ts (DocumentDetail.rules)',
  },
  'rule-foreign-namespace-refused': {
    title: 'A module writes only its own namespace',
    text: 'A caller carrying a moduleId may write the platform keys, `general` and its own key; any other module key is refused with MDM_FOREIGN_NAMESPACE.',
    enforcedBy: 'engine',
    platform: 'ready',
    evidence: 'mdmImplementation.md §2.1',
  },
  'rule-delete-blocked-by-relationships': {
    title: 'No deleting a linked record',
    text: 'A physical delete is refused while an active relationship exists.',
    enforcedBy: 'engine',
    platform: 'ready',
    evidence: 'mdmImplementation.md §8',
  },
  'rule-document-shape-validated': {
    title: 'The document matches the ontology',
    text: 'Addresses, consent, `general` and the module namespace should be validated on write against the schema derived from this ontology.',
    enforcedBy: 'engine',
    platform: 'missing',
    evidence: 'mdmImplementation.md §7 (everything else is Object.assign); the validation is a task of its own',
  },
  'rule-identity-never-in-namespace': {
    title: 'Identity never inside a module namespace',
    text: 'Identity, document, contact and login are platform layers; a module never redeclares them inside details[moduleId].',
    enforcedBy: 'engine',
    platform: 'partial',
    evidence: 'mdmImplementation.md §2.1 (declared in defs/platform.ts identity.neverInModule; nothing checks the content)',
  },
};

/** Engine behaviour that happens on its own, for every subtype. */
export const MDM_TRIGGERS: Readonly<Record<string, MdmTrigger>> = {
  onWrite: {
    when: 'any create or update of the record',
    then: ['version + 1', 'index row rewritten from the identification fields', 'searchVector recomputed', 'audit row', 'outbox row mirrored to DynamoDB'],
    enforcedBy: 'engine',
    platform: 'ready',
  },
  onLink: {
    when: 'a relationship is created or ended',
    then: ['relationshipRefs recomputed on both sides', 'version + 1 when the document changed'],
    enforcedBy: 'engine',
    platform: 'ready',
  },
  onConsentMissing: {
    when: 'a person resident in BR or the EU is written without a valid consent',
    then: ['status forced to Inactive'],
    ruleRefs: ['rule-person-privacy-consent-required-br-eu'],
    enforcedBy: 'engine',
    platform: 'partial',
  },
  onPromotion: {
    when: 'a prospect is promoted',
    then: ['dedup by document, or by contactType and value', 'duplicate becomes PendingMerge and is queued', 'index row moves, relationships migrate, mdmId is kept'],
    enforcedBy: 'engine',
    platform: 'ready',
  },
  onStatusChange: {
    when: 'the status of the record changes',
    then: ['status history row'],
    enforcedBy: 'engine',
    platform: 'partial',
  },
};

/**
 * Copies of the same shape that have not been reconciled. Listed so the drift test does not have to
 * pretend they are gone; fixing them is engine work and out of scope here.
 *
 * The first eight are the ones `mdmImplementation.md` §9 names, one for one. The last two are measured
 * elsewhere and kept here because they have the same nature: the duplicated platform key list (§2.1) and
 * the missing emergency-contact relationship type (`paciente_simulacao1.defs.ts`).
 */
export const MDM_KNOWN_DIVERGENCES: readonly MdmKnownDivergence[] = [
  { id: 'address-value', description: 'Address (data) and AddressValue (interface) declare different fields.' },
  { id: 'privacy-consent-value', description: 'PrivacyConsent (data) and PrivacyConsentValue (interface) declare different fields.' },
  { id: 'contact-summary-value', description: 'ContactSummary (data) and ContactSummaryValue (interface) declare different fields.' },
  { id: 'compact-relationship-refs-count', description: 'CompactRelationshipRefs has 22 keys in the data and 48 in the interface; the interface is the real one.' },
  { id: 'doc-unique-missing', description: 'UNIQUE(docType, docId) is promised in defs/ontology.ts and absent from persistence.ts.' },
  { id: 'search-vector-type', description: 'searchVector is documented as tsvector and created as TEXT.' },
  { id: 'relationship-documents-table', description: 'Table mdm_relationship_documents is cited and does not exist.' },
  { id: 'service-defs-case', description: 'JSON service definitions use PascalCase where the columns are camelCase.' },
  { id: 'platform-detail-keys-copy', description: 'The platform key list exists twice (mdmFacade.ts and integration.ts) with different contents.' },
  { id: 'emergency-contact-type', description: 'The relationship catalog has no EmergencyContactOf; a Family link with role `emergency` carries the meaning.' },
  { id: 'contacts-written-from-input', description: 'details.contacts is declared derived from HasContact (the design) and is still written raw from the input by the engine, duplicating relationshipRefs.contacts.' },
];
