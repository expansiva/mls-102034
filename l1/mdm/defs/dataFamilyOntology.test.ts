/// <mls fileReference="_102034_/l1/mdm/defs/dataFamilyOntology.test.ts" enhancement="_blank" />
/**
 * Proof for `l4/ontology/tdm.defs.ts` and `l4/ontology/ddm.defs.ts` — the catalog a table of a module
 * starts from (ns5_46), the way `mdmOntology.test.ts` is the proof of the platform record.
 *
 * Importing them here is also what puts them inside the backend program: the tsconfig globs cover `l1`,
 * not `l4`, so `tsc` only ever sees an `l4` file through an import like this one (measured in ns5_37).
 *
 * Both files are ONE JSON literal, so there is no `const` block inside them to hang a `keyof typeof` on.
 * What crosses the two catalogs — a capability the table borrows from the platform has to be a
 * capability the platform declares — is checked here, against the objects themselves.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import type { DataFamilyName, DataFamilyOntology } from '/_102034_/l1/mdm/defs/ontologyTypes.js';
import { ddm } from '/_102034_/l4/ontology/ddm.defs.js';
import { mdm } from '/_102034_/l4/ontology/mdm.defs.js';
import { tdm } from '/_102034_/l4/ontology/tdm.defs.js';

// --- the cross-references, checked by the compiler --------------------------

type TdmCapabilityId = keyof typeof tdm.capabilities;
type DdmCapabilityId = keyof typeof ddm.capabilities;

/** The two ids the fan-out and the gate name by hand; a rename here is a compile error there. */
const _sequence: TdmCapabilityId = 'sequence.next';
const _statusHistory: TdmCapabilityId = 'statusHistory.read';
const _aggregate: DdmCapabilityId = 'aggregate.byWindow';

// @ts-expect-error — a capability id that is in no catalog.
const _strayTdm: TdmCapabilityId = 'locate.byVibe';
// @ts-expect-error — a family that does not exist.
const _strayFamily: DataFamilyName = 'xdm';

const CATALOGS: ReadonlyArray<readonly [DataFamilyName, DataFamilyOntology]> = [
  ['tdm', tdm],
  ['ddm', ddm],
];

test('both catalogs satisfy the grammar and declare the family their file is named after', () => {
  void _sequence; void _statusHistory; void _aggregate; void _strayTdm; void _strayFamily;
  for (const [name, catalog] of CATALOGS) {
    assert.equal(catalog.family, name);
    assert.ok(catalog.schemaVersion.includes(name), `${name}: the schemaVersion does not name the family`);
    assert.ok(catalog.description.length > 40, `${name}: no description`);
    assert.ok(catalog.recommendations.length >= 5, `${name}: too few recommendations to be a starting point`);
    assert.ok(Object.keys(catalog.record.fields).length >= 3, `${name}: the record declares almost nothing`);
    assert.ok(Object.keys(catalog.storage).length > 0, `${name}: nothing said about where the rows live`);
    assert.ok(Object.keys(catalog.knownDivergences).length > 0, `${name}: no divergence listed, which is never true`);
  }
});

test('every capability is measured: a sentence, a source, a status and the evidence', () => {
  for (const [name, catalog] of CATALOGS) {
    const ids = Object.keys(catalog.capabilities);
    assert.ok(ids.length >= 8, `${name}: ${ids.length} capabilities is not a catalog`);
    for (const [id, capability] of Object.entries(catalog.capabilities)) {
      const where = `${name}.${id}`;
      assert.match(id, /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)?$/, `${where}: the id is not <lowerCamel>[.<lowerCamel>]`);
      // Three parts at least: what it does · how · who uses it.
      assert.ok(capability.sentence.split('·').length >= 3, `${where}: the sentence does not say what, how and who`);
      assert.ok(capability.evidence.trim().length > 0, `${where}: no evidence`);
      // Evidence is a place someone can open: a file, or a section of the implementation map.
      assert.match(capability.evidence, /\.ts:\d+|\.md §\d+|contracts\.ts|persistence\.ts/u, `${where}: the evidence names no file`);
      if (capability.platform !== 'ready') {
        assert.ok(
          capability.sentence.length > 120,
          `${where}: what is not ready has to say what is missing, in the sentence the model reads`,
        );
      }
    }
  }
});

test('what a table borrows from the platform is a capability the platform declares', () => {
  const platform = new Set(Object.keys(mdm.capabilities));
  const borrowed: string[] = [];
  for (const [name, catalog] of CATALOGS) {
    for (const [id, capability] of Object.entries(catalog.capabilities)) {
      if (capability.source !== 'platform') continue;
      borrowed.push(`${name}.${id}`);
      if (id === 'read.mdmRecord') continue; // the module side of `read.byId`, named for what it reads
      assert.ok(platform.has(id), `${name}.${id} is borrowed from the platform and is not in mdm.capabilities`);
    }
  }
  assert.ok(borrowed.length >= 6, 'no platform capability is lent to a table, which cannot be right');
});

test('the three families are disjoint where it matters, and ddm has no writer', () => {
  // A derived table never borrows a writing capability, and never declares one of its own.
  for (const [id, capability] of Object.entries(ddm.capabilities)) {
    assert.ok(
      !/^(create|update|delete|transition)/u.test(id),
      `ddm declares '${id}': a derived table has no writer`,
    );
    void capability;
  }
  // The transactional table does declare them: that is the difference between the two families.
  for (const id of ['create', 'update', 'delete', 'transition']) {
    assert.ok(id in tdm.capabilities, `tdm does not declare '${id}'`);
  }
  assert.ok(
    ddm.recommendations.some(line => line.includes('derived')),
    'ddm does not say that every field is derived',
  );
});

test('both files are one JSON literal the defs extractor can read', () => {
  /*
   * Same point as `mdmOntology.test.ts`: the screens, the agents and `tobe` read a defs file with
   * `extractNs4ClassicJsonObject` + `JSON.parse`, which understands no identifier, no single quote and
   * no comment. The algorithm below is that extractor.
   */
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const [name, catalog] of CATALOGS) {
    const source = readFileSync(path.join(here, `../../../l4/ontology/${name}.defs.ts`), 'utf8');
    const assignment = source.search(/export\s+const\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=/);
    const start = source.indexOf('{', Math.max(0, assignment));
    assert.ok(assignment >= 0 && start >= 0, `${name}: no \`export const\` object to extract`);
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
    assert.ok(literal, `${name}: the object literal never closes`);
    assert.deepEqual(
      JSON.parse(literal),
      JSON.parse(JSON.stringify(catalog)),
      `${name}: the parsed literal is not the exported object`,
    );
  }
});
