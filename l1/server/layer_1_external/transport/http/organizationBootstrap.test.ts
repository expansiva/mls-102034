/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/organizationBootstrap.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { resetResolvedTableDefinitionsCache } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { createDefaultRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { resetSharedDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/runtimeFactory.js';
import { getEntity } from '/_102034_/l1/mdm/layer_3_usecases/internal/entityPersistence.js';
import {
  getResolvedOrganizationCompanyId,
  initializeOrganizationForProcess,
  resetResolvedOrganizationCompanyId,
} from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';
import { bootSteps } from '/_102034_/l1/server/layer_1_external/transport/http/startServer.js';

const previousCwd = process.cwd();
const workspace = mkdtempSync(join(tmpdir(), 'rt81-s4-boot-'));
const clientId = '102081';

function writeConfig(onboarding: boolean): void {
  const config: Record<string, unknown> = {
    defaultProjectId: clientId,
    projects: {
      [clientId]: {
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
  };
  if (onboarding) {
    config.onboarding = {
      moduleId: 'inicio',
      entryPath: '/tmp/inicio-entry',
      personType: 'inicio.Pessoa',
      companyType: 'inicio.Organizacao',
      organizationSource: 'development-project',
    };
  }
  writeFileSync(join(workspace, 'config.json'), JSON.stringify(config));
}

function resetProcessCaches(): void {
  resetProjectsConfigCache();
  resetResolvedTableDefinitionsCache();
  resetSharedDataRuntime();
  resetResolvedOrganizationCompanyId();
}

writeConfig(true);
mkdirSync(join(workspace, `mls-${clientId}`, 'l5'), { recursive: true });
writeFileSync(join(workspace, `mls-${clientId}`, 'l5', 'project.json'), JSON.stringify({
  orgName: 'Rt81 Boot Org',
  appEnv: 'development',
}));
symlinkSync(fileURLToPath(new URL('../../../../../', import.meta.url)), join(workspace, 'mls-102034'));
process.chdir(workspace);
resetProcessCaches();

after(() => {
  process.chdir(previousCwd);
  resetProcessCaches();
  rmSync(workspace, { recursive: true, force: true });
});

test('boot runs migrations, then the organization Company, then listen', async () => {
  const migrateSource = readFileSync(fileURLToPath(new URL('../../../../scripts/migrate.ts', import.meta.url)), 'utf8');
  const schemaAt = migrateSource.indexOf('bootstrapSchema(');
  const companyAt = migrateSource.indexOf('initializeOrganizationForProcess()');
  assert.ok(schemaAt > 0);
  assert.ok(companyAt > schemaAt);

  const order: string[] = [];
  await bootSteps({
    draft: true,
    runMigrations: async () => { order.push('migrations'); },
    initializeOrganization: async () => {
      order.push('company');
      await initializeOrganizationForProcess();
    },
    listen: async () => { order.push('listen'); },
  });
  assert.deepEqual(order, ['migrations', 'company', 'listen']);

  const companyMdmId = getResolvedOrganizationCompanyId();
  assert.ok(companyMdmId);
  const ctx = createDefaultRequestContext();
  assert.equal(ctx.sessionContext.activeCompanyId, companyMdmId);
  const created = await getEntity(ctx, companyMdmId);
  assert.equal(created.details.subtype, 'Company');
  assert.equal(created.details.name, 'Rt81 Boot Org');
  assert.deepEqual(created.details.tags, ['inicio.Organizacao']);
  assert.equal(created.details.legalName ?? '', '');

  const version = created.document.version;
  const repeated = await initializeOrganizationForProcess().then(() => getResolvedOrganizationCompanyId());
  assert.equal(repeated, companyMdmId);
  const again = await getEntity(createDefaultRequestContext(), companyMdmId);
  assert.equal(again.document.version, version);

  writeConfig(false);
  resetProcessCaches();
  const disabledOrder: string[] = [];
  await bootSteps({
    draft: true,
    runMigrations: async () => { disabledOrder.push('migrations'); },
    initializeOrganization: async () => {
      disabledOrder.push('company');
      await initializeOrganizationForProcess();
    },
    listen: async () => { disabledOrder.push('listen'); },
  });
  assert.deepEqual(disabledOrder, ['migrations', 'company', 'listen']);
  assert.equal(getResolvedOrganizationCompanyId(), undefined);
  assert.equal(createDefaultRequestContext().sessionContext.activeCompanyId, undefined);
});
