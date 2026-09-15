/// <mls fileReference="_102034_/l1/mdm/scripts/emitOntology.test.ts" enhancement="_blank" />
/**
 * Drift test of the level-1 ontology: what `l4/ontology/` holds must be what the emitter produces from the
 * engine today, and the shapes the engine keeps in four places must still agree (`mdmImplementation.md` §9).
 *
 * Importing the emitted defs here is also what puts them inside the backend program: the tsconfig globs
 * cover `l1`, not `l4`, so `tsc` only sees an `l4` file through an import like these.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { tableDefinitions } from '/_102034_/l1/mdm/persistence.js';
import {
  MDM_ENTITY_INDEX_TABLE,
  MDM_ID_COLUMN,
  MDM_INDEX_ONLY_COLUMNS,
} from '/_102034_/l1/mdm/defs/ontologyFromEngine.js';
import { MDM_KNOWN_DIVERGENCES } from '/_102034_/l1/mdm/defs/ontologyEditorial.js';
import { parseEngineInterfaceFields, parseEngineTypeUnion } from '/_102034_/l1/mdm/defs/level1FromEngine.js';
import type { MdmField, MdmFields } from '/_102034_/l1/mdm/defs/ontologyTypes.js';
import type { PersonDetailRecord } from '/_102034_/l1/mdm/module.js';
import {
  ontologyEnginePaths,
  readOntologyArtifacts,
  renderOntologyFiles,
} from '/_102034_/l1/mdm/scripts/emitOntology.js';
import type { PersonRecord } from '/_102034_/l4/ontology/index.defs.js';
import { mdmOntologyIndex, valueTypes } from '/_102034_/l4/ontology/index.defs.js';
import mdmEntityPerson from '/_102034_/l4/ontology/Person.defs.js';

const MDM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(fields: MdmFields, visit: (fieldId: string, field: MdmField) => void): void {
  for (const [fieldId, field] of Object.entries(fields)) {
    visit(fieldId, field);
    if (field.type === 'object' && field.fields) walk(field.fields, visit);
  }
}

test('what is on disk is what the emitter produces from the engine today', async () => {
  const artifacts = await readOntologyArtifacts(MDM_ROOT);
  const { outDir } = ontologyEnginePaths(MDM_ROOT);
  for (const file of renderOntologyFiles(artifacts)) {
    const onDisk = readFileSync(path.join(outDir, file.fileName), 'utf8');
    assert.equal(onDisk, file.source, `${file.fileName} drifted — run scripts/emitOntology.ts`);
  }
});

test('(a) every `of` resolves to a value type and every `record.to` to an entity', async () => {
  const artifacts = await readOntologyArtifacts(MDM_ROOT);
  const entityIds = new Set(artifacts.index.entities);
  const valueTypeIds = new Set(artifacts.index.valueTypes);
  for (const entity of artifacts.entities) {
    walk(entity.fields, (fieldId, field) => {
      if (field.type === 'object' && field.of) {
        assert.ok(valueTypeIds.has(field.of), `${entity.entityId}.${fieldId} points at unknown value type ${field.of}`);
      }
      if (field.type === 'record') {
        for (const target of field.to) {
          assert.ok(entityIds.has(target), `${entity.entityId}.${fieldId} points at unknown entity ${target}`);
        }
      }
    });
  }
  for (const valueType of artifacts.valueTypes) {
    walk(valueType.fields, (fieldId, field) => {
      if (field.type === 'object' && field.of) {
        assert.ok(valueTypeIds.has(field.of), `${valueType.valueTypeId}.${fieldId} points at unknown value type ${field.of}`);
      }
    });
  }
  // Every relationship a subtype declares exists in the catalog of the index.
  const catalogTypes = new Set(artifacts.index.relationships.map(item => item.type));
  for (const entity of artifacts.entities) {
    for (const relationship of entity.relationships) {
      assert.ok(catalogTypes.has(relationship.type), `${entity.entityId} declares unknown relationship ${relationship.type}`);
    }
  }
});

test('(b) `layer: column` is backed by the index table, and every subtype keeps the identification core', async () => {
  const artifacts = await readOntologyArtifacts(MDM_ROOT);
  const table = tableDefinitions.find(item => item.tableName === MDM_ENTITY_INDEX_TABLE);
  assert.ok(table, `persistence.ts has no ${MDM_ENTITY_INDEX_TABLE}`);
  // `mdmId` is the root field `id`; searchVector and dynamoPk are engine internals with no document key.
  const available = new Set(
    table.columns
      .map(column => column.name)
      .filter(name => name !== MDM_ID_COLUMN && !(MDM_INDEX_ONLY_COLUMNS as readonly string[]).includes(name)),
  );
  /*
   * Two different assertions, because the design rule is not an equality. A field is `layer: 'column'` only
   * when a column exists to hold it, so the invariant upwards is CONTAINMENT: no artifact may promote a
   * field the index table cannot store. Equality would be wrong the day a subtype promotes one of its own
   * fields — which is exactly what `locate.byDocumentField` is waiting for. What every subtype must still
   * carry is the identification core the engine declares on `BaseMdmDetailRecord`; that is the downward
   * invariant, and it is the one Part B's copy-and-personalize can break.
   */
  const moduleSource = readFileSync(path.join(MDM_ROOT, 'module.ts'), 'utf8');
  const core = parseEngineInterfaceFields(moduleSource, 'BaseMdmDetailRecord')
    .map(field => field.fieldId)
    .filter(fieldId => available.has(fieldId));
  assert.ok(core.length > 0, 'BaseMdmDetailRecord and the index table share no field');

  for (const entity of artifacts.entities) {
    const columns = new Set<string>();
    const details = entity.fields.details;
    assert.ok(details.type === 'object' && details.fields, `${entity.entityId} has no details tree`);
    walk(details.fields, (fieldId, field) => {
      if (field.layer === 'column') columns.add(fieldId);
    });
    for (const fieldId of columns) {
      assert.ok(available.has(fieldId), `${entity.entityId}.${fieldId} is layer: column, but ${MDM_ENTITY_INDEX_TABLE} has no such column`);
    }
    for (const fieldId of core) {
      assert.ok(columns.has(fieldId), `${entity.entityId} lost the identification column ${fieldId}`);
    }
    assert.equal(entity.fields.id?.layer, 'column');
    assert.equal(entity.fields.version?.layer, 'column');
  }

  // `storage` is the only part of the index artifact that names physical tables, and its reader is the
  // ontology skill Part B injects — prose in a prompt, which no compiler checks. So check it here: a table
  // renamed in persistence.ts must not leave the artifact pointing at a name that no longer exists.
  const tableNames = new Set(tableDefinitions.map(item => item.tableName));
  for (const [key, value] of Object.entries(mdmOntologyIndex.storage)) {
    if (key === 'documentColumn' || key === 'reservedDocumentKeys') continue;
    assert.ok(tableNames.has(value as string), `storage.${key} names ${String(value)}, which persistence.ts does not define`);
  }
});

