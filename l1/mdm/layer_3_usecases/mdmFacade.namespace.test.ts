/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/mdmFacade.namespace.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import {
  projectDetailsForModule,
} from '/_102034_/l1/mdm/layer_3_usecases/mdmFacade.js';
import type { MdmDetailRecord } from '/_102034_/l1/mdm/module.js';

function detailsWithTwoNamespaces(): MdmDetailRecord {
  return {
    mdmId: 'p1',
    subtype: 'Person',
    name: 'Ana',
    status: 'Active',
    countryCode: 'US',
    tags: ['clinica.Patient', 'academia.Aluno'],
    aliases: [],
    contacts: [],
    relationshipRefs: {},
    addresses: [],
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
    general: { segment: 'vip' },
    clinica: { allergy: 'penicillin' },
    academia: { plan: 'monthly' },
  } as MdmDetailRecord;
}

test('projectDetailsForModule: caller A sees general and own namespace, only the name of B', () => {
  const projected = projectDetailsForModule(detailsWithTwoNamespaces(), 'academia') as Record<string, unknown>;
  assert.equal(projected.name, 'Ana');
  assert.deepEqual(projected.general, { segment: 'vip' });
  assert.deepEqual(projected.academia, { plan: 'monthly' });
  assert.equal('clinica' in projected, false);
  assert.deepEqual(projected.namespaces, ['clinica']);
});

test('projectDetailsForModule: organization sees every namespace including content', () => {
  const projected = projectDetailsForModule(detailsWithTwoNamespaces(), 'organization') as Record<string, unknown>;
  assert.deepEqual(projected.clinica, { allergy: 'penicillin' });
  assert.deepEqual(projected.academia, { plan: 'monthly' });
  assert.deepEqual(projected.general, { segment: 'vip' });
  assert.deepEqual(projected.namespaces, ['academia', 'clinica']);
});

test('projectDetailsForModule: missing moduleId is the unrestricted platform caller', () => {
  const projected = projectDetailsForModule(detailsWithTwoNamespaces()) as Record<string, unknown>;
  assert.deepEqual(projected.clinica, { allergy: 'penicillin' });
  assert.deepEqual(projected.namespaces, ['academia', 'clinica']);
});

test('MdmEntity.get hides foreign namespace content and lists its key', async () => {
  const runtime = createMemoryDataRuntime();
  const platform = createRequestContext(runtime);
  const academia = createRequestContext(runtime, { moduleId: 'academia' });
  const created = await platform.mdm.entity.create({
    details: {
      subtype: 'Person',
      name: 'Ana',
      general: { segment: 'vip' },
      clinica: { allergy: 'penicillin' },
      academia: { plan: 'monthly' },
    },
  });

  const asAcademia = await academia.mdm.entity.get({ mdmId: created.mdmId });
  const details = asAcademia.details as Record<string, unknown>;
  assert.deepEqual(details.academia, { plan: 'monthly' });
  assert.deepEqual(details.general, { segment: 'vip' });
  assert.equal('clinica' in details, false);
  assert.deepEqual(details.namespaces, ['clinica']);
  assert.equal('clinica' in (asAcademia.document.details as Record<string, unknown>), false);

  const asOrg = await createRequestContext(runtime, { moduleId: 'organization' }).mdm.entity.get({
    mdmId: created.mdmId,
  });
  const orgDetails = asOrg.details as Record<string, unknown>;
  assert.deepEqual(orgDetails.clinica, { allergy: 'penicillin' });
  assert.deepEqual(orgDetails.namespaces, ['academia', 'clinica']);
});

test('create and update reject a foreign module namespace', async () => {
  const academia = createRequestContext(createMemoryDataRuntime(), { moduleId: 'academia' });

  await assert.rejects(
    () => academia.mdm.entity.create({
      details: {
        subtype: 'Person',
        name: 'Ana',
        clinica: { allergy: 'penicillin' },
      },
    }),
    (error: unknown) => error instanceof AppError && error.code === 'MDM_FOREIGN_NAMESPACE',
  );

  const created = await academia.mdm.entity.create({
    details: {
      subtype: 'Person',
      name: 'Ana',
      academia: { plan: 'monthly' },
    },
  });

  await assert.rejects(
    () => academia.mdm.entity.update({
      mdmId: created.mdmId,
      expectedVersion: created.version,
      patch: {
        clinica: { allergy: 'penicillin' },
      },
    }),
    (error: unknown) => error instanceof AppError && error.code === 'MDM_FOREIGN_NAMESPACE',
  );
});

