/// <mls fileReference="_102034_/l1/server/layer_2_controllers/moduleRegistry.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRouterFromControllers, selectControllerFiles } from '/_102034_/l1/server/layer_2_controllers/moduleRegistry.js';

const mlsBase = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');
const projectId = '990634';
const sourceRoot = join(mlsBase, `mls-${projectId}`);

const valid = (key: string) => `export const routes = [{ key: '${key}', handler() { return undefined; } }];\n`;
const broken = 'export const routes = [{\n';

function writeControllers(rel: string, files: Record<string, string>): string {
  const dir = join(sourceRoot, rel);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body);
  }
  return `_${projectId}_/${rel}`;
}

test('loadRouterFromControllers lê .js e, sem dist, .ts', async () => {
  assert.equal(existsSync(join(mlsBase, 'config.json')), true, `config.json de projetos não está em ${mlsBase}`);
  const previous = process.cwd();
  process.chdir(mlsBase);
  try {
    const onlyJs = writeControllers('l1/onlyjs/layer_2_controllers', {
      'alpha.js': valid('js-alpha'),
      'alpha.defs.js': broken,
    });
    const onlyTs = writeControllers('l1/onlyts/layer_2_controllers', {
      'beta.ts': valid('ts-beta'),
      'beta.defs.ts': broken,
      'beta.test.ts': broken,
      'beta.d.ts': broken,
    });
    const jsRouter = await loadRouterFromControllers(onlyJs);
    assert.deepEqual([...jsRouter.keys()], ['js-alpha']);

    const tsRouter = await loadRouterFromControllers(onlyTs);
    assert.deepEqual([...tsRouter.keys()], ['ts-beta']);
  } finally {
    process.chdir(previous);
    rmSync(sourceRoot, { recursive: true, force: true });
  }
});

// "O .js ganha quando os dois existem" não se prova importando: sob o tsx um import de `x.js` com `x.ts` ao lado carrega o `.ts`,
// então a escolha só aparece na seleção.
test('selectControllerFiles: .js ganha do .ts de mesmo nome; .defs, .d.ts e .test não entram', () => {
  assert.deepEqual(
    selectControllerFiles(['gamma.js', 'gamma.ts', 'delta.ts', 'gamma.defs.js', 'delta.defs.ts', 'delta.d.ts', 'delta.test.ts', 'eps.test.js', 'notes.md']),
    ['gamma.js', 'delta.ts'],
  );
  assert.deepEqual(selectControllerFiles(['a.js', 'a.test.js', 'a.defs.js', 'b.ts', 'b.test.ts']), ['a.js', 'b.ts']);
  assert.deepEqual(selectControllerFiles(['alpha.ts']), ['alpha.ts']);
  assert.deepEqual(selectControllerFiles([]), []);
});
