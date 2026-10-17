/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { ProjectOnboardingConfig } from '/_102029_/l2/runtimeConfigTypes.js';
import type { OrganizationBinding } from '/_102034_/l1/server/layer_1_external/config/onboardingConfig.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { resetResolvedTableDefinitionsCache } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { createRegistrationEntity } from '/_102034_/l1/mdm/layer_3_usecases/internal/entityPersistence.js';
import { MdmDocumentEntity } from '/_102034_/l1/mdm/layer_3_usecases/internal/MdmDocumentStore.js';
import {
  ensureOrganizationCompany,
  organizationReservationKey,
  setOrganizationBootstrapFault,
} from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';
import { readRegistrationStore, writeRegistrationStore } from '/_102034_/l1/mdm/layer_3_usecases/registrationStore.js';

const companyType = 'inicio.Organizacao';
const previousCwd = process.cwd();
const workspace = mkdtempSync(join(tmpdir(), 'rt81-s2-'));

before(() => {
  symlinkSync(fileURLToPath(new URL('../../..', import.meta.url)), join(workspace, 'mls-102034'));
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
  setOrganizationBootstrapFault(null);
  process.chdir(previousCwd);
  resetProjectsConfigCache();
  resetResolvedTableDefinitionsCache();
  rmSync(workspace, { recursive: true, force: true });
});

function config(): ProjectOnboardingConfig {
  return {
    moduleId: 'inicio',
    entryPath: '/tmp/inicio',
    personType: 'inicio.Pessoa',
    companyType,
  };
}

function binding(key: string, name: string): OrganizationBinding {
  return { key, name, source: 'project-file' };
}

function runtimeContext() {
  const runtime = createMemoryDataRuntime();
  return { runtime, ctx: createRequestContext(runtime) };
}

async function companyCount(runtime: ReturnType<typeof createMemoryDataRuntime>): Promise<number> {
  const rows = await runtime.mdmEntityIndex.findMany();
  return rows.filter((row) => row.subtype === 'Company').length;
}

async function storedCompany(runtime: ReturnType<typeof createMemoryDataRuntime>, companyMdmId: string) {
  const documents = await runtime.mdmDocument.getMany({ mdmIds: [companyMdmId] });
  const document = documents[0];
  assert.ok(document);
  return {
    version: document.version,
    details: MdmDocumentEntity.parseDetails(document),
  };
}

test('two concurrent calls and two projects of the same organization share one Company', async () => {
  const { runtime, ctx } = runtimeContext();
  const other = createRequestContext(runtime);
  const org = binding('org:acme', 'Acme');
  const [left, right] = await Promise.all([
    ensureOrganizationCompany(ctx, org, config()),
    ensureOrganizationCompany(other, binding('org:acme', 'Acme Project Two'), config()),
  ]);
  assert.equal(left.companyMdmId, right.companyMdmId);
  assert.equal(await companyCount(runtime), 1);
  const again = await ensureOrganizationCompany(ctx, org, config());
  assert.equal(again.companyMdmId, left.companyMdmId);
  const stored = await storedCompany(runtime, left.companyMdmId);
  assert.equal(stored.details.tags.filter((tag) => tag === companyType).length, 1);
  const audits = await runtime.mdmAuditLog.findMany();
  const forCompany = audits.filter((row) => row.entityId === left.companyMdmId);
  assert.equal(forCompany.length, 2);
  assert.equal(stored.version, 2);
});

test('different organizations get different companies', async () => {
  const { runtime, ctx } = runtimeContext();
  const first = await ensureOrganizationCompany(ctx, binding('org:one', 'One'), config());
  const second = await ensureOrganizationCompany(ctx, binding('org:two', 'Two'), config());
  assert.notEqual(first.companyMdmId, second.companyMdmId);
  assert.equal(await companyCount(runtime), 2);
  const reservation = await readRegistrationStore(ctx, organizationReservationKey('org:one'));
  assert.equal(reservation?.companyMdmId, first.companyMdmId);
  assert.equal(reservation?.kind, 'organization');
  assert.ok(organizationReservationKey('org:one').startsWith('runtime.onboarding/org/'));
});

test('same org id keeps the company and does not overwrite completed data when the name changes', async () => {
  const { runtime, ctx } = runtimeContext();
  const created = await ensureOrganizationCompany(ctx, binding('org:acme', 'Acme'), config());
  const before = await ctx.mdm.entity.get({ mdmId: created.companyMdmId });
  const completed = await ctx.mdm.entity.update({
    mdmId: created.companyMdmId,
    expectedVersion: before.version,
    patch: { name: 'Acme Legal', countryCode: 'br', legalName: 'Acme LTDA' },
  });
  const versionAfterEdit = completed.version;

  const repeated = await ensureOrganizationCompany(ctx, binding('org:acme', 'Acme Renamed'), config());
  assert.equal(repeated.companyMdmId, created.companyMdmId);
  const stored = await storedCompany(runtime, created.companyMdmId);
  assert.equal(stored.details.subtype, 'Company');
  if (stored.details.subtype !== 'Company') return;
  assert.equal(stored.details.name, 'Acme Legal');
  assert.equal(stored.details.legalName, 'Acme LTDA');
  assert.equal(stored.details.countryCode, 'BR');
  assert.equal(stored.version, versionAfterEdit);
  assert.equal(await companyCount(runtime), 1);
});

