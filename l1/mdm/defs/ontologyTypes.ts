/// <mls fileReference="_102034_/l1/mdm/defs/ontologyTypes.ts" enhancement="_blank" />
/**
 * Platform ontology grammar — one grammar for the level-1 ontology in `l4/ontology/` and for the
 * ontology a module writes over it (`mls-<client>/l4/<module>/ontology/`).
 *
 * A record is `{ id, version, details }`, mirroring `mdm_documents`: `id` and `version` are columns,
 * `details` is the JSONB document and carries everything else as a tree of unlimited depth. A field is
 * `layer: 'column'` only when it needs an index (filter, sort, uniqueness, search) — the identification
 * fields are columns of `mdm_documents_entities_index` AND keys inside the document (`mdmImplementation.md`
 * §1-§2). Everything else is `layer: 'document'`.
 *
 * `origin` says who writes the field: `nivel1` (the platform record), `modulo` (the module namespace
 * `details.<moduleId>`) or `derived` (the engine writes it; no tool schema and no screen ever asks for it).
 *
 * Field forms: a scalar, an `enum` with labelled values, an `object` (inline `fields`, or `of` a reusable
 * value type), or a `record` pointing at another MDM record by id. `collection: true` turns any of them
 * into an array. `InferRecord` derives the runtime record type from the ontology, so `tsc` keeps engine
 * code and ontology on the same shape instead of hand-written interfaces.
 */

export const MDM_ONTOLOGY_SCHEMA_VERSION = '2026-09-15-mdm-ontology-v1' as const;

export type MdmScalarKind =
  | 'string' | 'text' | 'integer' | 'number' | 'money' | 'boolean' | 'date' | 'timestamp' | 'uuid';

/** Who writes the field. `derived` never reaches a tool schema or a form. */
export type MdmFieldOrigin = 'nivel1' | 'modulo' | 'derived';

/** `column` = also a column of the index table (indexable); `document` = only inside the JSONB. */
export type MdmFieldLayer = 'column' | 'document';

/** Closed domain value: a stable English code plus the label a screen shows. */
export interface MdmEnumValue {
  value: string;
  title: string;
}

export type MdmField = MdmScalarField | MdmEnumField | MdmObjectField | MdmRecordField;

interface MdmFieldBase {
  /** Label, English on the platform; a module writes it in the user language. */
  title: string;
  description?: string;
  /** Required on write. On a collection: whether the array itself must be present. */
  required: boolean;
  /** Array of the declared form. */
  collection?: boolean;
  minItems?: number;
  origin: MdmFieldOrigin;
  layer: MdmFieldLayer;
  /**
   * The value may be explicitly null, as opposed to simply absent. The engine makes the same distinction
   * (`docType?: DocType | null` against `moduleTypes?: string[]`), so the derived record type must too.
   */
  nullable?: boolean;
  /** Unique among permanent records. */
  unique?: boolean;
  /** Backed by a real index today. `layer: 'column'` without `indexed` is a column with no index. */
  indexed?: boolean;
}

export interface MdmScalarField extends MdmFieldBase {
  type: MdmScalarKind;
  /** string / text */
  maxLength?: number;
  pattern?: string;
  /** integer / number / money */
  min?: number;
  max?: number;
  precision?: number;
}

export interface MdmEnumField extends MdmFieldBase {
  type: 'enum';
  values: readonly MdmEnumValue[];
}

/**
 * Nested object. Either inline (`fields`) or a reusable value type (`of`, declared in
 * `l4/ontology/defs/<ValueType>.defs.ts`). With both, `fields` is the selection and wins — that is how a
 * module keeps only the sub-fields it uses. `of` alone means the whole value type.
 */
export interface MdmObjectField extends MdmFieldBase {
  type: 'object';
  of?: string;
  fields?: MdmFields;
}

/** Reference to another record by id (mdmId, or the uuid of a module table). The link itself is a relationship. */
export interface MdmRecordField extends MdmFieldBase {
  type: 'record';
  /** Allowed targets: MDM subtypes or entity ids. */
  to: readonly string[];
}

export type MdmFields = Readonly<Record<string, MdmField>>;

export interface MdmValueTypeArtifact {
  schemaVersion: typeof MDM_ONTOLOGY_SCHEMA_VERSION;
  kind: 'valueType';
  valueTypeId: string;
  title: string;
  description: string;
  fields: MdmFields;
}

/** A relationship type this subtype may take part in. `roles` live on the catalog entry, never here. */
export interface MdmEntityRelationship {
  type: string;
  as: 'from' | 'to' | 'both';
  /** Subtypes on the other end, from the catalog. */
  otherSubtypes: readonly string[];
  /** Compact keys the engine writes on this side's `relationshipRefs` (derived from `mapRelationshipKeys`). */
  compactKeys: readonly string[];
}

