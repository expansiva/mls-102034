/// <mls fileReference="_102034_/l2/shared/contracts/connections/connectionsCopy.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const L1 = path.resolve(HERE, '../../../../l1/server/layer_1_external/connections');

/** Body without the fileReference line, import specifiers folded so the two paths compare. */
function body(file: string): string {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !line.includes('fileReference='))
    .join('\n')
    .replace(/(from\s+)(['"])[^'"]+\2/g, '$1$2<import>$2');
}

const PAIRS: Array<[string, string]> = [
  ['catalogs/types.ts', 'types.ts'],
  ['catalogs/cm.ts', 'cm.ts'],
  ['catalogs/platform.ts', 'platform.ts'],
  ['external/types.ts', 'externalSystem.ts'],
];

test('the l2 connection contracts stay a copy of the l1 catalogs', () => {
  for (const [l1Name, l2Name] of PAIRS) {
    assert.equal(
      body(path.join(HERE, l2Name)),
      body(path.join(L1, l1Name)),
      `${l2Name}: a cópia do l2 é a fonte; atualize as duas até o s4`,
    );
  }
});
