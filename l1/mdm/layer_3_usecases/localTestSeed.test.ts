/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/localTestSeed.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { ProjectsConfig } from '/_102029_/l2/runtimeConfigTypes.js';
import type { OrganizationBinding } from '/_102034_/l1/server/layer_1_external/config/onboardingConfig.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { resetResolvedTableDefinitionsCache } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { ensureOrganizationCompany } from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';
import { ensureLocalTestPair, localTestEmail, localTestSub } from '/_102034_/l1/mdm/layer_3_usecases/localTestSeed.js';
import { assertLocalSeedEnvironment } from '/_102034_/l1/scripts/seedLocalTest.js';

const previousCwd = process.cwd();
const workspace = mkdtempSync(join(tmpdir(), 'rt85-s1-'));

before(() => {
  symlinkSync(fileURLToPath(new URL('../../..', import.meta.url)), join(workspace, 'mls-102034'));
  writeFileSync(join(workspace, 'config.json'), JSON.stringify({
    defaultProjectId: '102047',
    projects: {
      '102047': {
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

function ctxAt(day: string): RequestContext {
  const ctx = createRequestContext(createMemoryDataRuntime());
  ctx.clock = { nowIso: () => `${day}T15:00:00.000Z` };
  return ctx;
}

function binding(): OrganizationBinding {
  return { key: 'org-bench', name: 'Bench Org', source: 'project-file' };
}

function projectsConfig(projectId = '102047'): ProjectsConfig {
  return {
    defaultProjectId: projectId,
    onboarding: {
      moduleId: 'mod-bench',
      entryPath: '/inicio',
      personType: 'Member',
      companyType: 'mod-bench.Company',
    },
    projects: {},
  } as ProjectsConfig;
}

test('two bench people share one company and stay incomplete', async () => {
  const ctx = ctxAt('2026-10-18');
  const seeded = await ensureLocalTestPair(ctx, projectsConfig(), binding());
  assert.equal(seeded.organizationKey, 'org-bench');
  assert.equal(seeded.personas.length, 2);
  assert.notEqual(seeded.personas[0].personMdmId, seeded.personas[1].personMdmId);
  assert.notEqual(seeded.personas[0].email, seeded.personas[1].email);
  const companies = new Set<string>();
  for (const persona of seeded.personas) {
    assert.equal(persona.email, localTestEmail('102047', persona.alias));
    assert.equal(persona.sub, localTestSub('102047', persona.alias));
    assert.notEqual(persona.sub, persona.personMdmId);
    const person = await ctx.mdm.entity.get({ mdmId: persona.personMdmId });
    assert.equal(person.details.subtype, 'Person');
    assert.equal(person.details.countryCode, '');
    assert.equal(person.details.privacyConsent ?? null, null);
    assert.equal(await ctx.mdm.identity.findByLogin(persona.email), persona.personMdmId);
    const links = await ctx.data.mdmRelationship.findMany({ where: { fromId: persona.personMdmId, type: 'AssignedTo' } });
    assert.equal(links.length, 1);
    assert.equal(links[0].toId, seeded.companyMdmId);
    assert.equal(links[0].status, 'Active');
    companies.add(links[0].toId);
  }
  assert.equal(companies.size, 1);
  const people = await ctx.data.mdmEntityIndex.findMany({ where: { subtype: 'Person' } });
  assert.equal(people.length, 2);
});

test('a repeat keeps ids and tester-filled data without a new version', async () => {
  const ctx = ctxAt('2026-10-18');
  const first = await ensureLocalTestPair(ctx, projectsConfig(), binding());
  const target = first.personas[0];
  const current = await ctx.mdm.entity.get({ mdmId: target.personMdmId });
  await ctx.mdm.entity.update({
    mdmId: target.personMdmId,
    expectedVersion: current.version,
    patch: { name: 'Filled by tester', countryCode: 'BR' },
  });
  const filled = await ctx.mdm.entity.get({ mdmId: target.personMdmId });
  const second = await ensureLocalTestPair(ctx, projectsConfig(), binding());
  assert.equal(second.companyMdmId, first.companyMdmId);
  assert.deepEqual(
    second.personas.map((persona) => persona.personMdmId),
    first.personas.map((persona) => persona.personMdmId),
  );
  const after = await ctx.mdm.entity.get({ mdmId: target.personMdmId });
  assert.equal(after.details.name, 'Filled by tester');
  assert.equal(after.details.countryCode, 'BR');
  assert.equal(after.version, filled.version);
  const people = await ctx.data.mdmEntityIndex.findMany({ where: { subtype: 'Person' } });
  assert.equal(people.length, 2);
  assert.equal(second.personas[0].name, 'Filled by tester');
});

test('an ambiguous contact is not released', async () => {
  const ctx = ctxAt('2026-10-18');
  const email = localTestEmail('102047', 'responsavel');
  const ada = await ctx.mdm.entity.create({ details: { subtype: 'Person', name: 'Ada', countryCode: 'US' } });
  const grace = await ctx.mdm.entity.create({ details: { subtype: 'Person', name: 'Grace', countryCode: 'US' } });
  const mail = await ctx.mdm.entity.create({
    details: { subtype: 'ContactChannel', name: 'mail', contactType: 'Email', value: email, countryCode: 'US' },
  });
  await ctx.mdm.entity.link({ fromId: ada.mdmId, toId: mail.mdmId, type: 'HasContact' });
  await ctx.mdm.entity.link({ fromId: grace.mdmId, toId: mail.mdmId, type: 'HasContact' });
  await assert.rejects(
    ensureLocalTestPair(ctx, projectsConfig(), binding()),
    /ambiguous and was not released/,
  );
  assert.equal(await ctx.mdm.identity.findByLogin(email), null);
});

test('a login already linked to another company is refused', async () => {
  const ctx = ctxAt('2026-10-18');
  const other = await ensureOrganizationCompany(ctx, { key: 'org-other', name: 'Other', source: 'project-file' }, {
    moduleId: 'mod-other',
    entryPath: '/inicio',
    personType: 'Member',
    companyType: 'mod-other.Company',
  });
  const email = localTestEmail('102047', 'responsavel');
  const person = await ctx.mdm.entity.create({ details: { subtype: 'Person', name: 'Taken', countryCode: '' } });
  await ctx.mdm.identity.setLogin(person.mdmId, email);
  await ctx.mdm.entity.link({ fromId: person.mdmId, toId: other.companyMdmId, type: 'AssignedTo', role: 'member' });
  await assert.rejects(
    ensureLocalTestPair(ctx, projectsConfig(), binding()),
    /linked to another company/,
  );
  const links = await ctx.data.mdmRelationship.findMany({ where: { fromId: person.mdmId, type: 'AssignedTo' } });
  assert.equal(links.length, 1);
  assert.equal(links[0].toId, other.companyMdmId);
});

test('the cli refuses before a write when mode or url is missing', () => {
  const testUrl = 'postgres://tester:secret@127.0.0.1:5432/mdm_test';
  const prodUrl = 'postgres://tester:secret@127.0.0.1:5432/mdm';
  assert.throws(
    () => assertLocalSeedEnvironment({
      declared: false,
      mode: 'presentation',
      runtimeMode: 'postgres',
      databaseUrlTest: testUrl,
    }),
    /not explicitly declared/,
  );
  assert.throws(
    () => assertLocalSeedEnvironment({
      declared: true,
      mode: 'presentation',
      runtimeMode: 'postgres',
    }),
    /DATABASE_URL_TEST is not set/,
  );
  assert.throws(
    () => assertLocalSeedEnvironment({
      declared: true,
      mode: 'production',
      runtimeMode: 'postgres',
      databaseUrlTest: testUrl,
    }),
    /not development or presentation/,
  );
  assert.throws(
    () => assertLocalSeedEnvironment({
      declared: true,
      mode: 'development',
      runtimeMode: 'memory',
      databaseUrlTest: testUrl,
    }),
    /RUNTIME_MODE=postgres/,
  );
  assert.throws(
    () => assertLocalSeedEnvironment({
      declared: true,
      mode: 'development',
      runtimeMode: 'postgres',
      databaseUrlTest: prodUrl,
      databaseUrl: prodUrl,
    }),
    /production database/,
  );
  const allowed = assertLocalSeedEnvironment({
    declared: true,
    mode: 'development',
    runtimeMode: 'postgres',
    databaseUrlTest: testUrl,
    databaseUrl: prodUrl,
  });
  assert.equal(allowed.database, 'mdm_test');
});
