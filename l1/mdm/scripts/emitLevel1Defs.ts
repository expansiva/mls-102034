/// <mls fileReference="_102034_/l1/mdm/scripts/emitLevel1Defs.ts" enhancement="_blank" />

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MdmPlatformCatalog } from '/_102034_/l1/mdm/defs/platform.js';
import {
  buildLevel1Artifacts,
  renderLevel1DefFiles,
} from '/_102034_/l1/mdm/defs/level1FromEngine.js';
import type { MdmPlatformCatalogArtifact } from '/_102034_/l1/mdm/defs/level1Types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MDM_ROOT = path.resolve(HERE, '..');
const PROJECT_ROOT = path.resolve(MDM_ROOT, '../..');

export function level1EnginePaths(mdmRoot = MDM_ROOT): {
  ontology: string;
  module: string;
  support: string;
  outDir: string;
} {
  return {
    ontology: path.join(mdmRoot, 'defs/ontology.ts'),
    module: path.join(mdmRoot, 'module.ts'),
    support: path.join(mdmRoot, 'layer_3_usecases/mdmSupport.ts'),
    outDir: path.join(PROJECT_ROOT, 'l4/organization/ontology'),
  };
}

export async function emitLevel1Defs(mdmRoot = MDM_ROOT): Promise<{ outDir: string; fileNames: string[] }> {
  const paths = level1EnginePaths(mdmRoot);
  const [ontologySource, moduleSource, supportSource] = await Promise.all([
    readFile(paths.ontology, 'utf8'),
    readFile(paths.module, 'utf8'),
    readFile(paths.support, 'utf8'),
  ]);
  const artifacts = buildLevel1Artifacts({ ontologySource, moduleSource, supportSource });
  const files = renderLevel1DefFiles({ artifacts, platform: MdmPlatformCatalog as MdmPlatformCatalogArtifact });
  await mkdir(paths.outDir, { recursive: true });
  for (const file of files) {
    await writeFile(path.join(paths.outDir, file.fileName), file.source);
  }
  return { outDir: paths.outDir, fileNames: files.map(file => file.fileName) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  emitLevel1Defs().then(result => {
    process.stdout.write(`wrote ${result.fileNames.length} level-1 defs in ${result.outDir}\n`);
  }).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
