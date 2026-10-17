/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/registrationRequests.test.ts" enhancement="_blank" />
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
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import type { IDataRuntime } from '/_102034_/l1/server/layer_1_external/data/runtime.js';
import { ensureOrganizationCompany } from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';
import { MDM_LOGIN_NAMESPACE } from '/_102034_/l1/mdm/layer_3_usecases/identityUsecases.js';
import {
  listOrganizationAccessRequests,
  openAccessRequest,
  readOwnAccessRequest,
  resolveAccessRequest,
} from '/_102034_/l1/mdm/layer_3_usecases/registrationRequests.js';
import { setSelfRegistrationFault } from '/_102034_/l1/mdm/layer_3_usecases/selfRegistration.js';

const previousCwd = process.cwd();
const workspace = mkdtempSync(join(tmpdir(), 'rt82-s3-'));

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

function ctxAt(day: string, data?: IDataRuntime): RequestContext {
  const ctx = createRequestContext(data ?? createMemoryDataRuntime());
  ctx.clock = { nowIso: () => `${day}T15:00:00.000Z` };
  return ctx;
}

function binding(key: string, name = key): OrganizationBinding {
  return { key, name, source: 'project-file' };
}

function config(moduleId: string, personType = 'Aluno'): ProjectOnboardingConfig {
  return { moduleId, entryPath: '/inicio', personType, companyType: `${moduleId}.Academia` };
}

async function seedAmbiguous(ctx: RequestContext, email: string): Promise<{ ada: string; grace: string; mail: string }> {
  await ensureOrganizationCompany(ctx, binding('org-a'), config('mod-a'));
  await ensureOrganizationCompany(ctx, binding('org-b'), config('mod-b'));
  const ada = await ctx.mdm.entity.create({ details: { subtype: 'Person', name: 'Ada', countryCode: 'US' } });
  const grace = await ctx.mdm.entity.create({ details: { subtype: 'Person', name: 'Grace', countryCode: 'US' } });
  const mail = await ctx.mdm.entity.create({
    details: { subtype: 'ContactChannel', name: 'mail', contactType: 'Email', value: email, countryCode: 'US' },
  });
  await ctx.mdm.entity.link({ fromId: ada.mdmId, toId: mail.mdmId, type: 'HasContact' });
  await ctx.mdm.entity.link({ fromId: grace.mdmId, toId: mail.mdmId, type: 'HasContact' });
  return { ada: ada.mdmId, grace: grace.mdmId, mail: mail.mdmId };
}

async function personCount(ctx: RequestContext): Promise<number> {
  const people = await ctx.data.mdmEntityIndex.findMany({ where: { subtype: 'Person' } });
  return people.length;
}

async function loginCount(ctx: RequestContext, email: string): Promise<number> {
  const rows = await ctx.data.mdmTag.findMany({ where: { tag: email, namespace: MDM_LOGIN_NAMESPACE } });
  return rows.length;
}

test('a new service instance rereads the same pending request', async () => {
  const data = createMemoryDataRuntime();
  const ctx = ctxAt('2026-10-17', data);
  await seedAmbiguous(ctx, 'ada@example.com');
  const opened = await openAccessRequest(ctx, binding('org-a'), { email: ' Ada@Example.com ', name: 'Ada' });
  const again = await openAccessRequest(ctx, binding('org-a'), { email: 'ada@example.com', name: 'Ada' });
  assert.equal(again.requestId, opened.requestId);
  assert.equal(again.version, opened.version);
  const restarted = ctxAt('2026-10-18', data);
  const read = await readOwnAccessRequest(restarted, {
    requestId: opened.requestId,
    organizationKey: 'org-a',
    email: 'ada@example.com',
  });
  assert.deepEqual(read, { requestId: opened.requestId, status: 'pending', version: 1 });
  const listed = await listOrganizationAccessRequests(restarted, 'org-a');
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.requestId, opened.requestId);
  assert.equal(listed[0]?.email, 'ada@example.com');
  assert.equal(listed[0]?.candidateIds.length, 2);
  assert.equal(await listOrganizationAccessRequests(restarted, 'org-b').then((rows) => rows.length), 0);
  await assert.rejects(
    () => readOwnAccessRequest(restarted, { requestId: opened.requestId, organizationKey: 'org-b', email: 'ada@example.com' }),
    (error: unknown) => error instanceof AppError && error.code === 'NOT_FOUND',
  );
});

