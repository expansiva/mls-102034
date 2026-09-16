/// <mls fileReference="_102034_/l1/mdm/defs/ontologyTypes.ts" enhancement="_blank" />
/**
 * The grammar of the platform ontology — the types `l4/ontology/mdm.defs.ts` is written against, and that
 * `l2/mdm/resolveMdmEntity.ts` and the module ontology of `mls-102035/l2/solution/types.ts` read.
 *
 * A record is `{ id, version, details }`, mirroring `mdm_documents`: `id` and `version` are columns and
 * `details` is the JSONB document, laid out as a map of branches — `identification` (the fields that are
 * also columns of the index table), `base` (common to every subtype), `<subtype>` (exactly one per
 * record), `general` (the organization) and `<moduleId>` (the module namespace). The base is declared
 * ONCE, instead of being repeated in each of the 13 subtypes.
 *
 * Defaults are omitted, not written: `required: false`, `nullable: false`, `title` equal to the id, and
 * the layer — which the branch already gives, since `identification` is a column and every other branch
 * lives in the document.
 *
 * `InferMdmRecord` derives the runtime type of a record from the ontology data, so `tsc` keeps code and
 * ontology on one shape instead of a hand-written interface that drifts.
 */

/** The scalar forms a field may take. */
export type MdmScalarKind =
  | 'string' | 'text' | 'integer' | 'number' | 'money' | 'boolean' | 'date' | 'timestamp' | 'uuid';

export type MdmValueTypeName = 'Address' | 'GeoPoint' | 'PrivacyConsent' | 'ContactSummary';

export type MdmSubtypeName =
  | 'Person' | 'Company' | 'ContactChannel' | 'Animal' | 'Product' | 'Service' | 'Location'
  | 'BankAccount' | 'Document' | 'AssetGeneric' | 'AssetVehicle' | 'AssetProperty' | 'AssetEquipment';

/**
 * A field of the closed form. Absent flag = the default; `type` plus its own constraints carry everything,
 * so a constraint is never prose. `of` names a reusable type, `to` a record this one points at — both
 * checked by the compiler because they are unions of the declared names, not `string`.
 */
export interface MdmDefField {
  type: MdmScalarKind | 'enum' | 'object' | 'record';
  required?: true;
  nullable?: true;
  collection?: true;
  /** A reusable type of `types`. */
  of?: MdmValueTypeName;
  /** Subtypes this field may point at. */
  to?: readonly MdmSubtypeName[];
  /** Closed domain. Plain strings when the label is the code itself. */
  values?: readonly string[];
  /** Inline object. */
  fields?: MdmDefFields;
  maxLength?: number;
  pattern?: string;
  min?: number;
  max?: number;
  default?: string | number | boolean;
  /** On `details` only: the branches the document is split into. */
  groups?: readonly string[];
  unique?: true;
  /** Backed by a real index today (a column of `identification` without it is a column with no index). */
  indexed?: true;
  /** The engine writes it; no form and no tool schema ever asks for it. */
  derived?: true;
  /** Only when it differs from the id. */
  title?: string;
  description?: string;
}

export type MdmDefFields = Readonly<Record<string, MdmDefField>>;

/** Catalog entry. `from`/`to` are subtype names, so a typo is a compile error and not a dead link. */
export interface MdmDefRelationship {
  type: string;
  title: string;
  description: string;
  from: readonly MdmSubtypeName[];
  to: readonly MdmSubtypeName[];
  bidirectional: boolean;
  /** Values `mdm_relationship.role` accepts for this type. Empty when the type has no meaningful role. */
  roles: readonly string[];
  /** Keys the engine writes on each side's `relationshipRefs`, derived from `mapRelationshipKeys`. */
  compactKeys: { from: readonly string[]; to: readonly string[] };
}

/**
 * One branch of `details`. `open: true` means the key set is not closed here: `general` is declared by the
 * organization in the project registry, and each module declares its own namespace in its own ontology.
 */
export interface MdmDefGroup {
  type: 'object';
  owner: 'platform' | 'organization' | 'module';
  description: string;
  fields?: MdmDefFields;
  open?: true;
}

/**
 * A subtype carries only its DELTA: its own fields, and the capabilities and rules that are not universal.
 * The ids are plain strings here and are checked against the catalogs of the ontology object itself, in
 * `mdmOntology.test.ts` — the file is one JSON literal, so there is no `keyof typeof` to lean on inside it.
 */
