/// <mls fileReference="_102034_/l1/mdm/countryCatalog.integration.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before } from 'node:test';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { resetResolvedTableDefinitionsCache } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { createRegistrationEntity } from '/_102034_/l1/mdm/layer_3_usecases/internal/entityPersistence.js';
import {
  getCountryCatalog,
  isPersonAccessComplete,
  isProtectedPrivacyCountry,
  type PrivacyConsentValue,
} from '/_102034_/l1/mdm/module.js';

// The promote path reads the projects config from the cwd. Under the official runner the mls-base root config
// has no master frontend, so this file runs in its own workspace, as registration.test.ts does.
const previousCwd = process.cwd();
const workspace = mkdtempSync(join(tmpdir(), 'rt114-'));

before(() => {
  symlinkSync(fileURLToPath(new URL('../..', import.meta.url)), join(workspace, 'mls-102034'));
  mkdirSync(join(workspace, 'dist', 'local', '_102099_', 'l5'), { recursive: true });
  writeFileSync(join(workspace, 'dist', 'local', '_102099_', 'l5', 'project.json'), JSON.stringify({ appEnv: 'development' }));
  writeFileSync(join(workspace, 'config.json'), JSON.stringify({
    defaultProjectId: '102099',
    projects: {
      '102099': {
        root: './client',
        type: 'client',
        persistenceModules: [{ moduleId: 'mdm', persistenceEntrypoint: './_102034_/l1/mdm/persistence.js' }],
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

const consent: PrivacyConsentValue = {
  consentedAt: '2026-10-21T12:00:00.000Z',
  consentVersion: 'v1',
  channel: 'web',
};

const rejectedCodes = ['ZZ', 'XK', 'EU', 'UK', 'USA', 'XX'];

function isCountryValidation(error: unknown): boolean {
  return error instanceof AppError
    && error.code === 'VALIDATION_ERROR'
    && error.statusCode === 400
    && (error.details as { field?: string } | undefined)?.field === 'countryCode';
}

test('every public country option round-trips on the real mdm facade', async () => {
  const catalog = getCountryCatalog();
  assert.equal(catalog.length, 249);
  const runtime = createMemoryDataRuntime();
  const ctx = createRequestContext(runtime);

  for (const option of catalog) {
    assert.equal(option.requiresPrivacyConsent, isProtectedPrivacyCountry(option.code));
    const person = await ctx.mdm.entity.create({
      details: {
        subtype: 'Person',
        name: `Person ${option.code}`,
        countryCode: option.code.toLowerCase(),
        ...(option.requiresPrivacyConsent ? { privacyConsent: consent } : {}),
      },
    });
    assert.equal(person.alreadyExists, false);
    assert.equal(person.details.countryCode, option.code, option.code);
    assert.equal(person.index.countryCode, option.code);
    assert.equal(isPersonAccessComplete(person.details), true, option.code);
    const personRead = await ctx.mdm.entity.get({ mdmId: person.mdmId });
    assert.equal(personRead.details.countryCode, option.code);
    assert.equal(personRead.document.details.countryCode, option.code);
    const personUpdated = await ctx.mdm.entity.update({
      mdmId: person.mdmId,
      expectedVersion: person.version,
      patch: { name: `Person ${option.code} updated` },
    });
    assert.equal(personUpdated.details.countryCode, option.code);
    assert.equal(personUpdated.index.countryCode, option.code);
    const personIndex = await runtime.mdmEntityIndex.findOne({ where: { mdmId: person.mdmId } });
    assert.equal(personIndex?.countryCode, option.code);
    assert.equal(personIndex?.name, `Person ${option.code} updated`);

    const company = await ctx.mdm.entity.create({
      details: {
        subtype: 'Company',
        name: `Company ${option.code}`,
        legalName: `Company ${option.code} LLC`,
        countryCode: ` ${option.code.toLowerCase()} `,
      },
    });
    assert.equal(company.details.countryCode, option.code, option.code);
    assert.equal(company.index.countryCode, option.code);
    assert.equal(company.details.legalName, `Company ${option.code} LLC`);
    const companyUpdated = await ctx.mdm.entity.update({
      mdmId: company.mdmId,
      expectedVersion: company.version,
      patch: { legalName: `Company ${option.code} Ltd` },
    });
    assert.equal(companyUpdated.details.countryCode, option.code);
    assert.equal(companyUpdated.index.countryCode, option.code);
    assert.equal(companyUpdated.details.legalName, `Company ${option.code} Ltd`);
    const companyIndex = await runtime.mdmEntityIndex.findOne({ where: { mdmId: company.mdmId } });
    assert.equal(companyIndex?.countryCode, option.code);
  }
});

test('create and patch reject codes outside the catalog without a divergent write', async () => {
  const runtime = createMemoryDataRuntime();
  const ctx = createRequestContext(runtime);
  const before = (await runtime.mdmEntityIndex.findMany()).length;
  for (const code of rejectedCodes) {
    await assert.rejects(
      () => ctx.mdm.entity.create({
        details: { subtype: 'Person', name: `Bad ${code}`, countryCode: code },
      }),
      isCountryValidation,
    );
    await assert.rejects(
      () => ctx.mdm.entity.create({
        details: {
          subtype: 'Company',
          name: `Bad Co ${code}`,
          legalName: `Bad Co ${code} LLC`,
          countryCode: code,
        },
      }),
      isCountryValidation,
    );
  }
  assert.equal((await runtime.mdmEntityIndex.findMany()).length, before);

  const person = await ctx.mdm.entity.create({
    details: { subtype: 'Person', name: 'Ada', countryCode: 'US' },
  });
  const docsBefore = (await runtime.mdmDocument.getMany({ mdmIds: [person.mdmId] }))[0]!;
  for (const code of rejectedCodes) {
    await assert.rejects(
      () => ctx.mdm.entity.update({
        mdmId: person.mdmId,
        expectedVersion: person.version,
        patch: { countryCode: code, name: 'Should not stick' },
      }),
      isCountryValidation,
    );
  }
  const read = await ctx.mdm.entity.get({ mdmId: person.mdmId });
  assert.equal(read.version, person.version);
  assert.equal(read.details.countryCode, 'US');
  assert.equal(read.details.name, 'Ada');
  assert.equal(read.index.countryCode, 'US');
  const stored = (await runtime.mdmDocument.getMany({ mdmIds: [person.mdmId] }))[0]!;
  assert.equal(stored.version, docsBefore.version);
  assert.equal(stored.details.countryCode, 'US');
  assert.equal(stored.details.name, 'Ada');
});

test('prospect promote and draft patch use the same country decision', async () => {
  const runtime = createMemoryDataRuntime();
  const ctx = createRequestContext(runtime);

  const br = await ctx.mdm.prospect.create({
    details: {
      subtype: 'Person',
      name: 'Ana',
      countryCode: 'br',
      privacyConsent: consent,
      promotionSource: 'catalog',
    },
  });
  assert.equal(br.details.countryCode, 'BR');
  assert.equal(br.index.countryCode, 'BR');
  assert.equal(isPersonAccessComplete(br.details), true);
  const promotedBr = await ctx.mdm.prospect.promoteToEntity({ mdmId: br.mdmId });
  assert.equal(promotedBr.promoted, true);
  const brEntity = await ctx.mdm.entity.get({ mdmId: br.mdmId });
  assert.equal(brEntity.details.countryCode, 'BR');
  assert.equal(brEntity.index.countryCode, 'BR');
  assert.equal(await runtime.mdmProspectIndex.findOne({ where: { mdmId: br.mdmId } }), null);

  const us = await ctx.mdm.prospect.create({
    details: {
      subtype: 'Company',
      name: 'Acme',
      legalName: 'Acme LLC',
      countryCode: 'us',
      promotionSource: 'catalog',
    },
  });
  assert.equal(us.details.countryCode, 'US');
  assert.equal(us.index.countryCode, 'US');
  const promotedUs = await ctx.mdm.prospect.promoteToEntity({ mdmId: us.mdmId });
  assert.equal(promotedUs.promoted, true);
  const usEntity = await ctx.mdm.entity.get({ mdmId: us.mdmId });
  assert.equal(usEntity.details.countryCode, 'US');
  assert.equal(usEntity.details.legalName, 'Acme LLC');
  assert.equal(usEntity.index.countryCode, 'US');

  const prospectCount = (await runtime.mdmProspectIndex.findMany()).length;
  await assert.rejects(
    () => ctx.mdm.prospect.create({
      details: {
        subtype: 'Person',
        name: 'Ghost',
        countryCode: 'ZZ',
        promotionSource: 'catalog',
      },
    }),
    isCountryValidation,
  );
  assert.equal((await runtime.mdmProspectIndex.findMany()).length, prospectCount);

  const open = await ctx.mdm.prospect.create({
    details: {
      subtype: 'Person',
      name: 'Open',
      countryCode: 'US',
      promotionSource: 'catalog',
    },
  });
  await assert.rejects(
    () => ctx.mdm.prospect.update({
      mdmId: open.mdmId,
      expectedVersion: open.version,
      patch: { countryCode: 'XX' },
    }),
    isCountryValidation,
  );
  const openRead = await ctx.mdm.prospect.get({ mdmId: open.mdmId });
  assert.equal(openRead.version, open.version);
  assert.equal(openRead.details.countryCode, 'US');
  assert.equal(openRead.index.countryCode, 'US');

  const draftId = ctx.idGenerator.newId();
  await createRegistrationEntity(ctx, {
    mdmId: draftId,
    detail: { subtype: 'Person', name: '' },
  });
  const draft = await ctx.mdm.entity.get({ mdmId: draftId });
  assert.equal(draft.details.countryCode, '');
  assert.equal(draft.index.countryCode, '');
  await assert.rejects(
    () => ctx.mdm.entity.update({
      mdmId: draftId,
      expectedVersion: draft.version,
      patch: { name: 'Draft', countryCode: 'ZZ' },
    }),
    isCountryValidation,
  );
  const draftStill = await ctx.mdm.entity.get({ mdmId: draftId });
  assert.equal(draftStill.version, draft.version);
  assert.equal(draftStill.details.countryCode, '');
  assert.equal(draftStill.details.name, '');
  assert.equal(draftStill.index.countryCode, '');
  const finished = await ctx.mdm.entity.update({
    mdmId: draftId,
    expectedVersion: draft.version,
    patch: { name: 'Draft', countryCode: 'de', privacyConsent: consent },
  });
  assert.equal(finished.details.countryCode, 'DE');
  assert.equal(finished.details.registrationDraft, undefined);
  assert.equal(finished.index.countryCode, 'DE');
  assert.equal(isPersonAccessComplete(finished.details), true);
});
