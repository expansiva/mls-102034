/// <mls fileReference="_102034_/l1/mdm/defs/platformDetailKeys.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MDM_CATALOG_PLATFORM_DETAIL_KEYS,
  MDM_COMPUTED_DETAIL_KEYS,
  MDM_ENGINE_COMPAT_DETAIL_KEYS,
  MDM_PLATFORM_DETAIL_KEYS,
} from '/_102034_/l1/mdm/defs/platformDetailKeys.js';
import { MDM_GENERAL_NAMESPACE } from '/_102034_/l1/mdm/module.js';
import { mdm } from '/_102034_/l4/ontology/mdm.defs.js';

type FieldDef = { derived?: boolean };
type FieldGroup = { owner?: string; fields?: Record<string, FieldDef> };
type SubtypeDef = { fields?: Record<string, FieldDef> };

/** One catalog name and where the ontology declares it. The test does not keep its own name list. */
type CatalogProducers = Map<string, string[]>;

function addProducer(producers: CatalogProducers, name: string, producer: string): void {
  const existing = producers.get(name);
  if (existing) {
    existing.push(producer);
    return;
  }
  producers.set(name, [producer]);
}

/** Union of field names on platform-owned groups and on every subtype, derived included. */
function catalogDetailProducers(): CatalogProducers {
  const producers: CatalogProducers = new Map();
  for (const [groupName, group] of Object.entries(mdm.groups as Record<string, FieldGroup>)) {
    if (group.owner !== 'platform') {
      continue;
    }
    for (const fieldName of Object.keys(group.fields ?? {})) {
      addProducer(producers, fieldName, `group:${groupName}`);
    }
  }
  for (const [subtypeName, subtype] of Object.entries(mdm.subtypes as Record<string, SubtypeDef>)) {
    for (const fieldName of Object.keys(subtype.fields ?? {})) {
      addProducer(producers, fieldName, `subtype:${subtypeName}`);
    }
  }
  return producers;
}

function derivedCatalogNames(producers: CatalogProducers): string[] {
  const names: string[] = [];
  for (const group of Object.values(mdm.groups as Record<string, FieldGroup>)) {
    if (group.owner !== 'platform') {
      continue;
    }
    for (const [fieldName, field] of Object.entries(group.fields ?? {})) {
      if (field.derived === true && producers.has(fieldName)) {
        names.push(fieldName);
      }
    }
  }
  for (const subtype of Object.values(mdm.subtypes as Record<string, SubtypeDef>)) {
    for (const [fieldName, field] of Object.entries(subtype.fields ?? {})) {
      if (field.derived === true && producers.has(fieldName)) {
        names.push(fieldName);
      }
    }
  }
  return names;
}

/**
 * Leftovers that the contract does not already name.
 * Record `id` is the engine key `mdmId`. `details` and `version` are the document container.
 * Lifecycle extras, computed keys and `general` are the contract's own declarations.
 */
function unexplainedDiff(
  producers: CatalogProducers,
  catalogKeys: readonly string[],
  engineKeys: readonly string[],
  platformKeys: ReadonlySet<string>,
): string[] {
  const catalog = new Set(catalogKeys);
  const engine = new Set(engineKeys);
  const lines: string[] = [];

  for (const [name, sources] of producers) {
    if (!catalog.has(name) && !engine.has(name)) {
      lines.push(`catalog-only ${name} from ${sources.join(',')}`);
    }
  }
  for (const name of catalogKeys) {
    if (!producers.has(name)) {
      lines.push(`classifier-catalog ${name} has no ontology producer`);
    }
    if (engine.has(name)) {
      lines.push(`overlap ${name} is both catalog and engine-compat`);
    }
  }
  for (const name of engineKeys) {
    if (producers.has(name)) {
      lines.push(`engine-compat ${name} is also declared by ${producers.get(name)?.join(',')}`);
    }
  }
  const named = new Set<string>([...catalogKeys, ...engineKeys]);
  for (const name of platformKeys) {
    if (!named.has(name)) {
      lines.push(`platform-set ${name} is outside the two exported lists`);
    }
  }
  for (const name of named) {
    if (!platformKeys.has(name)) {
      lines.push(`exported-list ${name} is missing from MDM_PLATFORM_DETAIL_KEYS`);
    }
  }
  return lines;
}