export interface MdmEntityArtifact {
  schemaVersion: typeof MDM_ONTOLOGY_SCHEMA_VERSION;
  kind: 'entity';
  /** MDM subtype id (PascalCase); the entity id of the level-1 catalog. */
  entityId: string;
  title: string;
  description: string;
  /** Path a screen shows to recognise the record, e.g. `details.name`. */
  displayField: string;
  /** `{ id, version, details }`; everything else hangs under `details`. */
  fields: MdmFields;
  relationships: readonly MdmEntityRelationship[];
  /** Capability ids of the index catalog that apply to this subtype. */
  capabilities: readonly string[];
  /** Engine rule ids of the index catalog that apply to this subtype. */
  rules: readonly string[];
  /** What happens on its own. Keyed by name. */
  triggers: Readonly<Record<string, MdmTrigger>>;
}

/** How ready the platform is for a capability, a rule or a trigger. Measured, never guessed. */
export type MdmPlatformStatus = 'ready' | 'partial' | 'missing';

/**
 * One thing that can be done with a record, in four parts: what it does, how (key, index, route),
 * who uses it, and how ready the platform is. A module picks ids from this catalog; the sentence lives here.
 */
export interface MdmCapability {
  title: string;
  what: string;
  how: string;
  who: string;
  platform: MdmPlatformStatus;
  /** Where the status was measured (file:line or `mdmImplementation.md` section). */
  evidence?: string;
  /** Subtypes the capability applies to. Absent = every subtype. */
  appliesTo?: readonly string[];
}

export interface MdmRule {
  title: string;
  text: string;
  enforcedBy: 'engine' | 'module' | 'screen';
  platform: MdmPlatformStatus;
  evidence?: string;
}

export interface MdmTrigger {
  when: string;
  then: readonly string[];
  ruleRefs?: readonly string[];
  enforcedBy: string;
  platform: MdmPlatformStatus;
}

export interface MdmRelationshipType {
  type: string;
  title: string;
  description: string;
  from: readonly string[];
  to: readonly string[];
  bidirectional: boolean;
  /**
   * Values `mdm_relationship.role` accepts for this type (kinship, function). Free text in the engine;
   * this list is what a module may choose from. Empty when the type has no meaningful role.
   */
  roles: readonly string[];
  /** Compact key of `relationshipRefs` written on each side, derived from `mapRelationshipKeys`. */
  compactKeys: { from: readonly string[]; to: readonly string[] };
}

/** A copy of the same shape that has not been reconciled yet (`mdmImplementation.md` §9). Listed, not fixed. */
export interface MdmKnownDivergence {
  id: string;
  description: string;
}

export interface MdmOntologyIndexArtifact {
  schemaVersion: typeof MDM_ONTOLOGY_SCHEMA_VERSION;
  title: string;
  description: string;
  entities: readonly string[];
  valueTypes: readonly string[];
  relationships: readonly MdmRelationshipType[];
  capabilities: Readonly<Record<string, MdmCapability>>;
  rules: Readonly<Record<string, MdmRule>>;
  statuses: readonly string[];
  docTypes: readonly string[];
  storage: {
    indexTable: string;
    prospectIndexTable: string;
    documentTable: string;
    documentColumn: string;
    /** Document keys the platform reserves: `general` and one per module id. */
    reservedDocumentKeys: readonly string[];
  };
  knownDivergences: readonly MdmKnownDivergence[];
}

// ---------------------------------------------------------------------------
// InferRecord — the runtime type of a record, derived from the ontology.
// Measured on the 13 subtypes + 4 value types: no measurable tsc cost, no depth limit (ns5_37, D9).
// ---------------------------------------------------------------------------

type ScalarOf<K extends MdmScalarKind> =
  K extends 'string' | 'text' | 'date' | 'timestamp' | 'uuid' ? string
  : K extends 'integer' | 'number' | 'money' ? number
  : K extends 'boolean' ? boolean
  : never;

type Registry = Readonly<Record<string, { fields: MdmFields }>>;

type ValueOf<F extends MdmField, R extends Registry> =
  F extends MdmScalarField ? ScalarOf<F['type']>
  : F extends MdmEnumField ? F['values'][number]['value']
  : F extends MdmObjectField
    ? F extends { fields: MdmFields } ? InferRecord<F['fields'], R>
      : F extends { of: infer V } ? (V extends keyof R ? InferRecord<R[V]['fields'], R> : never)
      : never
  : F extends MdmRecordField ? string
  : never;

type Wrapped<F extends MdmField, R extends Registry> =
  F extends { collection: true } ? ValueOf<F, R>[] : ValueOf<F, R>;

type Nulled<F extends MdmField, R extends Registry> =
  F extends { nullable: true } ? Wrapped<F, R> | null : Wrapped<F, R>;

type RequiredKeys<T extends MdmFields> = { [K in keyof T]: T[K] extends { required: true } ? K : never }[keyof T];
type OptionalKeys<T extends MdmFields> = Exclude<keyof T, RequiredKeys<T>>;

/** `InferRecord<typeof person.fields, typeof valueTypes>` = the record type of a Person. */
export type InferRecord<T extends MdmFields, R extends Registry = Record<never, never>> =
  { [K in RequiredKeys<T>]: Nulled<T[K], R> }
  & { [K in OptionalKeys<T>]?: Nulled<T[K], R> };
