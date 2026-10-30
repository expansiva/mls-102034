/// <mls fileReference="_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.registrationKv.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { resetResolvedTableDefinitionsCache } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';

const previousCwd = process.cwd();
const workspace = mkdtempSync(join(tmpdir(), 'rt152-s1-'));

before(() => {
  symlinkSync(fileURLToPath(new URL('../../../../..', import.meta.url)), join(workspace, 'mls-102034'));
  writeFileSync(join(workspace, 'config.json'), JSON.stringify({
    defaultProjectId: '102099',
    projects: {
      '102099': {
        root: './client',
        type: 'client',
        persistenceModules: [{
          moduleId: 'mdm',
          persistenceEntrypoint: './_102034_/l1/mdm/persistence.js',
        }],
      },
      '102029': { root: './fe', type: 'master frontend' },
      '102034': { root: './be', type: 'master backend' },
    },
  }));
  process.chdir(workspace);
  resetProjectsConfigCache();
  resetResolvedTableDefinitionsCache();
});

after(() => {
  process.chdir(previousCwd);
  resetProjectsConfigCache();
  resetResolvedTableDefinitionsCache();
  rmSync(workspace, { recursive: true, force: true });
});

test('rt152: a row written on mdmRegistrationKv is read from moduleData mdmKv (same table)', async () => {
  const runtime = createMemoryDataRuntime();
  const key = 'runtime.onboarding/org/rt152-s1';
  await runtime.mdmRegistrationKv.insert({
    record: { key, value: { companyId: 'company-shared' } },
  });
  const table = await runtime.moduleData.getTable<{ key: string; value: Record<string, unknown> | null }>('mdmKv');
  const row = await table.findOne({ where: { key } });
  assert.equal(row?.value?.companyId, 'company-shared');
});