test('platform detail keys match ontology belonging, with contract extras named once', () => {
  const producers = catalogDetailProducers();
  const recordFields = mdm.record.fields;

  assert.equal(typeof recordFields.id, 'object');
  assert.equal(typeof recordFields.version, 'object');
  assert.equal(typeof recordFields.details, 'object');
  assert.equal(MDM_ENGINE_COMPAT_DETAIL_KEYS.includes('mdmId'), true);
  assert.equal(MDM_PLATFORM_DETAIL_KEYS.has('id'), false);
  assert.equal(MDM_PLATFORM_DETAIL_KEYS.has('version'), false);
  assert.equal(MDM_PLATFORM_DETAIL_KEYS.has('details'), false);
  assert.equal(MDM_PLATFORM_DETAIL_KEYS.has(MDM_GENERAL_NAMESPACE), false);
  for (const computed of MDM_COMPUTED_DETAIL_KEYS) {
    assert.equal(MDM_PLATFORM_DETAIL_KEYS.has(computed), false);
  }

  for (const name of derivedCatalogNames(producers)) {
    assert.equal(MDM_PLATFORM_DETAIL_KEYS.has(name), true, `${name} belongs even when derived`);
    assert.equal(MDM_ENGINE_COMPAT_DETAIL_KEYS.includes(name as typeof MDM_ENGINE_COMPAT_DETAIL_KEYS[number]), false);
  }

  const documented = Object.values(mdm.knownDivergences).join('\n');
  for (const name of MDM_ENGINE_COMPAT_DETAIL_KEYS) {
    assert.equal(producers.has(name), false, `${name} is an engine extra, not a catalog field`);
    assert.equal(documented.includes(name), true, `${name} is not named in knownDivergences`);
  }

  const diff = unexplainedDiff(
    producers,
    MDM_CATALOG_PLATFORM_DETAIL_KEYS,
    MDM_ENGINE_COMPAT_DETAIL_KEYS,
    MDM_PLATFORM_DETAIL_KEYS,
  );
  assert.deepEqual(diff, [], diff.join('\n'));
});

test('parity fails when a platform field exists only on the catalog', () => {
  const producers = catalogDetailProducers();
  addProducer(producers, 'onlyOnCatalog', 'subtype:AssetVehicle');
  const diff = unexplainedDiff(
    producers,
    MDM_CATALOG_PLATFORM_DETAIL_KEYS,
    MDM_ENGINE_COMPAT_DETAIL_KEYS,
    MDM_PLATFORM_DETAIL_KEYS,
  );
  assert.equal(diff.some((line) => line.startsWith('catalog-only onlyOnCatalog from subtype:AssetVehicle')), true);
});

test('parity fails when a field of any subtype is removed from the classifier', () => {
  const producers = catalogDetailProducers();
  for (const [subtypeName, subtype] of Object.entries(mdm.subtypes as Record<string, SubtypeDef>)) {
    const fieldName = Object.keys(subtype.fields ?? {})[0];
    assert.ok(fieldName, `${subtypeName} declares a field`);
    const removed = MDM_CATALOG_PLATFORM_DETAIL_KEYS.filter((name) => name !== fieldName);
    const platform = new Set(MDM_PLATFORM_DETAIL_KEYS);
    platform.delete(fieldName);
    const diff = unexplainedDiff(producers, removed, MDM_ENGINE_COMPAT_DETAIL_KEYS, platform);
    assert.equal(
      diff.some((line) => line.startsWith(`catalog-only ${fieldName} from `) && line.includes(`subtype:${subtypeName}`)),
      true,
      fieldName,
    );
  }
});

test('parity fails when a classifier key is removed', () => {
  const producers = catalogDetailProducers();
  const removed = MDM_CATALOG_PLATFORM_DETAIL_KEYS.filter((name) => name !== 'vin');
  const platform = new Set(MDM_PLATFORM_DETAIL_KEYS);
  platform.delete('vin');
  const diff = unexplainedDiff(producers, removed, MDM_ENGINE_COMPAT_DETAIL_KEYS, platform);
  assert.equal(diff.some((line) => line.startsWith('catalog-only vin from ')), true);
});