test('(b2) `indexed` and `unique` say only what persistence.ts really creates', async () => {
  const artifacts = await readOntologyArtifacts(MDM_ROOT);
  const table = tableDefinitions.find(item => item.tableName === MDM_ENTITY_INDEX_TABLE);
  assert.ok(table);
  const indexedColumns = new Set(
    (table.indexes ?? []).flatMap(index => index.columns.map(column => (typeof column === 'string' ? column : column.name))),
  );
  const details = mdmEntityPerson.fields.details;
  assert.ok(details.type === 'object' && details.fields);
  walk(details.fields as MdmFields, (fieldId, field) => {
    if (field.indexed) assert.ok(indexedColumns.has(fieldId), `${fieldId} claims an index persistence.ts does not create`);
    // No unique index exists on the entity index table today, so no field may claim uniqueness.
    assert.equal(field.unique, undefined, `${fieldId} claims uniqueness; the index table has no unique index`);
  });
});

/**
 * (c) A universal witness, not a literal: the claim is over the TYPES, so it must hold for every Person
 * record, not just for one object that happens to satisfy both. A literal would prove almost nothing here —
 * `BaseMdmDetailRecord` carries `[moduleNamespace: string]: unknown`, so a hand-written object that omits
 * ontology fields still lands in it. This is the binding the four copies of the shape never had
 * (`mdmImplementation.md` §9), and it is one-directional by measurement: see the reverse below.
 */