test('resend cannot rewrite the origin and an unknown token is refused', async () => {
  const ctx = ctxAt('2026-10-17');
  await seedAmbiguous(ctx, 'ada@example.com');
  const opened = await openAccessRequest(ctx, binding('org-a'), { email: 'ada@example.com', name: 'Ada' });
  await assert.rejects(
    () => openAccessRequest(ctx, binding('org-a'), { email: 'ada@example.com', name: 'Other' }),
    (error: unknown) => error instanceof AppError && error.code === 'ACCESS_REQUEST_IMMUTABLE',
  );
  const still = await readOwnAccessRequest(ctx, {
    requestId: opened.requestId,
    organizationKey: 'org-a',
    email: 'ada@example.com',
  });
  assert.equal(still.version, 1);
  const listed = await listOrganizationAccessRequests(ctx, 'org-a');
  assert.equal(listed[0]?.name, 'Ada');
  assert.equal(listed[0]?.email, 'ada@example.com');
  await assert.rejects(
    () => resolveAccessRequest(ctx, binding('org-a'), config('mod-a'), { email: 'ada@example.com', name: 'Ada' }, {
      requestId: opened.requestId,
      expectedVersion: 1,
      decision: 'use-existing',
      candidateId: 'not-a-token',
    }),
    (error: unknown) => error instanceof AppError && error.code === 'ACCESS_REQUEST_CANDIDATE_INVALID',
  );
  assert.equal((await readOwnAccessRequest(ctx, {
    requestId: opened.requestId,
    organizationKey: 'org-a',
    email: 'ada@example.com',
  })).status, 'pending');
});

test('a candidate that lost the contact is refused and create-new still uses the reservation', async () => {
  const ctx = ctxAt('2026-10-17');
  const seeded = await seedAmbiguous(ctx, 'ada@example.com');
  const opened = await openAccessRequest(ctx, binding('org-a'), { email: 'ada@example.com', name: 'Ada' });
  const listed = await listOrganizationAccessRequests(ctx, 'org-a');
  const token = listed[0]?.candidateIds[0];
  assert.ok(token);
  const relationships = await ctx.data.mdmRelationship.findMany({ where: { fromId: seeded.ada, type: 'HasContact' } });
  for (const relationship of relationships) {
    await ctx.data.mdmRelationship.delete({ where: { id: relationship.id } });
  }
  const graceRelationships = await ctx.data.mdmRelationship.findMany({ where: { fromId: seeded.grace, type: 'HasContact' } });
  for (const relationship of graceRelationships) {
    await ctx.data.mdmRelationship.delete({ where: { id: relationship.id } });
  }
  await assert.rejects(
    () => resolveAccessRequest(ctx, binding('org-a'), config('mod-a'), { email: 'resolver', name: 'Resolver' }, {
      requestId: opened.requestId,
      expectedVersion: 1,
      decision: 'use-existing',
      candidateId: token,
    }),
    (error: unknown) => error instanceof AppError && error.code === 'ACCESS_REQUEST_CANDIDATE_INVALID',
  );
  const before = await personCount(ctx);
  const resolved = await resolveAccessRequest(ctx, binding('org-a'), config('mod-a'), { email: 'resolver', name: 'Resolver' }, {
    requestId: opened.requestId,
    expectedVersion: 1,
    decision: 'create-new',
  });
  assert.equal(resolved.decision, 'create-new');
  assert.equal(await personCount(ctx), before + 1);
  assert.equal(await ctx.mdm.identity.findByLogin('ada@example.com'), resolved.person.mdmId);
  assert.notEqual(resolved.person.mdmId, seeded.ada);
  assert.equal(await loginCount(ctx, 'ada@example.com'), 1);
  const repeated = await resolveAccessRequest(ctx, binding('org-a'), config('mod-a'), { email: 'resolver', name: 'Resolver' }, {
    requestId: opened.requestId,
    expectedVersion: 1,
    decision: 'create-new',
  });
  assert.equal(repeated.version, resolved.version);
  assert.equal(await personCount(ctx), before + 1);
  assert.equal(await loginCount(ctx, 'ada@example.com'), 1);
});

