/// <mls fileReference="_102034_/l1/mdm/defs/mdmOntology.test.ts" enhancement="_blank" />
/**
 * Proof for `l4/ontology/mdm.defs.ts` — the one-file ontology (ns5_38).
 *
 * Importing it here is also what puts it inside the backend program: the tsconfig globs cover `l1`, not
 * `l4`, so `tsc` only ever sees an `l4` file through an import like this one (measured in ns5_37).
 *
 * The ontology is ONE JSON literal, so it has no `const` blocks to hang a `keyof typeof` on. The ids that
 * cross-reference each other are therefore checked here, against the object itself — still the compiler,
 * just in another file (ns5_38 C1).
 *
 * Deliberately narrow otherwise: comparing the ontology against `module.ts` is Wagner's analysis, not an
 * assertion here.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { tableDefinitions } from '/_102034_/l1/mdm/persistence.js';
import type { MdmSubtype } from '/_102034_/l1/mdm/defs/ontology.js';
import type { InferMdmRecord, MdmSubtypeName } from '/_102034_/l1/mdm/defs/ontologyTypes.js';
import { mdm } from '/_102034_/l4/ontology/mdm.defs.js';

// --- the cross-references, checked by the compiler --------------------------

type CapabilityId = keyof typeof mdm.capabilities;
type RuleId = keyof typeof mdm.rules;
type ValueTypeName = keyof typeof mdm.types;
type SubtypeName = keyof typeof mdm.subtypes;

const _personCapabilities: readonly CapabilityId[] = mdm.subtypes.Person.capabilities;
const _personRules: readonly RuleId[] = mdm.subtypes.Person.rules;
const _companyRules: readonly RuleId[] = mdm.subtypes.Company.rules;
const _contactRules: readonly RuleId[] = mdm.subtypes.ContactChannel.rules;
const _bankRules: readonly RuleId[] = mdm.subtypes.BankAccount.rules;
const _documentRules: readonly RuleId[] = mdm.subtypes.Document.rules;
const _addressesOf: ValueTypeName = mdm.groups.base.fields.addresses.of;
const _consentOf: ValueTypeName = mdm.subtypes.Person.fields.privacyConsent.of;
const _geoOf: ValueTypeName = mdm.types.Address.geolocation.of;
const _parentCompanyTo: readonly SubtypeName[] = mdm.subtypes.Company.fields.parentCompanyId.to;

// (d) The 13 subtypes of the ontology are the 13 the engine declares — both directions, so neither a
// missing subtype nor an invented one compiles.
const _noneMissing: Exclude<MdmSubtype, MdmSubtypeName> extends never ? true : false = true;
const _noneInvented: Exclude<MdmSubtypeName, MdmSubtype> extends never ? true : false = true;

// (c) The example document of the file header is a valid Person record.
type PersonRecord = InferMdmRecord<typeof mdm, 'Person'>;

const maria: PersonRecord = {
  id: '0000-mdmid-person',
  version: 3,
  details: {
    identification: {
      subtype: 'Person',
      name: 'Maria',
      status: 'Active',
      countryCode: 'BR',
      docType: 'CPF',
      docId: '12345678901',
      tags: ['agendaClinica.Paciente'],
      createdAt: '2026-09-15T00:00:00Z',
      updatedAt: '2026-09-15T00:00:00Z',
    },
    base: {
      moduleTypes: [],
      aliases: [],
      addresses: [{ type: 'Residential', line1: 'Av. Paulista 100', countryCode: 'BR', isPrimary: true, geolocation: { lat: -23.5, lng: -46.6 } }],
      contacts: [{ mdmId: '0000-mdmid-contact', title: 'Mobile' }],
      relationshipRefs: {},
    },
    person: { birthDate: '1990-01-01' },
    general: {},
    agendaClinica: { prontuario: 'PR-000123' },
  },
};

// The negative half. Each line must fail for the reason its comment claims.
// @ts-expect-error — a field that belongs to no branch of the ontology.
const strayField: PersonRecord['details']['identification'] = { ...maria.details.identification, phone: '+55' };
// @ts-expect-error — a value outside the declared domain.
const strayEnum: PersonRecord['details']['identification']['status'] = 'Archived';
// @ts-expect-error — a capability id that is in no catalog.
const strayCapability: CapabilityId = 'locate.byVibes';
// @ts-expect-error — a reusable type that does not exist.
const strayValueType: ValueTypeName = 'PostalAddress';

test('(a) the ontology satisfies its own grammar and every id resolves', () => {
  // Compiling is the assertion; these keep the bindings live at runtime.
  void _personCapabilities; void _personRules; void _companyRules; void _contactRules; void _bankRules;
  void _documentRules; void _addressesOf; void _consentOf; void _geoOf; void _parentCompanyTo;
  void _noneMissing; void _noneInvented; void strayField; void strayEnum; void strayCapability; void strayValueType;
  assert.equal(maria.details.person.birthDate, '1990-01-01');
});

test('the file is one JSON literal the defs extractor can read', () => {
  /*
   * This is the point of the single literal (C1): the screens, the agents and `tobe` read a defs file with
   * `extractNs4ClassicJsonObject` + `JSON.parse`, which understands no identifier, no single quote and no
   * comment. The algorithm below is that extractor: first `export const`, then balance braces, ignoring
   * anything inside a double-quoted string.
   */
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../l4/ontology/mdm.defs.ts'),
    'utf8',
  );
  const assignment = source.search(/export\s+const\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=/);
  const start = source.indexOf('{', Math.max(0, assignment));
  assert.ok(assignment >= 0 && start >= 0, 'no `export const` object to extract');
  let depth = 0;
  let inString = false;
  let escaped = false;
  let literal = '';
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) { literal = source.slice(start, index + 1); break; }
    }
  }
  assert.ok(literal, 'the object literal never closes');
  const parsed = JSON.parse(literal) as typeof mdm;
  assert.deepEqual(parsed, JSON.parse(JSON.stringify(mdm)), 'the parsed literal is not the exported object');
});

