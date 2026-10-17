/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/selfRegistration.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { ProjectOnboardingConfig } from '/_102029_/l2/runtimeConfigTypes.js';
import { identityCacheKey } from '/_102034_/l1/server/layer_1_external/cache/identityCache.js';
import type { OrganizationBinding } from '/_102034_/l1/server/layer_1_external/config/onboardingConfig.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { resetResolvedTableDefinitionsCache } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { ensureOrganizationCompany } from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';
import { MDM_LOGIN_NAMESPACE } from '/_102034_/l1/mdm/layer_3_usecases/identityUsecases.js';
import {
  ensureSelfRegistration,
  setSelfRegistrationFault,
  type SelfRegistrationFault,
} from '/_102034_/l1/mdm/layer_3_usecases/selfRegistration.js';

const previousCwd = process.cwd();
const workspace = mkdtempSync(join(tmpdir(), 'rt82-s2-'));

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
  setSelfRegistrationFault(null);
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

function binding(key: string, name = key): OrganizationBinding {
  return { key, name, source: 'project-file' };
}

function config(moduleId: string, personType = 'Aluno'): ProjectOnboardingConfig {
  return {
    moduleId,
    entryPath: '/inicio',
    personType,
    companyType: `${moduleId}.Academia`,
  };
}

async function company(ctx: RequestContext, key: string, moduleId: string): Promise<void> {
  await ensureOrganizationCompany(ctx, binding(key), config(moduleId));
}

async function counts(ctx: RequestContext, email: string, personMdmId: string, companyMdmId: string) {
  const people = await ctx.data.mdmEntityIndex.findMany({ where: { subtype: 'Person' } });
  const logins = await ctx.data.mdmTag.findMany({
    where: { tag: email, namespace: MDM_LOGIN_NAMESPACE, entityId: personMdmId },
  });
  const person = await ctx.mdm.entity.get({ mdmId: personMdmId });
  const links = (await ctx.data.mdmRelationship.findMany({ where: { fromId: personMdmId } }))
    .filter((row) => row.type === 'AssignedTo' && row.toId === companyMdmId && row.role === 'member' && row.status === 'Active');
  return {
    people: people.length,
    logins: logins.length,
    roleTags: person.details.tags.filter((tag) => tag.endsWith('.Aluno') || tag.endsWith('.Socio')).length,
    links: links.length,
    version: person.version,
    name: person.details.name,
    countryCode: person.details.countryCode,
  };
}

test('two concurrent sends create one person, login, role and link', async () => {
  const ctx = ctxAt('2026-10-17');
  await company(ctx, 'org-a', 'mod-a');
  const org = await ensureOrganizationCompany(ctx, binding('org-a'), config('mod-a'));
  const actor = { email: ' Ada@Example.com ', name: 'Ada' };
  const [first, second] = await Promise.all([
    ensureSelfRegistration(ctx, binding('org-a'), config('mod-a'), actor),
    ensureSelfRegistration(ctx, binding('org-a'), config('mod-a'), actor),
  ]);
  assert.equal(first.status, 'incomplete');
  assert.equal(first.person?.mdmId, second.person?.mdmId);
  assert.equal(first.company.mdmId, org.companyMdmId);
  const seen = await counts(ctx, 'ada@example.com', first.person!.mdmId, org.companyMdmId);
  assert.equal(seen.people, 1);
  assert.equal(seen.logins, 1);
  assert.equal(seen.roleTags, 1);
  assert.equal(seen.links, 1);
  assert.equal(seen.name, 'Ada');
  assert.equal(seen.countryCode, '');
});

test('retry after each completed step keeps the same person and does not bump version again', async () => {
  const phases: SelfRegistrationFault[] = ['after-reserve', 'after-create', 'after-set-login', 'after-link'];
  const ctx = ctxAt('2026-10-17');
  const org = await ensureOrganizationCompany(ctx, binding('org-a'), config('mod-a'));
  const actor = { email: 'ada@example.com', name: 'Ada' };
  for (const phase of phases) {
    setSelfRegistrationFault(phase);
    await assert.rejects(() => ensureSelfRegistration(ctx, binding('org-a'), config('mod-a'), actor), /self registration fault/);
    setSelfRegistrationFault(null);
  }
  const done = await ensureSelfRegistration(ctx, binding('org-a'), config('mod-a'), { email: 'ada@example.com', name: 'Other' });
  const again = await ensureSelfRegistration(ctx, binding('org-a'), config('mod-a'), actor);
  assert.equal(done.person?.mdmId, again.person?.mdmId);
  const seen = await counts(ctx, 'ada@example.com', done.person!.mdmId, org.companyMdmId);
  assert.equal(seen.people, 1);
  assert.equal(seen.logins, 1);
  assert.equal(seen.roleTags, 1);
  assert.equal(seen.links, 1);
  assert.equal(seen.name, 'Ada');
  const version = seen.version;
  await ensureSelfRegistration(ctx, binding('org-a'), config('mod-a'), actor);
  const after = await ctx.mdm.entity.get({ mdmId: done.person!.mdmId });
  assert.equal(after.version, version);
});