declare const anyPerson: PersonRecord;

/** Never called: `tsc` is the whole assertion, and `anyPerson` does not exist at runtime. */
function personOntologyMatchesEngine(): void {
  const asEngine: PersonDetailRecord = { mdmId: anyPerson.id, ...anyPerson.details };

  // The reverse does not hold, and that is structural, not drift: the index signature above admits keys the
  // ontology does not declare. If the engine ever closes that signature this line starts failing and the
  // ontology becomes the single shape in both directions.
  // @ts-expect-error — engine record is wider than the ontology document.
  const asOntology: PersonRecord['details'] = {} as PersonDetailRecord;
  void asEngine;
  void asOntology;
}

test('(c) the Person record derived from the ontology matches the engine interface', () => {
  // This file compiling IS the check — `tsc` sees `l4/ontology/` only through the imports above.
  assert.equal(typeof personOntologyMatchesEngine, 'function');
});

test('(d) the compact keys are the ones the engine declares', async () => {
  const artifacts = await readOntologyArtifacts(MDM_ROOT);
  const moduleSource = readFileSync(path.join(MDM_ROOT, 'module.ts'), 'utf8');
  const declared = new Set(parseEngineTypeUnion(moduleSource, 'CompactRelationshipRefKey'));
  const used = new Set(artifacts.index.relationships.flatMap(item => [...item.compactKeys.from, ...item.compactKeys.to]));
  for (const key of used) assert.ok(declared.has(key), `compact key ${key} is not in CompactRelationshipRefKey`);
  // And what each subtype exposes in relationshipRefs is a subset of its own relationships' keys.
  for (const entity of artifacts.entities) {
    const details = entity.fields.details;
    assert.ok(details.type === 'object' && details.fields);
    const refs = details.fields.relationshipRefs;
    assert.ok(refs.type === 'object' && refs.fields, `${entity.entityId} has no relationshipRefs`);
    const own = new Set(entity.relationships.flatMap(item => item.compactKeys));
    for (const key of Object.keys(refs.fields)) {
      assert.ok(own.has(key), `${entity.entityId}.relationshipRefs.${key} belongs to no relationship of this subtype`);
    }
  }
});

test('(e) the known divergences are listed, not silently fixed', () => {
  // The first eight are the ones mdmImplementation.md §9 names, one for one.
  const fromSection9 = [
    'address-value', 'privacy-consent-value', 'contact-summary-value', 'compact-relationship-refs-count',
    'doc-unique-missing', 'search-vector-type', 'relationship-documents-table', 'service-defs-case',
  ];
  const ids = MDM_KNOWN_DIVERGENCES.map(item => item.id);
  for (const id of fromSection9) assert.ok(ids.includes(id), `divergence ${id} of §9 is not listed`);
  assert.equal(new Set(ids).size, ids.length, 'duplicate divergence id');
  assert.deepEqual(mdmOntologyIndex.knownDivergences.map(item => item.id), ids, 'the emitted index lost a divergence');
  // The catalog is still honest about what it cannot do.
  assert.ok(Object.values(mdmOntologyIndex.capabilities).some(item => item.platform === 'missing'));
  assert.ok(Object.values(mdmOntologyIndex.rules).some(item => item.platform === 'missing'));
});

test('the value type registry covers every `of` target', () => {
  assert.deepEqual(Object.keys(valueTypes).sort(), [...mdmOntologyIndex.valueTypes].sort());
});
