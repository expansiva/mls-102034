/// <mls fileReference="_102034_/l1/mdm/defs/level1Types.ts" enhancement="_blank" />

/**
 * Level-1 ontology artifacts emitted from this engine into l4/organization/ontology.
 * Agents read the generated defs; they do not re-parse these types.
 */

/** Schema of the platform level-1 ontology defs. Bumped when the subtype set or field shape changes. */
export const NS4_LEVEL1_SCHEMA_VERSION = 'ns4-level1-v2' as const;

/** Closed platform subtype set. Grows only on a platform release, never per module. */
export const NS4_LEVEL1_SUBTYPE_VALUES = [
  'Person', 'Company', 'Product', 'Service', 'Location',
  'AssetGeneric', 'AssetVehicle', 'AssetProperty', 'AssetEquipment',
  'Animal', 'BankAccount', 'Document', 'ContactChannel',
] as const;

export type Ns4Level1Subtype = typeof NS4_LEVEL1_SUBTYPE_VALUES[number];

export interface Ns4Level1Field {
  fieldId: string;
  type: string;
  required: boolean;
}

export interface Ns4Level1RelationshipRef {
  type: string;
  from: readonly string[];
  to: readonly string[];
  bidirectional: boolean;
}

export interface Ns4Level1AllowedRelationship {
  type: string;
  as: 'from' | 'to' | 'both';
  otherSubtypes: readonly string[];
}

export interface Ns4Level1EntityArtifact {
  schemaVersion: typeof NS4_LEVEL1_SCHEMA_VERSION;
  subtype: string;
  identification: readonly Ns4Level1Field[];
  baseFields: readonly Ns4Level1Field[];
  allowedRelationships: readonly Ns4Level1AllowedRelationship[];
  compactRelationshipKeys: readonly string[];
}

export interface Ns4Level1IndexArtifact {
  schemaVersion: typeof NS4_LEVEL1_SCHEMA_VERSION;
  level1SchemaVersion: typeof NS4_LEVEL1_SCHEMA_VERSION;
  subtypes: readonly Ns4Level1Subtype[];
  docTypes: readonly string[];
  mdmStatuses: readonly string[];
  relationshipTypes: readonly Ns4Level1RelationshipRef[];
}

export interface MdmPlatformService {
  service: string;
  table?: string;
  tables?: readonly string[];
  rows?: string;
  indexes?: readonly string[];
  operations?: readonly string[];
  useFor?: readonly string[];
  notFor?: readonly string[];
  catalog?: string;
  compactRefs?: string;
  storage?: string;
  rule?: string;
  pending?: readonly string[];
}

export interface MdmPlatformEvent {
  eventId: string;
  on: string;
}

export interface MdmPlatformCatalogArtifact {
  catalogVersion: string;
  layers: readonly {
    layer: string;
    owner: string;
    where: string;
    fields: readonly string[];
    note: string;
  }[];
  visibility: {
    rule: string;
    read: string;
    unrestricted: string;
    write: string;
  };
  identity: {
    who: string;
    whereThePersonExists: string;
    login: {
      storage: string;
      row: {
        entityType: string;
        entityId: string;
        namespace: string;
        tag: string;
        module: string;
      };
      lookup: string;
      invariant: string;
      services?: readonly string[];
      pending: readonly string[];
    };
    otherIdentifiers: string;
    neverInModule: readonly string[];
  };
  roles: {
    meaning: string;
    tag: string;
    createOrAttach: readonly string[];
    ontologyRules: readonly string[];
    actorsAreNotRoles: string;
  };
  services: readonly MdmPlatformService[];
  lookups: readonly { lookup: string; cost: string }[];
  invariants: readonly string[];
  /** Platform events a module may receive with `inbound.from: 'organization'`. No handler in alpha. */
  events?: readonly MdmPlatformEvent[];
}