test('(d) the ontology declares the 13 subtypes, once each', () => {
  assert.equal(Object.keys(mdm.subtypes).length, 13);
  assert.equal(new Set(Object.keys(mdm.subtypes)).size, 13);
});

test('(e) the counts are the ones measured in ns5_37', () => {
  // 26 measured in ns5_37, plus the three the router exposes and the catalogue had missed:
  // `read.byId` (get/getMany/hydrateMany), `locate.byTag` (mdm.tag.findByTag) and `config.kv` (mdm_kv).
  assert.equal(Object.keys(mdm.capabilities).length, 29, 'capabilities');
  assert.equal(Object.keys(mdm.rules).length, 13, 'rules');
  assert.equal(mdm.relationships.length, 26, 'relationship types');
  assert.equal(new Set(mdm.relationships.map(item => item.type)).size, 26, 'duplicate relationship type');

  /*
   * The index table carries 9 indexes, and one of them is on `dynamoPk` — an engine internal that is no
   * field of the document. So `storage.indexedColumns` lists 8, and 8 + dynamoPk = the 9 real indexes.
   * Asserting both is what keeps that arithmetic honest instead of looking like a miscount.
   */
  const table = tableDefinitions.find(item => item.tableName === mdm.storage.indexTable);
  assert.ok(table, 'the index table named by storage does not exist');
  const realIndexes = new Set(
    (table.indexes ?? []).flatMap(index => index.columns.map(column => (typeof column === 'string' ? column : column.name))),
  );
  assert.equal(realIndexes.size, 9, 'persistence.ts no longer creates 9 indexes');
  assert.deepEqual([...mdm.storage.indexedColumns].sort(), [...realIndexes].filter(name => name !== 'dynamoPk').sort());

  // Every field of `identification` is really a column — that is what lets the branch give the layer.
  const columns = new Set(table.columns.map(column => column.name));
  for (const fieldId of Object.keys(mdm.groups.identification.fields)) {
    assert.ok(columns.has(fieldId), `identification.${fieldId} is not a column of ${mdm.storage.indexTable}`);
  }
});

test('the branches of `details` are the ones `record` announces', () => {
  const announced = mdm.record.fields.details.groups;
  const declared = Object.keys(mdm.groups);
  for (const branch of announced) {
    if (branch === '<subtype>') continue; // comes from subtypes.<S>.fields, one per record
    assert.ok(declared.includes(branch), `record announces the branch ${branch} and groups does not declare it`);
  }
  assert.deepEqual([...mdm.storage.reservedKeys].sort(), [...announced].sort());
  // An open branch declares no fields, and a closed one does.
  for (const [name, group] of Object.entries(mdm.groups)) {
    if ('open' in group) assert.ok(!('fields' in group), `${name} is open and still declares fields`);
    else assert.ok('fields' in group, `${name} is closed and declares no fields`);
  }
});

test('the catalogs point at things that exist', () => {
  const subtypeNames = new Set<string>(Object.keys(mdm.subtypes));
  for (const relationship of mdm.relationships) {
    for (const end of [...relationship.from, ...relationship.to]) {
      assert.ok(subtypeNames.has(end), `${relationship.type} points at unknown subtype ${end}`);
    }
  }
  // Nothing a subtype lists as its own delta may also be universal, or the reader sees it twice.
  for (const [name, subtype] of Object.entries(mdm.subtypes)) {
    for (const fieldId of Object.keys(subtype.fields)) {
      assert.ok(!(fieldId in mdm.groups.identification.fields), `${name}.${fieldId} repeats an identification field`);
      assert.ok(!(fieldId in mdm.groups.base.fields), `${name}.${fieldId} repeats a base field`);
    }
  }
});
