/// <mls fileReference="_102034_/l1/mdm/scripts/emitOntology.ts" enhancement="_blank" />
/**
 * Emits the level-1 ontology into `l4/ontology/` in the hierarchical grammar of `defs/ontologyTypes.ts`:
 * one file per subtype, one per value type, and an index that also exports the record types derived by
 * `InferRecord`. Run it after changing `defs/ontology.ts`, `module.ts`, `mdmSupport.ts`, `persistence.ts`
 * or `defs/ontologyEditorial.ts`; `scripts/emitOntology.test.ts` fails when what is on disk drifts.
 *
 * `scripts/emitLevel1Defs.ts` keeps emitting the older flat catalog into `l4/organization/ontology/` for
 * the NS4 agent; the two coexist until the NS4 readers move over.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMdmOntology, type MdmOntologyArtifacts } from '/_102034_/l1/mdm/defs/ontologyFromEngine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MDM_ROOT = path.resolve(HERE, '..');
const PROJECT_ROOT = path.resolve(MDM_ROOT, '../..');

export function ontologyEnginePaths(mdmRoot = MDM_ROOT): {
  ontology: string;
  module: string;
  support: string;
  outDir: string;
} {
  return {
    ontology: path.join(mdmRoot, 'defs/ontology.ts'),
    module: path.join(mdmRoot, 'module.ts'),
    support: path.join(mdmRoot, 'layer_3_usecases/mdmSupport.ts'),
    outDir: path.join(PROJECT_ROOT, 'l4/ontology'),
  };
}

export async function readOntologyArtifacts(mdmRoot = MDM_ROOT): Promise<MdmOntologyArtifacts> {
  const paths = ontologyEnginePaths(mdmRoot);
  const [ontologySource, moduleSource, supportSource] = await Promise.all([
    readFile(paths.ontology, 'utf8'),
    readFile(paths.module, 'utf8'),
    readFile(paths.support, 'utf8'),
  ]);
  return buildMdmOntology({ ontologySource, moduleSource, supportSource });
}

function header(folder: string, shortName: string): string {
  return `/// <mls fileReference="_102034_/l4/${folder}/${shortName}.defs.ts" enhancement="_blank"/>\n\n`;
}

function defsBody(exportName: string, value: unknown, artifactType: string): string {
  const typeName = `${exportName.slice(0, 1).toUpperCase()}${exportName.slice(1)}Type`;
  return `export const ${exportName} = ${JSON.stringify(value, null, 2)} as const satisfies ${artifactType};\n\n`
    + `export type ${typeName} = typeof ${exportName};\n\n`
    + `export default ${exportName};\n`;
}

export function renderOntologyFiles(artifacts: MdmOntologyArtifacts): { fileName: string; source: string }[] {
  const files: { fileName: string; source: string }[] = [];

  for (const valueType of artifacts.valueTypes) {
    files.push({
      fileName: `defs/${valueType.valueTypeId}.defs.ts`,
      source: header('ontology/defs', valueType.valueTypeId)
        + `import type { MdmValueTypeArtifact } from '/_102034_/l1/mdm/defs/ontologyTypes.js';\n\n`
        + defsBody(`mdmValueType${valueType.valueTypeId}`, valueType, 'MdmValueTypeArtifact'),
    });
  }

  for (const entity of artifacts.entities) {
    files.push({
      fileName: `${entity.entityId}.defs.ts`,
      source: header('ontology', entity.entityId)
        + `import type { MdmEntityArtifact } from '/_102034_/l1/mdm/defs/ontologyTypes.js';\n\n`
        + defsBody(`mdmEntity${entity.entityId}`, entity, 'MdmEntityArtifact'),
    });
  }

  const valueImports = artifacts.valueTypes
    .map(item => `import mdmValueType${item.valueTypeId} from '/_102034_/l4/ontology/defs/${item.valueTypeId}.defs.js';`)
    .join('\n');
  const entityImports = artifacts.entities
    .map(item => `import mdmEntity${item.entityId} from '/_102034_/l4/ontology/${item.entityId}.defs.js';`)
    .join('\n');
  const registry = artifacts.valueTypes.map(item => `${item.valueTypeId}: mdmValueType${item.valueTypeId}`).join(', ');
  const recordTypes = [
    ...artifacts.entities.map(item => `export type ${item.entityId}Record = InferRecord<typeof mdmEntity${item.entityId}.fields, typeof valueTypes>;`),
    ...artifacts.valueTypes.map(item => `export type ${item.valueTypeId}Record = InferRecord<typeof mdmValueType${item.valueTypeId}.fields, typeof valueTypes>;`),
  ].join('\n');

  files.push({
    fileName: 'index.defs.ts',
    source: header('ontology', 'index')
      + `import type { InferRecord, MdmOntologyIndexArtifact } from '/_102034_/l1/mdm/defs/ontologyTypes.js';\n`
      + `${valueImports}\n${entityImports}\n\n`
      + defsBody('mdmOntologyIndex', artifacts.index, 'MdmOntologyIndexArtifact')
      + `\n/** What \`of\` resolves against, for \`tsc\` and for the gate. */\n`
      + `export const valueTypes = { ${registry} } as const;\n\n`
      + `/** Record types derived from the ontology — the engine reads these instead of hand-written interfaces. */\n`
      + `${recordTypes}\n`,
  });
  return files;
}

export async function emitOntology(mdmRoot = MDM_ROOT): Promise<{ outDir: string; fileNames: string[] }> {
  const paths = ontologyEnginePaths(mdmRoot);
  const artifacts = await readOntologyArtifacts(mdmRoot);
  const files = renderOntologyFiles(artifacts);
  await mkdir(path.join(paths.outDir, 'defs'), { recursive: true });
  for (const file of files) {
    await writeFile(path.join(paths.outDir, file.fileName), file.source);
  }
  return { outDir: paths.outDir, fileNames: files.map(file => file.fileName) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  emitOntology().then(result => {
    process.stdout.write(`wrote ${result.fileNames.length} ontology defs in ${result.outDir}\n`);
  }).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