test('another call with no local state finds the same person', async () => {
  const ctx = ctxAt('2026-10-17');
  await company(ctx, 'org-a', 'mod-a');
  const actor = { email: 'ada@example.com', name: 'Ada' };
  const first = await ensureSelfRegistration(ctx, binding('org-a'), config('mod-a'), actor);
  const second = await ensureSelfRegistration(ctx, binding('org-a'), config('mod-a'), actor);
  assert.equal(second.person?.mdmId, first.person?.mdmId);
  assert.equal(second.status, 'incomplete');
});

test('blank name and unknown country stay empty and incomplete', async () => {
  const ctx = ctxAt('2026-10-17');
  await company(ctx, 'org-a', 'mod-a');
  const result = await ensureSelfRegistration(ctx, binding('org-a'), config('mod-a'), { email: 'ada@example.com', name: '   ' });
  const person = await ctx.mdm.entity.get({ mdmId: result.person!.mdmId });
  assert.equal(person.details.name, '');
  assert.equal(person.details.countryCode, '');
  assert.equal(result.status, 'incomplete');
  assert.ok(person.details.privacyConsent == null);
});

test('an existing login is reused and its name and country stay', async () => {
  const ctx = ctxAt('2026-10-17');
  const org = await ensureOrganizationCompany(ctx, binding('org-a'), config('mod-a'));
  const created = await ctx.mdm.entity.create({
    details: { subtype: 'Person', name: 'Ada Lovelace', countryCode: 'US' },
  });
  await ctx.mdm.identity.setLogin(created.mdmId, 'ada@example.com');
  const result = await ensureSelfRegistration(
    ctx,
    binding('org-a'),
    config('mod-a'),
    { email: 'ADA@example.com', name: 'Replacement' },
  );
  assert.equal(result.status, 'ready');
  assert.equal(result.person?.mdmId, created.mdmId);
  const person = await ctx.mdm.entity.get({ mdmId: created.mdmId });
  assert.equal(person.details.name, 'Ada Lovelace');
  assert.equal(person.details.countryCode, 'US');
  const seen = await counts(ctx, 'ada@example.com', created.mdmId, org.companyMdmId);
  assert.equal(seen.people, 1);
  assert.equal(seen.logins, 1);
  assert.equal(seen.links, 1);
});

test('ambiguous contacts open one pending request and do not create a login', async () => {
  const ctx = ctxAt('2026-10-17');
  await company(ctx, 'org-a', 'mod-a');
  const ada = await ctx.mdm.entity.create({ details: { subtype: 'Person', name: 'Ada', countryCode: 'US' } });
  const grace = await ctx.mdm.entity.create({ details: { subtype: 'Person', name: 'Grace', countryCode: 'US' } });
  const mail = await ctx.mdm.entity.create({
    details: { subtype: 'ContactChannel', name: 'mail', contactType: 'Email', value: 'ada@example.com', countryCode: 'US' },
  });
  await ctx.mdm.entity.link({ fromId: ada.mdmId, toId: mail.mdmId, type: 'HasContact' });
  await ctx.mdm.entity.link({ fromId: grace.mdmId, toId: mail.mdmId, type: 'HasContact' });
  const first = await ensureSelfRegistration(ctx, binding('org-a'), config('mod-a'), { email: 'ada@example.com', name: 'Ada' });
  const second = await ensureSelfRegistration(ctx, binding('org-a'), config('mod-a'), { email: 'ada@example.com', name: 'Changed' });
  assert.equal(first.status, 'pending');
  assert.equal(first.person, undefined);
  assert.equal(second.requestId, first.requestId);
  assert.equal(await ctx.mdm.identity.findByLogin('ada@example.com'), null);
  const people = await ctx.data.mdmEntityIndex.findMany({ where: { subtype: 'Person' } });
  assert.equal(people.length, 2);
});