test('attachRole adds the module tag once and writes the caller namespace', async () => {
  const runtime = createMemoryDataRuntime();
  const platform = createRequestContext(runtime);
  const academia = createRequestContext(runtime, { moduleId: 'academia' });
  const created = await platform.mdm.entity.create({
    details: { subtype: 'Person', name: 'Ana' },
  });

  const attached = await academia.mdm.entity.attachRole(created.mdmId, 'Aluno', { plan: 'monthly' });
  assert.equal(attached.details.tags.includes('academia.Aluno'), true);
  assert.deepEqual(getMdmModuleTypesFrom(attached.details), ['academia.Aluno']);
  assert.deepEqual((attached.details as Record<string, unknown>).academia, { plan: 'monthly' });

  const again = await academia.mdm.entity.attachRole(created.mdmId, 'Aluno', { plan: 'yearly' });
  assert.equal(again.details.tags.filter((tag) => tag === 'academia.Aluno').length, 1);
  assert.deepEqual((again.details as Record<string, unknown>).academia, { plan: 'yearly' });
});

test('findByDocument and findByContact return the matching entity through the facade', async () => {
  const runtime = createMemoryDataRuntime();
  const ctx = createRequestContext(runtime, { moduleId: 'academia' });
  const person = await ctx.mdm.entity.create({
    details: {
      subtype: 'Person',
      name: 'Ana',
      docType: 'CPF',
      docId: '12345678901',
    },
  });
  const channel = await ctx.mdm.entity.create({
    details: {
      subtype: 'ContactChannel',
      name: 'Ana email',
      contactType: 'email',
      value: 'ana@example.com',
    },
  });

  const byDoc = await ctx.mdm.entity.findByDocument('CPF', '12345678901');
  const byContact = await ctx.mdm.entity.findByContact('email', 'ana@example.com');
  const missing = await ctx.mdm.entity.findByDocument('CPF', '000');

  assert.equal(byDoc?.mdmId, person.mdmId);
  assert.equal(byContact?.mdmId, channel.mdmId);
  assert.equal(missing, null);
});

test('listByType items carry projected details for the caller module', async () => {
  const runtime = createMemoryDataRuntime();
  const platform = createRequestContext(runtime);
  const academia = createRequestContext(runtime, { moduleId: 'academia' });
  const created = await platform.mdm.entity.create({
    details: {
      subtype: 'Person',
      name: 'Ana',
      moduleTypes: ['academia.Aluno'],
      clinica: { allergy: 'penicillin' },
      academia: { plan: 'monthly' },
    },
  });

  const listed = await academia.mdm.collection.listByType({ type: 'academia.Aluno' });
  assert.deepEqual(listed.items.map((item) => item.mdmId), [created.mdmId]);
  const details = listed.items[0]?.details as Record<string, unknown>;
  assert.deepEqual(details.academia, { plan: 'monthly' });
  assert.equal('clinica' in details, false);
  assert.deepEqual(details.namespaces, ['clinica']);
});

test('ctx.organization.countryCode is the installation country, never derived from language', async () => {
  const runtime = createMemoryDataRuntime();
  const overridden = createRequestContext(runtime, { organization: { countryCode: 'DE', currency: 'EUR' } });
  assert.equal(overridden.organization.countryCode, 'DE');
  assert.equal(overridden.organization.currency, 'EUR');

  const defaults = createRequestContext(createMemoryDataRuntime());
  assert.equal(typeof defaults.organization.countryCode, 'string');
  assert.match(defaults.organization.countryCode, /^[A-Z]{2}$/);
});

function getMdmModuleTypesFrom(details: MdmDetailRecord): string[] {
  return Array.isArray(details.moduleTypes) ? details.moduleTypes : [];
}
