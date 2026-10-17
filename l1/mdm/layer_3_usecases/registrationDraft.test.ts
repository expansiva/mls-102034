/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/registrationDraft.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { projectDetailsForModule } from '/_102034_/l1/mdm/layer_3_usecases/mdmFacade.js';
import { createRegistrationEntity } from '/_102034_/l1/mdm/layer_3_usecases/internal/entityPersistence.js';
import { MdmDocumentEntity } from '/_102034_/l1/mdm/layer_3_usecases/internal/MdmDocumentStore.js';
import type { MdmDetailRecord } from '/_102034_/l1/mdm/module.js';

const consent = {
  consentedAt: '2026-10-17T12:00:00.000Z',
  consentVersion: 'v1',
  channel: 'web',
};

function isValidation(error: unknown): boolean {
  return error instanceof AppError && error.code === 'VALIDATION_ERROR';
}

async function draftPerson(
  runtime: ReturnType<typeof createMemoryDataRuntime>,
  detail: Record<string, unknown> = {},
) {
  const ctx = createRequestContext(runtime);
  const created = await createRegistrationEntity(ctx, {
    mdmId: ctx.idGenerator.newId(),
    detail: { subtype: 'Person', ...detail },
  });
  assert.equal(created.alreadyExists, false);
  return created.mdmId;
}

test('projectDetailsForModule keeps registrationDraft as a platform field', () => {
  const projected = projectDetailsForModule({
    mdmId: 'p1',
    subtype: 'Person',
    name: '',
    status: 'Active',
    countryCode: '',
    tags: [],
    aliases: [],
    contacts: [],
    relationshipRefs: {},
    addresses: [],
    registrationDraft: true,
    createdAt: '2026-10-17T00:00:00.000Z',
    updatedAt: '2026-10-17T00:00:00.000Z',
    clinica: { note: 'x' },
  } as MdmDetailRecord, 'academia') as Record<string, unknown>;
  assert.equal(projected.registrationDraft, true);
  assert.equal(projected.countryCode, '');
  assert.equal('clinica' in projected, false);
  assert.deepEqual(projected.namespaces, ['clinica']);
});

test('facade reads a person draft and a phone patch does not invent a country', async () => {
  const runtime = createMemoryDataRuntime();
  const mdmId = await draftPerson(runtime, {
    clinica: { note: 'hidden' },
    academia: { plan: 'monthly' },
  });
  const academia = createRequestContext(runtime, { moduleId: 'academia' });
  const read = await academia.mdm.entity.get({ mdmId });
  const details = read.details as Record<string, unknown>;
  assert.equal(details.registrationDraft, true);
  assert.equal(details.name, '');
  assert.equal(details.countryCode, '');
  assert.deepEqual(details.academia, { plan: 'monthly' });
  assert.equal('clinica' in details, false);
  assert.deepEqual(details.namespaces, ['clinica']);
  assert.equal((details.namespaces as string[]).includes('registrationDraft'), false);

  const stored = await runtime.mdmDocument.getMany({ mdmIds: [mdmId] });
  const parsed = MdmDocumentEntity.parseDetails(stored[0]!);
  assert.equal(parsed.registrationDraft, true);
  assert.equal(parsed.countryCode, '');
  assert.equal(parsed.name, '');
  assert.equal(stored[0]!.version, 1);
  const index = await runtime.mdmEntityIndex.findOne({ where: { mdmId } });
  assert.equal(index?.countryCode, '');
  assert.equal(index?.name, '');
  const audit = await runtime.mdmAuditLog.findMany({ where: { entityId: mdmId, action: 'create' } });
  assert.equal(audit.length, 1);
  const outbox = await runtime.mdmOutbox.findMany({ where: { aggregateType: 'MdmAuditLog' } });
  assert.equal(outbox.length >= 1, true);

  const patched = await academia.mdm.entity.update({
    mdmId,
    expectedVersion: read.version,
    patch: {
      contacts: [{ mdmId: 'ch-phone', title: '+15551212' }],
      academia: { plan: 'monthly', phone: '+15551212' },
    },
  });
  assert.equal(patched.version, 2);
  assert.equal(patched.details.countryCode, '');
  assert.equal(patched.details.registrationDraft, true);
  assert.equal(patched.details.name, '');
  assert.equal((patched.details.contacts as { title: string }[])[0]?.title, '+15551212');
  const after = MdmDocumentEntity.parseDetails((await runtime.mdmDocument.getMany({ mdmIds: [mdmId] }))[0]!);
  assert.equal(after.countryCode, '');
  const indexAfter = await runtime.mdmEntityIndex.findOne({ where: { mdmId } });
  assert.equal(indexAfter?.countryCode, '');
});

test('company draft has no invented legal name and completes only with the real one', async () => {
  const runtime = createMemoryDataRuntime();
  const ctx = createRequestContext(runtime);
  const mdmId = ctx.idGenerator.newId();
  await createRegistrationEntity(ctx, {
    mdmId,
    detail: { subtype: 'Company', name: '' },
  });
  const read = await ctx.mdm.entity.get({ mdmId });
  assert.equal(read.details.registrationDraft, true);
  assert.equal(read.details.countryCode, '');
  assert.equal(read.details.name, '');
  assert.equal((read.details as { legalName?: string }).legalName, '');
  const index = await runtime.mdmEntityIndex.findOne({ where: { mdmId } });
  assert.equal(index?.name, '');
  assert.equal(index?.countryCode, '');

  const still = await ctx.mdm.entity.update({
    mdmId,
    expectedVersion: read.version,
    patch: { tradeName: 'Loja' },
  });
  assert.equal(still.details.registrationDraft, true);
  assert.equal((still.details as { legalName?: string }).legalName, '');
  assert.equal(still.details.countryCode, '');

  const done = await ctx.mdm.entity.update({
    mdmId,
    expectedVersion: still.version,
    patch: { name: 'Acme', countryCode: 'us', legalName: 'Acme LLC' },
  });
  assert.equal(done.details.registrationDraft, undefined);
  assert.equal(done.details.countryCode, 'US');
  assert.equal(done.details.name, 'Acme');
  assert.equal((done.details as { legalName?: string }).legalName, 'Acme LLC');
  assert.equal(done.version, 3);
});