export interface MdmSubtypeDef {
  title?: string;
  description: string;
  fields: MdmDefFields;
  /** Only what does NOT apply to every subtype. */
  capabilities?: readonly string[];
  /** Only what does NOT apply to every subtype. */
  rules?: readonly string[];
}

export interface MdmOntology {
  schemaVersion: string;
  /** The three columns of `mdm_documents`, as fields, plus what a screen shows to recognise the record. */
  record: {
    fields: MdmDefFields;
    displayField: string;
  };
  types: Readonly<Record<MdmValueTypeName, MdmDefFields>>;
  /** The branches of `details`: `identification`, `base`, `general` and `<moduleId>`. The subtype branch
   * is not here — it comes from `subtypes.<S>.fields`, one per record. */
  groups: Readonly<Record<string, MdmDefGroup>>;
  subtypes: Readonly<Record<MdmSubtypeName, MdmSubtypeDef>>;
  relationships: readonly MdmDefRelationship[];
  /** id → one sentence: what it does · how · who uses it · platform: ready|partial|missing. */
  capabilities: Readonly<Record<string, string>>;
  /** id → one sentence: what is always true · who enforces it · platform. */
  rules: Readonly<Record<string, string>>;
  statuses: readonly string[];
  docTypes: readonly string[];
  storage: {
    indexTable: string;
    prospectIndexTable: string;
    documentTable: string;
    documentColumn: string;
    /** Document-visible columns that carry a real index today. */
    indexedColumns: readonly string[];
    reservedKeys: readonly string[];
  };
  /** id → what the engine does today where it differs from this document. Listed, never hidden. */
  knownDivergences: Readonly<Record<string, string>>;
}

// --- the record type, derived from the ontology object ---------------------

type ScalarOf<K extends MdmScalarKind> =
  K extends 'string' | 'text' | 'date' | 'timestamp' | 'uuid' ? string
  : K extends 'integer' | 'number' | 'money' ? number
  : K extends 'boolean' ? boolean
  : never;

type DefValue<F extends MdmDefField, O extends MdmOntology> =
  F extends { type: 'enum' } ? (F extends { values: readonly (infer V)[] } ? V : string)
  : F extends { type: 'record' } ? string
  : F extends { type: 'object' }
    ? F extends { fields: MdmDefFields } ? InferGroup<F['fields'], O>
      : F extends { of: infer V extends MdmValueTypeName } ? InferGroup<O['types'][V], O>
      : object
  : F extends { type: infer K extends MdmScalarKind } ? ScalarOf<K>
  : never;

type DefWrapped<F extends MdmDefField, O extends MdmOntology> =
  F extends { collection: true } ? DefValue<F, O>[] : DefValue<F, O>;
type DefNulled<F extends MdmDefField, O extends MdmOntology> =
  F extends { nullable: true } ? DefWrapped<F, O> | null : DefWrapped<F, O>;

type DefRequiredKeys<T extends MdmDefFields> =
  { [K in keyof T]: T[K] extends { required: true } ? K : never }[keyof T];
type DefOptionalKeys<T extends MdmDefFields> = Exclude<keyof T, DefRequiredKeys<T>>;

/** One group of `details` as a runtime object. */
export type InferGroup<T extends MdmDefFields, O extends MdmOntology> =
  { [K in DefRequiredKeys<T>]: DefNulled<T[K], O> }
  & { [K in DefOptionalKeys<T>]?: DefNulled<T[K], O> };

/**
 * The record of one subtype: `{ id, version, details }`, `details` grouped. The subtype group is keyed by
 * the subtype name with a lowercase first letter (`Person` → `person`, `AssetVehicle` → `assetVehicle`),
 * and any other key is a module namespace — an object only that module writes.
 */
type GroupFields<O extends MdmOntology, K extends string> =
  O['groups'][K] extends { fields: infer F extends MdmDefFields } ? F : MdmDefFields;

export type InferMdmRecord<O extends MdmOntology, S extends MdmSubtypeName> = {
  id: string;
  version: number;
  details:
    & { identification: InferGroup<GroupFields<O, 'identification'>, O> }
    & { base: InferGroup<GroupFields<O, 'base'>, O> }
    & { [K in Uncapitalize<S>]: InferGroup<O['subtypes'][S]['fields'], O> }
    & { general?: object }
    & { [moduleId: string]: object };
};
