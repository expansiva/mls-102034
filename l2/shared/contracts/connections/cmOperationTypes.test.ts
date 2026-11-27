/// <mls fileReference="_102034_/l2/shared/contracts/connections/cmOperationTypes.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';
import { cm } from '/_102034_/l2/shared/contracts/connections/cm.js';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'cm.ts'), 'utf8');

function entriesOf(name: string): Array<{ id: string; input: string; output: string }> {
  const block = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`, 'u').exec(source)?.[1] ?? '';
  return [...block.matchAll(/^\s*(\w+): \{ input: (\w+); output: (\w+) \};/gmu)].map((m) => ({ id: m[1], input: m[2], output: m[3] }));
}

for (const [name, direction] of [['CmCallOperations', 'call'], ['CmServeOperations', 'serve']] as const) {
  it(`rt325 s2: ${name} has exactly the '${direction}' operations of the catalog, with the types the catalog names`, () => {
    const mapped = entriesOf(name);
    const catalog = cm.operations.filter((operation) => operation.direction === direction);
    assert.deepEqual(mapped.map((entry) => entry.id).sort(), catalog.map((operation) => operation.operationId).sort());
    for (const operation of catalog) {
      const entry = mapped.find((candidate) => candidate.id === operation.operationId);
      assert.equal(entry?.input, operation.inputType, `${operation.operationId} input`);
      assert.equal(entry?.output, operation.outputType, `${operation.operationId} output`);
    }
  });
}

it('rt325 s2: the catalog has 13 call and 7 serve operations', () => {
  assert.equal(cm.operations.filter((operation) => operation.direction === 'call').length, 13);
  assert.equal(cm.operations.filter((operation) => operation.direction === 'serve').length, 7);
});