test('person draft completes with name, country and valid consent; protected gaps stay incomplete', async () => {
  const runtime = createMemoryDataRuntime();
  const platform = createRequestContext(runtime);

  const br = await draftPerson(runtime);
  const brRead = await platform.mdm.entity.get({ mdmId: br });
  const brOpen = await platform.mdm.entity.update({
    mdmId: br,
    expectedVersion: brRead.version,
    patch: { name: 'Ana', countryCode: 'br' },
  });
  assert.equal(brOpen.details.registrationDraft, true);
  assert.equal(brOpen.details.countryCode, 'BR');
  assert.equal(brOpen.details.status, 'Inactive');

  const revoked = await draftPerson(runtime);
  const revokedRead = await platform.mdm.entity.get({ mdmId: revoked });
  const revokedOpen = await platform.mdm.entity.update({
    mdmId: revoked,
    expectedVersion: revokedRead.version,
    patch: {
      name: 'Ana',
      countryCode: 'DE',
      privacyConsent: { ...consent, revokedAt: '2026-10-17T13:00:00.000Z' },
    },
  });
  assert.equal(revokedOpen.details.registrationDraft, true);
  assert.equal(revokedOpen.details.countryCode, 'DE');
  assert.equal(revokedOpen.details.status, 'Inactive');

  const complete = await draftPerson(runtime, { status: 'Blocked' });
  const completeRead = await platform.mdm.entity.get({ mdmId: complete });
  assert.equal(completeRead.details.status, 'Blocked');
  const finished = await platform.mdm.entity.update({
    mdmId: complete,
    expectedVersion: completeRead.version,
    patch: { name: 'Ana', countryCode: 'BR', privacyConsent: consent },
  });
  assert.equal(finished.details.registrationDraft, undefined);
  assert.equal(finished.details.countryCode, 'BR');
  assert.equal(finished.details.name, 'Ana');
  assert.equal(finished.details.status, 'Blocked');
  const doc = MdmDocumentEntity.parseDetails((await runtime.mdmDocument.getMany({ mdmIds: [complete] }))[0]!);
  assert.equal(doc.registrationDraft, undefined);
  assert.equal(doc.status, 'Blocked');
  const updates = await runtime.mdmAuditLog.findMany({ where: { entityId: complete, action: 'update' } });
  assert.equal(updates.length, 1);

  const us = await draftPerson(runtime);
  const usRead = await platform.mdm.entity.get({ mdmId: us });
  const usDone = await platform.mdm.entity.update({
    mdmId: us,
    expectedVersion: usRead.version,
    patch: { name: 'Ana', countryCode: 'US' },
  });
  assert.equal(usDone.details.registrationDraft, undefined);
  assert.equal(usDone.details.countryCode, 'US');
  assert.equal(usDone.details.status, 'Active');
});

test('public create keeps the normal contract and ignores a raw registrationDraft flag', async () => {
  const runtime = createMemoryDataRuntime();
  const platform = createRequestContext(runtime);

  await assert.rejects(
    () => platform.mdm.entity.create({ details: { subtype: 'Person', name: ' ' } }),
    isValidation,
  );
  await assert.rejects(
    () => platform.mdm.entity.create({ details: { subtype: 'Company', name: 'Acme', legalName: '' } }),
    isValidation,
  );
  await assert.rejects(
    () => platform.mdm.entity.create({
      details: { subtype: 'Person', registrationDraft: true },
    }),
    isValidation,
  );
  await assert.rejects(
    () => platform.mdm.entity.create({
      details: { subtype: 'Company', name: 'Acme', registrationDraft: true },
    }),
    isValidation,
  );

  const person = await platform.mdm.entity.create({
    details: { subtype: 'Person', name: 'Ana' },
  });
  assert.equal(person.details.countryCode, 'US');
  assert.equal(person.details.registrationDraft, undefined);
  assert.equal(person.version, 1);
  const index = await runtime.mdmEntityIndex.findOne({ where: { mdmId: person.mdmId } });
  assert.equal(index?.countryCode, 'US');
  assert.equal(index?.name, 'Ana');

  const flagged = await platform.mdm.entity.update({
    mdmId: person.mdmId,
    expectedVersion: person.version,
    patch: { registrationDraft: true, notes: 'ok' },
  });
  assert.equal(flagged.details.registrationDraft, undefined);
  assert.equal(flagged.details.countryCode, 'US');
  assert.equal((flagged.details as { notes?: string }).notes, 'ok');

  const draftId = await draftPerson(runtime);
  const draft = await platform.mdm.entity.get({ mdmId: draftId });
  const stripped = await platform.mdm.entity.update({
    mdmId: draftId,
    expectedVersion: draft.version,
    patch: { registrationDraft: false as unknown as true },
  });
  assert.equal(stripped.details.registrationDraft, true);
  assert.equal(stripped.details.countryCode, '');
});
