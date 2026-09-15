/// <mls fileReference="_102034_/l1/mdm/defs/ontologyTypes.test.ts" enhancement="_blank" />
/**
 * Compile-time proof of the grammar: the record type is derived from the ontology, hierarchy included,
 * and a field or an enum value outside the ontology does not compile. Importing the emitted defs here is
 * also what puts `l4/ontology/` inside the backend program — the tsconfig globs cover `l1`, not `l4`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { AddressRecord, PersonRecord } from '/_102034_/l4/ontology/index.defs.js';
import { valueTypes } from '/_102034_/l4/ontology/index.defs.js';
import person from '/_102034_/l4/ontology/Person.defs.js';

const sample: PersonRecord = {
  id: '0000-mdmid-person',
  version: 3,
  details: {
    subtype: 'Person',
    name: 'Maria',
    status: 'Active',
    countryCode: 'BR',
    tags: ['agendaClinica.Paciente'],
    aliases: [],
    contacts: [{ mdmId: '0000-mdmid-contact', title: 'Mobile' }],
    createdAt: '2026-09-15T00:00:00Z',
    updatedAt: '2026-09-15T00:00:00Z',
    addresses: [{
      type: 'Residential',
      line1: 'Rua das Flores 100',
      countryCode: 'BR',
      isPrimary: true,
      geolocation: { lat: -23.5, lng: -46.6 },
    }],
    docType: 'CPF',
    docId: '12345678901',
    birthDate: '1990-01-01',
    relationshipRefs: { contacts: ['0000-mdmid-contact'], guardians: [] },
  },
};

// @ts-expect-error — a field outside the ontology does not compile.
const wrongField: PersonRecord = { ...sample, details: { ...sample.details, phone: '+55' } };
// @ts-expect-error — an enum value outside the declared domain does not compile.
const wrongEnum: AddressRecord = { type: 'Farm', line1: 'x', countryCode: 'BR', isPrimary: false };

test('the record type follows the ontology tree', () => {
  assert.equal(sample.details.addresses[0]?.geolocation?.lat, -23.5);
  assert.equal(sample.details.relationshipRefs?.contacts?.[0], '0000-mdmid-contact');
  void wrongField;
  void wrongEnum;
});

test('every `of` resolves to a declared value type', () => {
  const refs: string[] = [];
  const walk = (fields: Record<string, { type: string; of?: string; fields?: Record<string, unknown> }>) => {
    for (const field of Object.values(fields)) {
      if (field.of) refs.push(field.of);
      if (field.fields) walk(field.fields as typeof fields);
    }
  };
  walk(person.fields as never);
  for (const value of Object.values(valueTypes)) walk(value.fields as never);
  assert.ok(refs.length > 0, 'Person should reuse at least one value type');
  for (const ref of refs) assert.ok(ref in valueTypes, `unresolved value type ${ref}`);
});