test('a different e-mail does not take the first person', async () => {
  const ctx = ctxAt('2026-10-17');
  await company(ctx, 'org-a', 'mod-a');
  const ada = await ensureSelfRegistration(ctx, binding('org-a'), config('mod-a'), { email: 'ada@example.com', name: 'Ada' });
  const grace = await ensureSelfRegistration(ctx, binding('org-a'), config('mod-a'), { email: 'grace@example.com', name: 'Grace' });
  assert.notEqual(grace.person?.mdmId, ada.person?.mdmId);
  assert.equal(await ctx.mdm.identity.findByLogin('grace@example.com'), grace.person?.mdmId);
});

test('two organizations share one login and keep separate requests out of each other', async () => {
  const ctx = ctxAt('2026-10-17');
  const first = await ensureOrganizationCompany(ctx, binding('org-a', 'A'), config('mod-a'));
  const second = await ensureOrganizationCompany(ctx, binding('org-b', 'B'), config('mod-b', 'Socio'));
  const ada = await ctx.mdm.entity.create({ details: { subtype: 'Person', name: 'Ada', countryCode: 'US' } });
  const grace = await ctx.mdm.entity.create({ details: { subtype: 'Person', name: 'Grace', countryCode: 'US' } });
  const mail = await ctx.mdm.entity.create({
    details: { subtype: 'ContactChannel', name: 'mail', contactType: 'Email', value: 'ada@example.com', countryCode: 'US' },
  });
  await ctx.mdm.entity.link({ fromId: ada.mdmId, toId: mail.mdmId, type: 'HasContact' });
  await ctx.mdm.entity.link({ fromId: grace.mdmId, toId: mail.mdmId, type: 'HasContact' });
  const pendingA = await ensureSelfRegistration(ctx, binding('org-a', 'A'), config('mod-a'), { email: 'ada@example.com', name: 'Ada' });
  const pendingB = await ensureSelfRegistration(ctx, binding('org-b', 'B'), config('mod-b', 'Socio'), { email: 'ada@example.com', name: 'Ada' });
  assert.equal(pendingA.status, 'pending');
  assert.notEqual(pendingB.requestId, pendingA.requestId);
  await ctx.mdm.identity.setLogin(ada.mdmId, 'ada@example.com');
  const resolved = await ensureSelfRegistration(ctx, binding('org-a', 'A'), config('mod-a'), { email: 'ada@example.com', name: 'Ada' });
  assert.equal(resolved.person?.mdmId, ada.mdmId);
  assert.equal(resolved.requestId, pendingA.requestId);
  assert.equal(resolved.status, 'ready');
  const still = await ensureSelfRegistration(ctx, binding('org-b', 'B'), config('mod-b', 'Socio'), { email: 'ada@example.com', name: 'Ada' });
  assert.equal(still.requestId, pendingB.requestId);
  assert.equal(still.person?.mdmId, ada.mdmId);
  const people = await ctx.data.mdmEntityIndex.findMany({ where: { subtype: 'Person' } });
  assert.equal(people.length, 2);
  const logins = await ctx.data.mdmTag.findMany({ where: { tag: 'ada@example.com', namespace: MDM_LOGIN_NAMESPACE } });
  assert.equal(logins.length, 1);
  const links = await ctx.data.mdmRelationship.findMany({ where: { fromId: ada.mdmId, type: 'AssignedTo' } });
  assert.equal(links.filter((row) => row.toId === first.companyMdmId).length, 1);
  assert.equal(links.filter((row) => row.toId === second.companyMdmId).length, 1);
});

test('parent cache is cleared only after success and stays untouched on a fault', async () => {
  const ctx = ctxAt('2026-10-17');
  await company(ctx, 'org-a', 'mod-a');
  const key = identityCacheKey('ada@example.com');
  await ctx.cache.set(key, { mdmId: 'stale', name: 'Stale' });
  setSelfRegistrationFault('after-reserve');
  await assert.rejects(
    () => ensureSelfRegistration(ctx, binding('org-a'), config('mod-a'), { email: 'ada@example.com', name: 'Ada' }),
    /self registration fault/,
  );
  setSelfRegistrationFault(null);
  assert.deepEqual(await ctx.cache.get(key), { mdmId: 'stale', name: 'Stale' });
  const done = await ensureSelfRegistration(ctx, binding('org-a'), config('mod-a'), { email: 'ada@example.com', name: 'Ada' });
  assert.equal(await ctx.cache.get(key), null);
  assert.notEqual(done.person?.mdmId, 'stale');
  const session = await ctx.mdm.identity.findByLogin('ada@example.com');
  assert.equal(session, done.person?.mdmId);
});
