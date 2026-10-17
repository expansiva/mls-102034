/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/registrationCandidates.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { MdmRecordEntity } from '/_102034_/l1/mdm/layer_3_usecases/internal/MdmRecordStore.js';
import { findRegistrationCandidates } from '/_102034_/l1/mdm/layer_3_usecases/registrationCandidates.js';

function ctxAt(day: string): RequestContext {
  const ctx = createRequestContext();
  ctx.clock = { nowIso: () => `${day}T15:00:00.000Z` };
  return ctx;
}

async function person(ctx: RequestContext, name: string): Promise<string> {
  const created = await ctx.mdm.entity.create({
    details: { subtype: 'Person', name, countryCode: 'BR' },
  });
  return created.mdmId;
}

async function channel(
  ctx: RequestContext,
  contactType: string,
  value: string,
): Promise<string> {
  const created = await ctx.mdm.entity.create({
    details: { subtype: 'ContactChannel', name: value, contactType, value, countryCode: 'BR' },
  });
  return created.mdmId;
}

async function owns(
  ctx: RequestContext,
  fromId: string,
  toId: string,
  patch: { status?: 'Active' | 'Inactive' | 'PendingConfirmation'; validFrom?: string; validTo?: string | null } = {},
): Promise<void> {
  await ctx.mdm.entity.link({
    fromId,
    toId,
    type: 'HasContact',
    status: patch.status,
    validFrom: patch.validFrom,
    validTo: patch.validTo,
  });
}

async function summary(ctx: RequestContext, personId: string, channelId: string): Promise<void> {
  const current = await ctx.mdm.entity.get({ mdmId: personId });
  await ctx.mdm.entity.update({
    mdmId: personId,
    expectedVersion: current.version,
    patch: { contacts: [{ mdmId: channelId, title: 'email' }] },
  });
}

test('lists every person behind every matching channel and does not keep only the first', async () => {
  const ctx = ctxAt('2026-10-17');
  const ada = await person(ctx, 'Ada');
  const grace = await person(ctx, 'Grace');
  const first = await channel(ctx, 'Email', 'ada@example.com');
  const second = await channel(ctx, 'email', ' ADA@example.com ');
  await owns(ctx, ada, first);
  await owns(ctx, grace, second);
  const located = await MdmRecordEntity.findEntityByContact(ctx, 'Email', 'ada@example.com');
  assert.equal(located?.subtype, 'ContactChannel');
  const found = await findRegistrationCandidates(ctx, '  Ada@Example.com ');
  assert.deepEqual(found.map((item) => item.mdmId).sort(), [ada, grace].sort());
});

test('a channel with no owner is not a person', async () => {
  const ctx = ctxAt('2026-10-17');
  await channel(ctx, 'Email', 'solo@example.com');
  assert.deepEqual(await findRegistrationCandidates(ctx, 'solo@example.com'), []);
});

test('a persisted ContactSummary that points at the channel is a candidate', async () => {
  const ctx = ctxAt('2026-10-17');
  const ada = await person(ctx, 'Ada');
  const mail = await channel(ctx, 'Email', 'ada@example.com');
  await summary(ctx, ada, mail);
  assert.deepEqual(await findRegistrationCandidates(ctx, 'ada@example.com'), [{ mdmId: ada }]);
});

test('inactive, pending and out-of-window links are not owners', async () => {
  const ctx = ctxAt('2026-10-17');
  const inactive = await person(ctx, 'Inactive');
  const pending = await person(ctx, 'Pending');
  const ended = await person(ctx, 'Ended');
  const future = await person(ctx, 'Future');
  const open = await person(ctx, 'Open');
  const mail = await channel(ctx, 'Email', 'ada@example.com');
  await owns(ctx, inactive, mail, { status: 'Inactive' });
  await owns(ctx, pending, mail, { status: 'PendingConfirmation' });
  await owns(ctx, ended, mail, { validTo: '2026-10-16' });
  await owns(ctx, future, mail, { validFrom: '2026-10-18' });
  await owns(ctx, open, mail, { validFrom: '2026-10-17', validTo: '2026-10-17' });
  assert.deepEqual(await findRegistrationCandidates(ctx, 'ada@example.com'), [{ mdmId: open }]);
});

test('company, other contact types and a different email stay out', async () => {
  const ctx = ctxAt('2026-10-17');
  const ada = await person(ctx, 'Ada');
  const company = await ctx.mdm.entity.create({
    details: { subtype: 'Company', name: 'Acme', legalName: 'Acme Ltd', countryCode: 'BR', companyKind: 'LegalEntity' },
  });
  const mail = await channel(ctx, 'Email', 'ada@example.com');
  const phone = await channel(ctx, 'Phone', 'ada@example.com');
  const other = await channel(ctx, 'EMAIL', 'other@example.com');
  await owns(ctx, ada, mail);
  await owns(ctx, company.mdmId, mail);
  await owns(ctx, ada, phone);
  const stranger = await person(ctx, 'Stranger');
  await owns(ctx, stranger, other);
  await summary(ctx, company.mdmId, mail);
  assert.deepEqual(await findRegistrationCandidates(ctx, 'ada@example.com'), [{ mdmId: ada }]);
});

test('relationship and summary for the same person count once', async () => {
  const ctx = ctxAt('2026-10-17');
  const ada = await person(ctx, 'Ada');
  const mail = await channel(ctx, 'Email', 'ada@example.com');
  await owns(ctx, ada, mail);
  await summary(ctx, ada, mail);
  assert.deepEqual(await findRegistrationCandidates(ctx, 'ada@example.com'), [{ mdmId: ada }]);
});

test('blank email yields no candidates', async () => {
  const ctx = ctxAt('2026-10-17');
  assert.deepEqual(await findRegistrationCandidates(ctx, '   '), []);
});
