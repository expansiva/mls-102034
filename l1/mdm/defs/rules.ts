/// <mls fileReference="_102034_/l1/mdm/defs/rules.ts" enhancement="_blank" />
/**
 * MDM — Master Data Model
 * Business rules for all MDM entities and workflows.
 *
 * Schema per rule:
 *   kind               → "domain" | "policy" | "platform" | "validation"
 *   description        → what the rule enforces, in plain English
 *   scope              → entity names, capability names, or "global"
 *   entities           → MDM entity subtypes directly affected (optional)
 *   acceptanceCriteria → verifiable conditions that confirm the rule is met
 */

export const MdmRules = {

  // ---------------------------------------------------------------------------
  // Platform rules — structural decisions that affect the whole MDM module
  // ---------------------------------------------------------------------------

  rule_mdm_single_id_space: {
    kind: 'platform',
    description: 'Every entity in the MDM — regardless of subtype — shares a single mdmId space. Any module may store an mdmId as a foreign key without knowing the subtype.',
    scope: ['global'],
    acceptanceCriteria: [
      'mdmId is a UUID generated at creation and never changed.',
      'No module-specific ID scheme is allowed to replace or shadow mdmId.',
      'On prospect promotion, the mdmId is preserved — no new ID is generated unless a merge conflict is resolved.',
    ],
  },

  rule_mdm_default_country_us: {
    kind: 'platform',
    description: 'The default country for all MDM entities is the United States (US). Country-specific validation (document formats, tax regimes, privacy consent) is applied based on the countryCode field.',
    scope: ['global'],
    acceptanceCriteria: [
      'countryCode defaults to "US" when not explicitly provided.',
      'Document type validation (SSN, EIN, CPF, CNPJ, etc.) is gated on countryCode.',
      'Privacy consent is required only when countryCode is "BR" (LGPD) or an EU member state (GDPR).',
    ],
  },

  rule_mdm_dependency_direction: {
    kind: 'platform',
    description: 'MDM has no knowledge of any consuming module. Dependency is always unidirectional: module → MDM. Module-specific data is stored in extension tables owned by the module, not in MDM.',
    scope: ['global'],
    acceptanceCriteria: [
      'No MDM entity, rule, or service may import or reference a non-MDM module.',
      'Module extensions use a dedicated table (e.g. CrmMdmExt) with mdmId as FK.',
      'MDM write operations never trigger module-specific side effects.',
    ],
  },

  rule_mdm_read_from_dynamo: {
    kind: 'platform',
    description: 'Full entity data is read from the operational document store exposed by the backend runtime. In the current architecture, PostgreSQL local cache is the operational read source and DynamoDB remains the remote recovery/replication source of truth.',
    scope: ['global'],
    acceptanceCriteria: [
      'BFF handlers that return entity details fetch the MDM document record, not only the Postgres index row.',
      'Postgres index fields are used for filtering, searching, joining, and deduplication.',
      'The operational runtime may serve details from mdm_cache, as long as the full document shape is preserved.',
      'DynamoDB remains the remote backup and restore source for rebuilding local tables when needed.',
    ],
  },

  rule_mdm_version_optimistic_concurrency: {
    kind: 'platform',
    description: 'DynamoDB writes use optimistic concurrency via the version field. A write is rejected if the version in the store differs from the version read by the caller.',
    scope: ['global'],
    acceptanceCriteria: [
      'Every write increments version by 1.',
      'Write operations include a condition expression: version = expectedVersion.',
      'On conflict, the caller receives a ConcurrencyConflict error and must re-fetch before retrying.',
    ],
  },

  // ---------------------------------------------------------------------------
  // Deduplication rules
  // ---------------------------------------------------------------------------

  rule_entity_dedup_by_doc_id: {
    kind: 'domain',
    description: 'In MdmEntity, the combination of (docType, docId) must be unique. Attempting to create a new entity with an existing (docType, docId) pair returns the existing mdmId instead of creating a duplicate.',
    scope: ['MdmEntity'],
    entities: ['Person', 'Company'],
    acceptanceCriteria: [
      'PostgreSQL enforces UNIQUE(docType, docId) on MdmEntity.',
      'The creation service checks for an existing match before inserting.',
      'When a match is found, the existing mdmId is returned with a 200 (not a 201).',
      'The caller is informed that the returned record already existed.',
    ],
  },

  rule_prospect_no_dedup_constraint: {
    kind: 'domain',
    description: 'MdmProspect does not enforce uniqueness on (docType, docId). The same document number may appear multiple times as separate prospects. Deduplication is resolved at promotion time.',
    scope: ['MdmProspect'],
    acceptanceCriteria: [
      'No UNIQUE constraint on (docType, docId) in MdmProspect.',
      'Duplicate prospects with the same docId are allowed and flagged during promotion.',
      'The promotion workflow presents duplicate candidates to the operator for manual resolution.',
    ],
  },

  rule_merge_preserves_mdm_id: {
    kind: 'domain',
    description: 'When two entities are merged, one mdmId is designated as the winner. The loser record is set to status Merged with mergedInto pointing to the winner. The loser mdmId is never deleted — it remains as a tombstone for backward compatibility.',
    scope: ['MdmEntity'],
    acceptanceCriteria: [
      'Merged records have status "Merged" and a non-null mergedInto field.',
      'All foreign key references to the loser mdmId continue to resolve (tombstone is permanent).',
      'A lookup by the loser mdmId returns the tombstone record with a redirect to the winner mdmId.',
      'No hard deletion of merged records.',
    ],
  },

  // ---------------------------------------------------------------------------
  // Prospect lifecycle rules
  // ---------------------------------------------------------------------------

  rule_prospect_promotion_workflow: {
    kind: 'domain',
    description: 'A prospect is promoted to a permanent entity via an explicit promotion call. The workflow checks for duplicates in MdmEntity and either promotes directly or flags for operator review.',
    scope: ['MdmProspect', 'MdmEntity', 'cap_promote_prospect'],
    acceptanceCriteria: [
      'Promotion is triggered by an explicit mdm.promoteProspect(prospectMdmId) call.',
      'If no MdmEntity match is found: the DynamoDB document is unchanged; the PostgreSQL row is moved from MdmProspect to MdmEntity; the same mdmId is used.',
      'If a match is found: prospect status is set to PendingMerge; an operator review task is created.',
      'After promotion, the calling module updates its extension table to point to the final mdmId.',
      'MdmProspectRelationship rows referencing the promoted entity are migrated to MdmRelationship.',
    ],
  },

  rule_prospect_ttl_expiry: {
    kind: 'policy',
    description: 'Prospects with a ttlExpiresAt timestamp are automatically expired when the TTL is reached without promotion. Expired prospects are not deleted — they are set to status Expired.',
    scope: ['MdmProspect'],
    acceptanceCriteria: [
      'A background job checks for prospects where ttlExpiresAt < now() and status is New or InProgress.',
      'Qualifying prospects are set to status Expired.',
      'Expired prospects are retained for audit purposes and can be manually reactivated.',
      'Null ttlExpiresAt means no expiry — the prospect remains until explicitly promoted or discarded.',
    ],
  },

  // ---------------------------------------------------------------------------
  // Person-specific rules
  // ---------------------------------------------------------------------------

  rule_person_ssn_unique_for_us: {
    kind: 'validation',
    description: 'For persons with countryCode "US", the SSN (docType: SSN) must be unique in MdmEntity. SSN is treated as the primary deduplication key for US individuals.',
    scope: ['MdmEntity'],
    entities: ['Person'],
    acceptanceCriteria: [
      'If docType is SSN and countryCode is US, the UNIQUE(docType, docId) constraint in Postgres applies.',
      'SSN is stored as digits only, no dashes.',
      'SSN is never returned in list responses — only in single-entity reads with explicit field projection.',
    ],
  },

  rule_person_privacy_consent_required_br_eu: {
    kind: 'policy',
    description: 'For persons with countryCode in Brazil (BR) or any EU member state, a PrivacyConsent record must be present in the entity document before the record is set to status Active.',
    scope: ['MdmEntity'],
    entities: ['Person'],
    acceptanceCriteria: [
      'Creation of a Person with countryCode BR or an EU code without privacyConsent results in status Inactive.',
      'The entity is set to Active only after privacyConsent.consentedAt is recorded.',
      'Revocation (privacyConsent.revokedAt set) triggers a status change to Inactive.',
    ],
  },

  // ---------------------------------------------------------------------------
  // Company-specific rules
  // ---------------------------------------------------------------------------

  rule_company_ein_unique_for_us: {
    kind: 'validation',
    description: 'For companies with countryCode "US", the EIN (docType: EIN) must be unique in MdmEntity.',
    scope: ['MdmEntity'],
    entities: ['Company'],
    acceptanceCriteria: [
      'If docType is EIN and countryCode is US, the UNIQUE(docType, docId) constraint applies.',
      'EIN is stored as digits only, no dashes.',
    ],
  },

  rule_company_legal_name_required: {
    kind: 'validation',
    description: 'Every Company entity must have a non-empty legalName in its detail document.',
    scope: ['MdmEntity', 'MdmProspect'],
    entities: ['Company'],
    acceptanceCriteria: [
      'Creation or update of a Company without legalName is rejected with a validation error.',
      'tradeName is optional; legalName is not.',
    ],
  },

  // ---------------------------------------------------------------------------
  // BankAccount rules
  // ---------------------------------------------------------------------------

  rule_bank_account_holder_via_relationship: {
    kind: 'domain',
    description: 'The holder of a BankAccount is not stored as a field inside the BankAccount document. The ownership relationship is expressed via a HoldsAccount relationship in MdmRelationship.',
    scope: ['MdmRelationship'],
    entities: ['BankAccount'],
    acceptanceCriteria: [
      'No "holderId" or "ownerMdmId" field exists in BankAccountDetail.',
      'To find the holder of an account, query MdmRelationship where toId = bankAccountMdmId and type = HoldsAccount.',
      'A BankAccount may have multiple holders (joint accounts) — each represented as a separate HoldsAccount relationship.',
    ],
  },

  rule_bank_account_routing_required_for_us: {
    kind: 'validation',
    description: 'For BankAccount entities used in US domestic transfers, bankRoutingNumber is required.',
    scope: ['MdmEntity'],
    entities: ['BankAccount'],
    acceptanceCriteria: [
      'If a BankAccount is associated with a US-based holder (countryCode US) and accountType is Checking or Savings, bankRoutingNumber must be present.',
      'International accounts (IBAN/SWIFT) are exempt from this requirement.',
    ],
  },

  // ---------------------------------------------------------------------------
  // Document rules
  // ---------------------------------------------------------------------------

  rule_document_parties_via_relationships: {
    kind: 'domain',
    description: 'Parties involved in a Document (signatories, issuees, subjects) are not stored as an array inside the Document detail. They are represented as Signed or HasContact relationships in MdmRelationship.',
    scope: ['MdmRelationship'],
    entities: ['Document'],
    acceptanceCriteria: [
      'No parties[] or signatories[] field exists in DocumentDetail.',
      'To find all parties of a document, query MdmRelationship where toId = documentMdmId and type = Signed.',
      'The role field in MdmRelationship carries the party role: contractor, client, witness, notary.',
    ],
  },

  rule_document_path_immutable: {
    kind: 'policy',
    description: 'The storageBucket and storagePath fields of a Document are immutable after creation. Files must never be moved or renamed in storage without creating a new Document entity.',
    scope: ['MdmEntity'],
    entities: ['Document'],
    acceptanceCriteria: [
      'Update operations that attempt to change storageBucket or storagePath are rejected with a validation error.',
      'To update a file, a new Document entity must be created with the new path.',
      'The old Document entity is set to status Inactive, not deleted.',
    ],
  },

  // ---------------------------------------------------------------------------
  // ContactChannel rules
  // ---------------------------------------------------------------------------

  rule_contact_value_unique_per_type: {
    kind: 'validation',
    description: 'Within MdmEntity, the combination of (contactType, value) must be unique. The same phone number or email address cannot belong to two different ContactChannel entities.',
    scope: ['MdmEntity'],
    entities: ['ContactChannel'],
    acceptanceCriteria: [
      'Attempting to create a ContactChannel with an existing (contactType, value) pair returns the existing mdmId.',
      'Uniqueness is enforced at the service layer before the DynamoDB write.',
      'MdmProspect does not enforce this constraint — duplicates are resolved on promotion.',
    ],
  },

  // ---------------------------------------------------------------------------
  // Relationship rules
  // ---------------------------------------------------------------------------

  rule_relationship_valid_period: {
    kind: 'domain',
    description: 'All relationships must have a validFrom date. validTo is optional and null means currently active. Historical relationships are retained — not deleted when they end.',
    scope: ['MdmRelationship', 'MdmProspectRelationship'],
    acceptanceCriteria: [
      'validFrom is required on creation.',
      'When a relationship ends, validTo is set — the row is not deleted.',
      'Queries for active relationships must filter by validTo IS NULL OR validTo >= today.',
      'Multiple non-overlapping relationship periods between the same two entities are allowed (e.g. rehire).',
    ],
  },

  rule_relationship_bidirectional_query: {
    kind: 'platform',
    description: 'For bidirectional relationships (isBidirectional: true), only one row is stored in the database. Querying "all relationships of entity X" must check both fromId and toId columns.',
    scope: ['MdmRelationship', 'MdmProspectRelationship'],
    acceptanceCriteria: [
      'isBidirectional = true relationships are stored as a single row with fromId being the creator.',
      'The relationship query service returns the relationship when X appears in either fromId or toId.',
      'No duplicate rows are created for bidirectional relationships.',
    ],
  },

  // ---------------------------------------------------------------------------
  // Async sync rules
  // ---------------------------------------------------------------------------

  rule_async_worker_idempotency: {
    kind: 'platform',
    description: 'The background worker that processes write-behind events to DynamoDB and other remote stores must be idempotent. Re-processing the same outbox event must not create duplicate remote state or corrupt data.',
    scope: ['global'],
    acceptanceCriteria: [
      'The worker processes durable outbox events generated by the local write transaction.',
      'Remote writes are idempotent for the same aggregateId and version or equivalent event payload.',
      'Worker failures and retries do not cause duplicate remote rows or data corruption.',
      'Successfully replicated outbox rows are deleted from mdm_outbox as the normal completion path.',
      'Failed outbox rows remain in mdm_outbox with retry metadata and the last error message for operator visibility.',
    ],
  },

  rule_sync_fields_written_atomically: {
    kind: 'platform',
    description: 'SYNC fields (mdmId, subtype, name, status, docType, docId, mergedInto, dynamoPk) must be written atomically to the local PostgreSQL operational tables in the same request as the local document write. Remote DynamoDB replication is performed asynchronously via write-behind.',
    scope: ['global'],
    acceptanceCriteria: [
      'The entity write service writes the local document, index rows, and outbox event in the same local transaction.',
      'If the local transaction fails, no partial local state is committed.',
      'If remote replication succeeds, the corresponding outbox row is removed from mdm_outbox.',
      'If remote replication fails, the outbox retains the pending event for retry or operator intervention.',
      'The system must never have a state where a committed local document exists without its required local SYNC index row.',
    ],
  },

} as const;

export type MdmRuleId = keyof typeof MdmRules;
