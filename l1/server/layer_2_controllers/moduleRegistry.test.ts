/// <mls fileReference="_102034_/l1/server/layer_2_controllers/moduleRegistry.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRouterFromControllers } from '/_102034_/l1/server/layer_2_controllers/moduleRegistry.js';

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

test('loadRouterFromControllers lê .js e, sem dist, .ts; .js ganha quando os dois existem', async () => {
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
    const both = writeControllers('l1/both/layer_2_controllers', {
      'gamma.js': valid('both-js'),
      'gamma.ts': valid('both-ts'),
      'delta.ts': valid('both-ts-only'),
    });

    const jsRouter = await loadRouterFromControllers(onlyJs);
    assert.deepEqual([...jsRouter.keys()], ['js-alpha']);

    const tsRouter = await loadRouterFromControllers(onlyTs);
    assert.deepEqual([...tsRouter.keys()], ['ts-beta']);

    const bothRouter = await loadRouterFromControllers(both);
    assert.equal(bothRouter.has('both-js'), true);
    assert.equal(bothRouter.has('both-ts'), false);
    assert.equal(bothRouter.has('both-ts-only'), true);
  } finally {
    process.chdir(previous);
    rmSync(sourceRoot, { recursive: true, force: true });
  }
});
