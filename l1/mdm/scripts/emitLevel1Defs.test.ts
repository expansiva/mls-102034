/// <mls fileReference="_102034_/l1/mdm/scripts/emitLevel1Defs.test.ts" enhancement="_blank" />

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MdmPlatformCatalog } from '/_102034_/l1/mdm/defs/platform.js';
import type { MdmPlatformCatalogArtifact } from '/_102034_/l1/mdm/defs/level1Types.js';
import {
  buildLevel1Artifacts,
  parseEngineInterfaceFields,
  parseEngineTypeUnion,
  renderLevel1DefFiles,
} from '/_102034_/l1/mdm/defs/level1FromEngine.js';
import { NS4_LEVEL1_IDENTIFICATION_FIELD_IDS } from '/_102034_/l1/mdm/defs/level1FromEngine.js';
import type {
  Ns4Level1EntityArtifact,
  Ns4Level1IndexArtifact,
} from '/_102034_/l1/mdm/defs/level1Types.js';

function parseDefsSource<T>(source: string): T {
  const assignment = source.search(/export\s+const\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=/);
  const start = source.indexOf('{', Math.max(0, assignment));
  if (assignment < 0 || start < 0) throw new Error('defs object not found');
  let depth = 0;
  let inString = false;
  let escaped = false;
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
      if (depth === 0) return JSON.parse(source.slice(start, index + 1)) as T;
    }
  }
  throw new Error('unclosed defs object');
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MDM_ROOT = path.resolve(HERE, '..');
const DEFS_DIR = path.resolve(MDM_ROOT, '../../l4/organization/ontology');

function engineSources(): { ontologySource: string; moduleSource: string; supportSource: string } {
  return {
    ontologySource: readFileSync(path.join(MDM_ROOT, 'defs/ontology.ts'), 'utf8'),
    moduleSource: readFileSync(path.join(MDM_ROOT, 'module.ts'), 'utf8'),
    supportSource: readFileSync(path.join(MDM_ROOT, 'layer_3_usecases/mdmSupport.ts'), 'utf8'),
  };
}

test('level-1 defs on disk match a fresh emit from the engine source', () => {
  const sources = engineSources();
  const artifacts = buildLevel1Artifacts(sources);
  const files = renderLevel1DefFiles({ artifacts, platform: MdmPlatformCatalog as MdmPlatformCatalogArtifact });
  const engineSubtypes = parseEngineTypeUnion(sources.ontologySource, 'MdmSubtype');
  assert.equal(engineSubtypes.length, 13);
  assert.deepEqual(artifacts.index.subtypes, engineSubtypes);

  const onDisk = readdirSync(DEFS_DIR).filter(name => name.endsWith('.defs.ts')).sort();
  assert.deepEqual(onDisk, files.map(file => file.fileName).sort());

  for (const file of files) {
    const disk = readFileSync(path.join(DEFS_DIR, file.fileName), 'utf8');
    assert.equal(disk, file.source, file.fileName);
  }

  const index = parseDefsSource<Ns4Level1IndexArtifact>(
    readFileSync(path.join(DEFS_DIR, 'index.defs.ts'), 'utf8'),
  );
  assert.ok(index);
  assert.deepEqual(index, artifacts.index);

  for (const subtype of engineSubtypes) {
    const written = parseDefsSource<Ns4Level1EntityArtifact>(
      readFileSync(path.join(DEFS_DIR, `${subtype}.defs.ts`), 'utf8'),
    );
    const built = artifacts.entities.find(entity => entity.subtype === subtype);
    assert.ok(written, `missing defs for ${subtype}`);
    assert.ok(built);
    assert.deepEqual(written, built);
    assert.deepEqual(written.identification.map(field => field.fieldId), [...NS4_LEVEL1_IDENTIFICATION_FIELD_IDS]);
  }
});

test('GuardianOf is Person to Person | Animal and Person lists it as both', () => {
  const sources = engineSources();
  const artifacts = buildLevel1Artifacts(sources);
  const guardian = artifacts.index.relationshipTypes.find(item => item.type === 'GuardianOf');
  assert.ok(guardian);
  assert.deepEqual(guardian.from, ['Person']);
  assert.deepEqual(guardian.to, ['Person', 'Animal']);
  const person = artifacts.entities.find(entity => entity.subtype === 'Person');
  assert.ok(person);
  const allowed = person.allowedRelationships.find(item => item.type === 'GuardianOf');
  assert.ok(allowed);
  assert.equal(allowed.as, 'both');
  assert.deepEqual(allowed.otherSubtypes, ['Person', 'Animal']);
  assert.ok(person.compactRelationshipKeys.includes('pets'));
  assert.ok(person.compactRelationshipKeys.includes('guardians'));
});

test('parseEngineInterfaceFields skips comments that contain an apostrophe', () => {
  const source = [
    'export interface SampleRecord {',
    "  /** contains an apostrophe's mark */",
    '  name: string;',
    "  // it's a person's field",
    '  tags: string[];',
    '  /*',
    "   * other modules' namespace keys",
    '   */',
    '  aliases: string[];',
    '}',
  ].join('\n');
  assert.deepEqual(parseEngineInterfaceFields(source, 'SampleRecord'), [
    { fieldId: 'name', type: 'string', required: true },
    { fieldId: 'tags', type: 'string[]', required: true },
    { fieldId: 'aliases', type: 'string[]', required: true },
  ]);
});
