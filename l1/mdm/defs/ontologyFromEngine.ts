/// <mls fileReference="_102034_/l1/mdm/defs/ontologyFromEngine.ts" enhancement="_blank" />
/**
 * Builds the level-1 ontology of `l4/ontology/` from the engine, in the grammar of `ontologyTypes.ts`.
 *
 * Two inputs, kept apart on purpose:
 *  - **derived** — read from the engine and never hand-written: the subtype fields (`defs/ontology.ts`
 *    `*Detail`), the base document (`module.ts` `BaseMdmDetailRecord`), the relationship catalog and its
 *    compact keys (`mdmSupport.ts` `mapRelationshipKeys`), and which fields are index columns
 *    (`persistence.ts`). The drift test checks this half strictly.
 *  - **editorial** — `defs/ontologyEditorial.ts`: relationship roles, capability sentences with their
 *    measured status, rule texts, triggers, known divergences. None of it exists in any source.
 *
 * Values are imported, not parsed, wherever the engine exports a value; only TypeScript *types*
 * (`BaseMdmDetailRecord`, the `MdmSubtype`/`DocType`/`MdmStatus` unions, `mapRelationshipKeys`) still go
 * through the tested regex parsers of `level1FromEngine.ts`.
 */

import { tableDefinitions } from '/_102034_/l1/mdm/persistence.js';
import { MdmOntology, RelationshipCatalog } from '/_102034_/l1/mdm/defs/ontology.js';
import {
  parseEngineInterfaceFields,
  parseEngineRelationshipKeyMap,
  parseEngineTypeUnion,
  type CompactKeySides,
} from '/_102034_/l1/mdm/defs/level1FromEngine.js';
import {
  MDM_CAPABILITIES,
  MDM_KNOWN_DIVERGENCES,
  MDM_RELATIONSHIP_ROLES,
  MDM_RULES,
  MDM_TRIGGERS,
} from '/_102034_/l1/mdm/defs/ontologyEditorial.js';
import {
  MDM_ONTOLOGY_SCHEMA_VERSION,
  type MdmEntityArtifact,
  type MdmEntityRelationship,
  type MdmField,
  type MdmFields,
  type MdmOntologyIndexArtifact,
  type MdmRelationshipType,
  type MdmValueTypeArtifact,
} from '/_102034_/l1/mdm/defs/ontologyTypes.js';

/** The index table whose columns decide `layer: 'column'`. */
export const MDM_ENTITY_INDEX_TABLE = 'mdm_documents_entities_index';
export const MDM_PROSPECT_INDEX_TABLE = 'mdm_documents_prospects_index';
export const MDM_DOCUMENT_TABLE = 'mdm_documents';

/** Index columns the engine owns and that never appear inside the document. */
export const MDM_INDEX_ONLY_COLUMNS = ['searchVector', 'dynamoPk'] as const;

/** `mdmId` is the document key; in the grammar the record exposes it as the root field `id`. */
export const MDM_ID_COLUMN = 'mdmId';

/**
 * Keys of `BaseMdmDetailRecord` the builder does not map from their engine type: `namespaces` is computed
 * on read and never persisted, `moduleNamespace` is the index-signature slot, and `general` and
 * `relationshipRefs` are rebuilt below — `general` as an open object, `relationshipRefs` from the
 * relationship catalog, so each subtype carries only the compact keys it can actually receive.
 */
const BASE_KEYS_NOT_MAPPED = new Set(['namespaces', 'moduleNamespace', 'general', 'relationshipRefs']);

const SubtypeDetails = MdmOntology.entitySubtypes;

/**
 * GeoPoint materializes the inline `{ lat: number; lng: number }` of `Address.geolocation`: the engine has
 * no named type for it, and the grammar needs one so a module can reuse the coordinates by name.
 */
const GeoPoint = {
  description: 'A pair of geographic coordinates, embedded in an address.',
  fields: {
    lat: { type: 'number', description: 'Latitude in decimal degrees.' },
    lng: { type: 'number', description: 'Longitude in decimal degrees.' },
  },
} as const;

