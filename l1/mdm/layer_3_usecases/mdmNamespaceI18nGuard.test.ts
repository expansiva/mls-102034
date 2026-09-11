/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/mdmNamespaceI18nGuard.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const files = [
  fileURLToPath(new URL('./mdmFacade.ts', import.meta.url)),
  fileURLToPath(new URL('./mdmFacade.namespace.test.ts', import.meta.url)),
  fileURLToPath(new URL('../module.ts', import.meta.url)),
  fileURLToPath(new URL('../defs/level1Types.ts', import.meta.url)),
  fileURLToPath(new URL('../defs/level1FromEngine.ts', import.meta.url)),
  fileURLToPath(new URL('../defs/platform.ts', import.meta.url)),
  fileURLToPath(new URL('../scripts/emitLevel1Defs.ts', import.meta.url)),
  fileURLToPath(new URL('../scripts/emitLevel1Defs.test.ts', import.meta.url)),
  fileURLToPath(new URL('../../server/layer_2_controllers/contracts.ts', import.meta.url)),
  fileURLToPath(new URL('../../server/layer_2_controllers/execBff.ts', import.meta.url)),
  fileURLToPath(new URL('../../server/layer_1_external/config/env.ts', import.meta.url)),
];

test('n06 touched TypeScript stays English in comments and identifiers', () => {
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /portuguese\s*\?/, file);
    for (const line of source.split('\n')) {
      const trimmed = line.trim();
      const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
      if (!isComment) continue;
      assert.doesNotMatch(line, /[À-ÿ]/, `${file}: ${trimmed}`);
    }
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/`(?:\\.|[^`])*`/g, '')
      .replace(/'(?:\\.|[^'\\])*'/g, '')
      .replace(/"(?:\\.|[^"\\])*"/g, '');
    assert.doesNotMatch(stripped, /[À-ÿ]/, file);
  }
});