test('a repeat does not add a version when the company type is already attached', async () => {
  const { runtime, ctx } = runtimeContext();
  const created = await ensureOrganizationCompany(ctx, binding('org:acme', 'Acme'), config());
  const once = await storedCompany(runtime, created.companyMdmId);
  await ensureOrganizationCompany(ctx, binding('org:acme', 'Acme'), config());
  const twice = await storedCompany(runtime, created.companyMdmId);
  assert.equal(twice.version, once.version);
  assert.deepEqual(twice.details.tags, once.details.tags);
});

test('failure after the reservation resumes the same id and creates one draft', async () => {
  const { runtime, ctx } = runtimeContext();
  setOrganizationBootstrapFault('after-reserve');
  await assert.rejects(
    () => ensureOrganizationCompany(ctx, binding('org:acme', 'Acme'), config()),
    /after-reserve/,
  );
  assert.equal(await companyCount(runtime), 0);
  const reserved = await readRegistrationStore(ctx, organizationReservationKey('org:acme'));
  assert.equal(typeof reserved?.companyMdmId, 'string');

  setOrganizationBootstrapFault(null);
  const created = await ensureOrganizationCompany(ctx, binding('org:acme', 'Acme'), config());
  assert.equal(created.companyMdmId, reserved?.companyMdmId);
  assert.equal(await companyCount(runtime), 1);
});

test('failure after the company and tag exist does not create another company or version', async () => {
  const { runtime, ctx } = runtimeContext();
  setOrganizationBootstrapFault('before-return');
  await assert.rejects(
    () => ensureOrganizationCompany(ctx, binding('org:acme', 'Acme'), config()),
    /before-return/,
  );
  const reserved = await readRegistrationStore(ctx, organizationReservationKey('org:acme'));
  const companyMdmId = String(reserved?.companyMdmId);
  const once = await storedCompany(runtime, companyMdmId);
  assert.equal(once.details.tags.includes(companyType), true);
  assert.equal(await companyCount(runtime), 1);

  setOrganizationBootstrapFault(null);
  const created = await ensureOrganizationCompany(ctx, binding('org:acme', 'Acme'), config());
  assert.equal(created.companyMdmId, companyMdmId);
  const twice = await storedCompany(runtime, companyMdmId);
  assert.equal(twice.version, once.version);
  assert.equal(await companyCount(runtime), 1);
});

test('an invalid reservation is refused and no other Company is chosen', async () => {
  const { runtime, ctx } = runtimeContext();
  const person = await createRegistrationEntity(ctx, {
    mdmId: ctx.idGenerator.newId(),
    detail: { subtype: 'Person', name: 'Ada' },
  });
  await writeRegistrationStore(ctx, organizationReservationKey('org:acme'), {
    schema: 1,
    kind: 'organization',
    organizationKey: 'org:acme',
    companyMdmId: person.mdmId,
  });
  await assert.rejects(
    () => ensureOrganizationCompany(ctx, binding('org:acme', 'Acme'), config()),
    (error: unknown) => error instanceof AppError && error.code === 'ORGANIZATION_RESERVATION_INVALID',
  );
  assert.equal(await companyCount(runtime), 0);

  await writeRegistrationStore(ctx, organizationReservationKey('org:other'), {
    schema: 2,
    kind: 'organization',
    organizationKey: 'org:other',
    companyMdmId: person.mdmId,
  });
  await assert.rejects(
    () => ensureOrganizationCompany(ctx, binding('org:other', 'Other'), config()),
    (error: unknown) => error instanceof AppError && error.code === 'ORGANIZATION_RESERVATION_INVALID',
  );
  assert.equal(await companyCount(runtime), 0);
});

test('the first company is a draft without invented legal data', async () => {
  const { runtime, ctx } = runtimeContext();
  const created = await ensureOrganizationCompany(ctx, binding('org:acme', 'Acme Display'), config());
  const stored = await storedCompany(runtime, created.companyMdmId);
  assert.equal(stored.details.subtype, 'Company');
  if (stored.details.subtype !== 'Company') return;
  assert.equal(stored.details.registrationDraft, true);
  assert.equal(stored.details.name, 'Acme Display');
  assert.equal(stored.details.legalName, '');
  assert.equal(stored.details.countryCode, '');
  assert.equal(stored.details.docId, null);
  assert.deepEqual(stored.details.addresses, []);
  assert.deepEqual(stored.details.contacts, []);
  const index = await runtime.mdmEntityIndex.findOne({ where: { mdmId: created.companyMdmId } });
  assert.equal(index?.subtype, 'Company');
  assert.equal(index?.name, 'Acme Display');
});