/** Value types of the platform, embedded in documents and reusable by modules. */
const VALUE_TYPE_SOURCES = {
  Address: MdmOntology.embeddedTypes.Address,
  GeoPoint,
  PrivacyConsent: MdmOntology.embeddedTypes.PrivacyConsent,
  ContactSummary: MdmOntology.embeddedTypes.ContactSummary,
} as const;

/** Engine type string → grammar field. Unmapped is an error: never silently `object`. */
export class MdmTypeUnmappedError extends Error {
  constructor(public readonly fieldId: string, public readonly engineType: string) {
    super(`MDM_LEVEL1_TYPE_UNMAPPED: field ${fieldId} has engine type ${engineType}`);
    this.name = 'MdmTypeUnmappedError';
  }
}

interface EngineField {
  fieldId: string;
  type: string;
  required: boolean;
  description?: string;
  constraints?: string;
}

interface MapContext {
  docTypes: readonly string[];
  statuses: readonly string[];
  subtypes: readonly string[];
  origin: 'nivel1' | 'derived';
  layer: 'column' | 'document';
  indexed?: boolean;
}

function titleOf(fieldId: string): string {
  const spaced = fieldId.replace(/([A-Z])/g, ' $1').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function enumValues(codes: readonly string[]): { value: string; title: string }[] {
  return codes.map(value => ({ value, title: value }));
}

/** `max 120 chars` → `{ maxLength: 120 }`; anything else is prose and stays in the description. */
function constraintsOf(text: string | undefined): { maxLength?: number } {
  const match = text?.match(/max\s+(\d+)\s+chars/);
  return match ? { maxLength: Number(match[1]) } : {};
}

export function mapEngineType(field: EngineField, context: MapContext): MdmField {
  const raw = field.type.trim();
  const optional = / \| null$/.test(raw);
  const bare = raw.replace(/ \| null$/, '').trim();
  const collection = bare.endsWith('[]');
  const core = collection ? bare.slice(0, -2).trim() : bare;
  const required = field.required && !optional;
  const base = {
    title: titleOf(field.fieldId),
    ...(field.description ? { description: field.description } : {}),
    required,
    ...(collection ? { collection: true as const } : {}),
    ...(optional ? { nullable: true as const } : {}),
    origin: context.origin,
    layer: context.layer,
  };
  const scalar = (type: 'string' | 'text' | 'integer' | 'number' | 'boolean' | 'date' | 'timestamp' | 'uuid'): MdmField => ({
    ...base,
    type,
    ...constraintsOf(field.constraints),
    ...(context.indexed ? { indexed: true } : {}),
  });

  // Literal union: 'A' | 'B' | 'C'
  if (/^'[^']*'(\s*\|\s*'[^']*')*$/.test(core)) {
    return { ...base, type: 'enum', values: enumValues([...core.matchAll(/'([^']*)'/g)].map(m => m[1])) };
  }
  switch (core) {
    case 'string': return scalar('string');
    case 'string (uuid)': return scalar('uuid');
    case 'string (ISO date)':
    case 'date': return scalar('date');
    case 'timestamp': return scalar('timestamp');
    case 'number': return scalar('number');
    case 'integer': return scalar('integer');
    case 'boolean': return scalar('boolean');
    case 'DocType': return { ...base, type: 'enum', values: enumValues(context.docTypes), ...(context.indexed ? { indexed: true } : {}) };
    case 'MdmStatus':
    case 'MdmStatus | MdmProspectStatus': return { ...base, type: 'enum', values: enumValues(context.statuses), ...(context.indexed ? { indexed: true } : {}) };
    case 'MdmSubtype': return { ...base, type: 'enum', values: enumValues(context.subtypes), ...(context.indexed ? { indexed: true } : {}) };
    case 'Address':
    case 'AddressValue': return { ...base, type: 'object', of: 'Address' };
    case 'PrivacyConsent':
    case 'PrivacyConsentValue': return { ...base, type: 'object', of: 'PrivacyConsent' };
    case 'ContactSummary':
    case 'ContactSummaryValue': return { ...base, type: 'object', of: 'ContactSummary' };
    case '{ lat: number; lng: number }': return { ...base, type: 'object', of: 'GeoPoint' };
    case 'Record<string, unknown>':
    case 'MdmGeneralNamespace': return { ...base, type: 'object', fields: {} };
    default: throw new MdmTypeUnmappedError(field.fieldId, field.type);
  }
}

function mapFields(fields: readonly EngineField[], context: MapContext): MdmFields {
  const out: Record<string, MdmField> = {};
  for (const field of fields) out[field.fieldId] = mapEngineType(field, context);
  return out;
}

function engineFieldsOf(source: { fields: Record<string, { type: string; required?: boolean; description?: string; constraints?: string }> }): EngineField[] {
  return Object.entries(source.fields).map(([fieldId, value]) => ({
    fieldId,
    type: value.type,
    required: value.required !== false,
    description: value.description,
    constraints: value.constraints,
  }));
}

function indexColumnFacts(): { columns: Set<string>; indexed: Set<string>; unique: Set<string> } {
  const table = tableDefinitions.find(item => item.tableName === MDM_ENTITY_INDEX_TABLE);
  if (!table) throw new Error(`persistence.ts has no table ${MDM_ENTITY_INDEX_TABLE}`);
  const indexed = new Set<string>();
  const unique = new Set<string>();
  for (const index of table.indexes ?? []) {
    for (const column of index.columns) {
      const name = typeof column === 'string' ? column : column.name;
      indexed.add(name);
      if ((index as { unique?: boolean }).unique) unique.add(name);
    }
  }
  return { columns: new Set(table.columns.map(column => column.name)), indexed, unique };
}

/** Not every `*Detail` declares `rules`; the consts are a union of literal shapes. */
function rulesOf(detail: object): readonly string[] {
  const rules = (detail as { rules?: readonly string[] }).rules;
  return rules ?? [];
}

function splitSubtypes(value: string, subtypes: readonly string[]): string[] {
  const trimmed = value.trim();
  if (trimmed === 'any') return [...subtypes];
  return trimmed.split('|').map(part => part.trim()).filter(Boolean);
}

function relationshipTypes(subtypes: readonly string[], keyMap: ReadonlyMap<string, CompactKeySides>): MdmRelationshipType[] {
  return RelationshipCatalog.entries.map(entry => {
    const keys = keyMap.get(entry.type);
    if (!keys) throw new Error(`mapRelationshipKeys has no case for ${entry.type}`);
    const roles = MDM_RELATIONSHIP_ROLES[entry.type];
    if (!roles) throw new Error(`ontologyEditorial has no roles entry for ${entry.type} (use [] when the type has none)`);
    return {
      type: entry.type,
      title: titleOf(entry.type),
      description: `Metadata example: ${entry.metadataExample}`,
      from: splitSubtypes(entry.from, subtypes),
      to: splitSubtypes(entry.to, subtypes),
      bidirectional: entry.bidirectional,
      roles,
      compactKeys: { from: keys.from, to: keys.to },
    } satisfies MdmRelationshipType;
  });
}

function relationshipsOf(subtype: string, catalog: readonly MdmRelationshipType[]): MdmEntityRelationship[] {
  const out: MdmEntityRelationship[] = [];
  for (const entry of catalog) {
    const isFrom = entry.from.includes(subtype);
    const isTo = entry.to.includes(subtype);
    if (!isFrom && !isTo) continue;
    const as = isFrom && isTo ? 'both' : isFrom ? 'from' : 'to';
    const otherSubtypes = as === 'from' ? entry.to : as === 'to' ? entry.from : [...new Set([...entry.from, ...entry.to])];
    const compactKeys = as === 'both'
      ? [...new Set([...entry.compactKeys.from, ...entry.compactKeys.to])]
      : as === 'from' ? [...entry.compactKeys.from] : [...entry.compactKeys.to];
    out.push({ type: entry.type, as, otherSubtypes, compactKeys });
  }
  return out;
}

/** `relationshipRefs` of a subtype: only the compact keys that subtype can actually receive. Derived. */
function relationshipRefsField(relationships: readonly MdmEntityRelationship[], subtypesByKey: ReadonlyMap<string, string[]>): MdmField {
  const fields: Record<string, MdmField> = {};
  for (const key of [...new Set(relationships.flatMap(item => item.compactKeys))].sort()) {
    fields[key] = {
      title: titleOf(key),
      description: 'Ids of the linked records. Derived by the engine from the active relationships.',
      required: false,
      collection: true,
      origin: 'derived',
      layer: 'document',
      type: 'record',
      to: subtypesByKey.get(key) ?? [],
    };
  }
  return {
    title: 'Relationship references',
    description: 'Compact keys the engine recomputes on every link and unlink. Never written by hand.',
    // Always present: the engine writes it on every record (`module.ts` BaseMdmDetailRecord).
    required: true,
    origin: 'derived',
    layer: 'document',
    type: 'object',
    fields,
  };
}

function compactKeyTargets(catalog: readonly MdmRelationshipType[]): ReadonlyMap<string, string[]> {
  const map = new Map<string, string[]>();
  const add = (key: string, targets: readonly string[]) => {
    const current = map.get(key) ?? [];
    map.set(key, [...new Set([...current, ...targets])]);
  };
  for (const entry of catalog) {
    for (const key of entry.compactKeys.from) add(key, entry.to);
    for (const key of entry.compactKeys.to) add(key, entry.from);
  }
  return map;
}

export interface MdmOntologyArtifacts {
  index: MdmOntologyIndexArtifact;
  entities: MdmEntityArtifact[];
  valueTypes: MdmValueTypeArtifact[];
}

export function buildMdmOntology(input: { ontologySource: string; moduleSource: string; supportSource: string }): MdmOntologyArtifacts {
  const subtypes = parseEngineTypeUnion(input.ontologySource, 'MdmSubtype');
  const docTypes = parseEngineTypeUnion(input.ontologySource, 'DocType');
  const statuses = parseEngineTypeUnion(input.ontologySource, 'MdmStatus');
  const keyMap = parseEngineRelationshipKeyMap(input.supportSource);
  const catalog = relationshipTypes(subtypes, keyMap);
  const keyTargets = compactKeyTargets(catalog);
  const facts = indexColumnFacts();
  const shared = { docTypes, statuses, subtypes };

  const valueTypes = Object.entries(VALUE_TYPE_SOURCES).map(([valueTypeId, source]) => ({
    schemaVersion: MDM_ONTOLOGY_SCHEMA_VERSION,
    kind: 'valueType' as const,
    valueTypeId,
    title: titleOf(valueTypeId),
    description: source.description,
    fields: mapFields(engineFieldsOf(source), { ...shared, origin: 'nivel1', layer: 'document' }),
  } satisfies MdmValueTypeArtifact));

  const baseFields = parseEngineInterfaceFields(input.moduleSource, 'BaseMdmDetailRecord')
    .filter(field => !BASE_KEYS_NOT_MAPPED.has(field.fieldId) && field.fieldId !== MDM_ID_COLUMN);

  const detailRuleIds = new Set<string>();
  for (const detail of Object.values(SubtypeDetails)) for (const rule of rulesOf(detail)) detailRuleIds.add(rule);
  const universalRules = Object.keys(MDM_RULES).filter(id => !detailRuleIds.has(id));

  const entities = subtypes.map(subtype => {
    const detail = SubtypeDetails[subtype as keyof typeof SubtypeDetails];
    if (!detail) throw new Error(`defs/ontology.ts has no ${subtype}Detail`);
    const relationships = relationshipsOf(subtype, catalog);
    const documentFields: Record<string, MdmField> = {};
    for (const field of baseFields) {
      const isColumn = facts.columns.has(field.fieldId);
      documentFields[field.fieldId] = mapEngineType(
        { ...field, description: undefined },
        {
          ...shared,
          origin: field.fieldId === 'tags' || field.fieldId === 'mergedInto' || field.fieldId === 'createdAt'
            || field.fieldId === 'updatedAt' || field.fieldId === 'status' || field.fieldId === 'subtype'
            || field.fieldId === 'contacts' || field.fieldId === 'relationshipRefs' ? 'derived' : 'nivel1',
          layer: isColumn ? 'column' : 'document',
          indexed: facts.indexed.has(field.fieldId),
        },
      );
    }
    // The record of a subtype carries that subtype and no other: the engine narrows it the same way
    // (`module.ts` `PersonDetailRecord.subtype: 'Person'`), and the drift test checks the two agree.
    documentFields.subtype = { ...documentFields.subtype, type: 'enum', values: [{ value: subtype, title: subtype }] } as MdmField;
    documentFields.relationshipRefs = relationshipRefsField(relationships, keyTargets);
    for (const [fieldId, field] of Object.entries(mapFields(engineFieldsOf(detail), { ...shared, origin: 'nivel1', layer: 'document' }))) {
      documentFields[fieldId] = field;
    }
    documentFields.general = {
      title: 'Organization fields',
      description: 'Fields the organization promoted because more than one module needed them. Schema in the project registry; a module reads it and does not declare it.',
      required: false,
      origin: 'nivel1',
      layer: 'document',
      type: 'object',
      fields: {},
    };

    const capabilities = Object.entries(MDM_CAPABILITIES)
      .filter(([, capability]) => !capability.appliesTo || capability.appliesTo.includes(subtype))
      .map(([id]) => id);

    return {
      schemaVersion: MDM_ONTOLOGY_SCHEMA_VERSION,
      kind: 'entity' as const,
      entityId: subtype,
      title: titleOf(subtype),
      description: detail.description,
      displayField: 'details.name',
      fields: {
        id: {
          title: 'Id', description: 'mdmId; stable from creation through promotion.', required: true,
          origin: 'derived', layer: 'column', type: 'uuid',
        },
        version: {
          title: 'Version', description: 'Bumped by the engine on every write; usable for optimistic concurrency.',
          required: true, origin: 'derived', layer: 'column', type: 'integer',
        },
        details: {
          title: 'Document',
          description: "The record as the engine stores and returns it. Identification fields are repeated as index columns. Two keys are reserved and not listed here: `general`, the organization layer, and one key per module id — `details['<moduleId>']: Record<moduleId, object>`, the module namespace, which only that module writes and other modules see by name only.",
          required: true, origin: 'nivel1', layer: 'document', type: 'object', fields: documentFields,
        },
      },
      relationships,
      capabilities,
      rules: [...rulesOf(detail), ...universalRules],
      triggers: MDM_TRIGGERS,
    } satisfies MdmEntityArtifact;
  });

  return {
    index: {
      schemaVersion: MDM_ONTOLOGY_SCHEMA_VERSION,
      title: 'Platform level 1 — master data',
      description: 'What the organization keeps once and every module reuses. One document per record; identification fields are also index columns. A module never copies a record: it declares a role over the subtype and writes its own namespace.',
      entities: subtypes,
      valueTypes: Object.keys(VALUE_TYPE_SOURCES),
      relationships: catalog,
      capabilities: MDM_CAPABILITIES,
      rules: MDM_RULES,
      statuses,
      docTypes,
      storage: {
        indexTable: MDM_ENTITY_INDEX_TABLE,
        prospectIndexTable: MDM_PROSPECT_INDEX_TABLE,
        documentTable: MDM_DOCUMENT_TABLE,
        documentColumn: 'details',
        reservedDocumentKeys: ['general', '<moduleId>'],
      },
      knownDivergences: MDM_KNOWN_DIVERGENCES,
    },
    entities,
    valueTypes,
  };
}
