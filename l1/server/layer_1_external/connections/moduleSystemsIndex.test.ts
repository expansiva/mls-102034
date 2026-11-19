/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/moduleSystemsIndex.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { moduleSystemsIndex } from '/_102034_/l1/server/layer_1_external/connections/moduleSystemsIndex.js';

const root = mkdtempSync(path.join(tmpdir(), 'module-systems-'));
let previousCwd = '';

function distOf(projectId: string): string {
  return path.join(root, 'dist', 'local', `_${projectId}_`);
}

function writeJs(projectId: string, relative: string, body: unknown): void {
  const file = path.join(distOf(projectId), relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `export default ${JSON.stringify(body)};\n`);
}

function declareSystem(projectId: string, moduleId: string, systemId: string): void {
  writeJs(projectId, `l4/${moduleId}/integration.defs.js`, {
    externalSystems: [{ id: systemId, title: 'Lookup', description: 'A public lookup.', settings: [], operations: [] }],
  });
  writeJs(projectId, `l1/${moduleId}/layer_1_external/connections/${systemId}.js`, { systemId });
}

function captureWarn(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  return run().finally(() => {
    console.warn = warn;
  }).then(() => lines);
}

before(() => {
  writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    defaultProjectId: '900261',
    projects: {
      '900261': { root: '.', type: 'client' },
      '102033': { root: '.', type: 'master frontend' },
      '102034': { root: '.', type: 'master backend' },
    },
  }));
  previousCwd = process.cwd();
  process.chdir(root);
});

after(() => {
  process.chdir(previousCwd);
  rmSync(root, { recursive: true, force: true });
});

describe('moduleSystemsIndex', () => {
  it('maps a system declared by one module and ignores a sibling without defs', async () => {
    declareSystem('900261', 'ownerModule', 'publicLookup');
    mkdirSync(path.join(distOf('900261'), 'l4', 'quietModule'), { recursive: true });
    const lines = await captureWarn(async () => {
      const index = await moduleSystemsIndex('900261');
      assert.equal(index.get('publicLookup'), 'ownerModule');
      assert.equal(index.size, 1);
    });
    assert.equal(lines.length, 0);
  });

  it('refuses a system id declared by two modules and logs it', async () => {
    declareSystem('900262', 'ownerModule', 'publicLookup');
    declareSystem('900262', 'otherModule', 'publicLookup');
    const lines = await captureWarn(async () => {
      const index = await moduleSystemsIndex('900262');
      assert.equal(index.has('publicLookup'), false);
    });
    assert.equal(lines.some((line) => line.includes('two modules') && line.includes('publicLookup')), true);
  });

  it('refuses a system id reserved by a platform catalog', async () => {
    declareSystem('900263', 'ownerModule', 'cm');
    const lines = await captureWarn(async () => {
      const index = await moduleSystemsIndex('900263');
      assert.equal(index.has('cm'), false);
    });
    assert.equal(lines.some((line) => line.includes('reserved') && line.includes('cm')), true);
  });

  it('ignores a module that has no integration defs', async () => {
    mkdirSync(path.join(distOf('900264'), 'l4', 'quietModule'), { recursive: true });
    const lines = await captureWarn(async () => {
      const index = await moduleSystemsIndex('900264');
      assert.equal(index.size, 0);
    });
    assert.equal(lines.length, 0);
  });

  it('a second caller that arrives while the index is being built gets the whole index', async () => {
    declareSystem('900265', 'ordersModule', 'racing');
    const [first, second] = await Promise.all([moduleSystemsIndex('900265'), moduleSystemsIndex('900265')]);
    assert.equal(first, second);
    assert.equal(second.get('racing'), 'ordersModule');
  });
});