test('concurrent decisions leave one winner and a second decision never overwrites', async () => {
  const ctx = ctxAt('2026-10-17');
  await seedAmbiguous(ctx, 'ada@example.com');
  const opened = await openAccessRequest(ctx, binding('org-a'), { email: 'ada@example.com', name: 'Ada' });
  const listed = await listOrganizationAccessRequests(ctx, 'org-a');
  const [firstToken, secondToken] = listed[0]?.candidateIds ?? [];
  assert.ok(firstToken && secondToken);
  const actor = { email: 'resolver', name: 'Resolver' };
  const inputA = {
    requestId: opened.requestId,
    expectedVersion: 1,
    decision: 'use-existing' as const,
    candidateId: firstToken,
  };
  const inputB = {
    requestId: opened.requestId,
    expectedVersion: 1,
    decision: 'create-new' as const,
  };
  const raced = await Promise.allSettled([
    resolveAccessRequest(ctx, binding('org-a'), config('mod-a'), actor, inputA),
    resolveAccessRequest(ctx, binding('org-a'), config('mod-a'), actor, inputB),
  ]);
  const won = raced.find((item) => item.status === 'fulfilled');
  const lost = raced.find((item) => item.status === 'rejected');
  assert.ok(won && won.status === 'fulfilled');
  assert.ok(lost && lost.status === 'rejected');
  assert.ok(lost.reason instanceof AppError && lost.reason.code === 'ACCESS_REQUEST_CONFLICT');
  const details = lost.reason.details;
  if (!(details !== null && typeof details === 'object' && 'version' in details && typeof details.version === 'number')) {
    assert.fail('conflict details.version');
  }
  assert.equal(details.version, won.value.version);
  const stored = await listOrganizationAccessRequests(ctx, 'org-a');
  assert.equal(stored[0]?.decision, won.value.decision);
  assert.equal(stored[0]?.version, won.value.version);
  assert.equal(stored[0]?.email, 'ada@example.com');
  assert.equal(stored[0]?.organizationKey, 'org-a');
  assert.equal(stored[0]?.requestId, opened.requestId);
  assert.equal(await loginCount(ctx, 'ada@example.com'), 1);
  const other = won.value.decision === 'create-new'
    ? inputA
    : { ...inputB, expectedVersion: won.value.version };
  await assert.rejects(
    () => resolveAccessRequest(ctx, binding('org-a'), config('mod-a'), actor, {
      ...other,
      expectedVersion: won.value.version,
    }),
    (error: unknown) => error instanceof AppError && error.code === 'ACCESS_REQUEST_CONFLICT',
  );
  const after = await listOrganizationAccessRequests(ctx, 'org-a');
  assert.equal(after[0]?.decision, won.value.decision);
  assert.equal(after[0]?.version, won.value.version);
  assert.equal(after[0]?.resolvedMdmId, won.value.person.mdmId);
});

test('a partial fault resumes the same reserved person', async () => {
  const ctx = ctxAt('2026-10-17');
  await seedAmbiguous(ctx, 'ada@example.com');
  const opened = await openAccessRequest(ctx, binding('org-a'), { email: 'ada@example.com', name: 'Ada' });
  const key = identityCacheKey('ada@example.com');
  await ctx.cache.set(key, { mdmId: 'stale', name: 'Stale' });
  setSelfRegistrationFault('after-create');
  await assert.rejects(
    () => resolveAccessRequest(ctx, binding('org-a'), config('mod-a'), { email: 'resolver', name: 'Resolver' }, {
      requestId: opened.requestId,
      expectedVersion: 1,
      decision: 'create-new',
    }),
    /self registration fault/,
  );
  setSelfRegistrationFault(null);
  assert.deepEqual(await ctx.cache.get(key), { mdmId: 'stale', name: 'Stale' });
  const midway = await personCount(ctx);
  const resolved = await resolveAccessRequest(ctx, binding('org-a'), config('mod-a'), { email: 'resolver', name: 'Resolver' }, {
    requestId: opened.requestId,
    expectedVersion: 1,
    decision: 'create-new',
  });
  assert.equal(await personCount(ctx), midway);
  assert.equal(await loginCount(ctx, 'ada@example.com'), 1);
  assert.equal(await ctx.cache.get(key), null);
  assert.equal(await ctx.mdm.identity.findByLogin('ada@example.com'), resolved.person.mdmId);
  const links = await ctx.data.mdmRelationship.findMany({ where: { fromId: resolved.person.mdmId, type: 'AssignedTo' } });
  assert.equal(links.filter((row) => row.role === 'member' && row.status === 'Active').length, 1);
});

test('an existing login is not overwritten by create-new', async () => {
  const ctx = ctxAt('2026-10-17');
  const seeded = await seedAmbiguous(ctx, 'ada@example.com');
  await ctx.mdm.identity.setLogin(seeded.ada, 'ada@example.com');
  const opened = await openAccessRequest(ctx, binding('org-a'), { email: 'ada@example.com', name: 'Ada' });
  const before = await personCount(ctx);
  await assert.rejects(
    () => resolveAccessRequest(ctx, binding('org-a'), config('mod-a'), { email: 'resolver', name: 'Resolver' }, {
      requestId: opened.requestId,
      expectedVersion: 1,
      decision: 'create-new',
    }),
    (error: unknown) => error instanceof AppError && error.code === 'MDM_LOGIN_TAKEN',
  );
  assert.equal(await ctx.mdm.identity.findByLogin('ada@example.com'), seeded.ada);
  assert.equal(await personCount(ctx), before);
  assert.equal((await readOwnAccessRequest(ctx, {
    requestId: opened.requestId,
    organizationKey: 'org-a',
    email: 'ada@example.com',
  })).status, 'pending');
});
