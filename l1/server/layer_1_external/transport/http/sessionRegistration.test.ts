/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/sessionRegistration.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';

import type { ProjectOnboardingConfig } from '/_102029_/l2/runtimeConfigTypes.js';
import type { BffAuthOutcome } from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';
import { mintLocalTestCookie, setLocalTestConfigLoaderForTests } from '/_102034_/l1/server/layer_1_external/auth/localTestSession.js';
import type { LocalTestConfig } from '/_102034_/l1/server/layer_1_external/config/localTestConfig.js';
import type { OrganizationBinding } from '/_102034_/l1/server/layer_1_external/config/onboardingConfig.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { loadRegistrationScope as sharedLoadRegistrationScope } from '/_102034_/l1/server/layer_1_external/config/registrationScope.js';
import { resetResolvedTableDefinitionsCache } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { MDM_LOGIN_NAMESPACE } from '/_102034_/l1/mdm/layer_3_usecases/identityUsecases.js';
import { ensureOrganizationCompany } from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';
import {
  handleSessionRegistration,
  loadRegistrationScope,
  registerSessionRegistrationRoutes,
  type SessionRegistrationScope,
} from '/_102034_/l1/server/layer_1_external/transport/http/sessionRegistration.js';

const previousCwd = process.cwd();
const workspace = mkdtempSync(join(tmpdir(), 'rt82-s4-'));

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

function ctxAt(day: string): RequestContext {
  const ctx = createRequestContext(createMemoryDataRuntime());
  ctx.clock = { nowIso: () => `${day}T15:00:00.000Z` };
  return ctx;
}

function binding(key: string): OrganizationBinding {
  return { key, name: key, source: 'project-file' };
}

function config(moduleId: string): ProjectOnboardingConfig {
  return { moduleId, entryPath: '/inicio', personType: 'Aluno', companyType: `${moduleId}.Academia` };
}

function scope(key: string, moduleId: string): SessionRegistrationScope {
  return { binding: binding(key), config: config(moduleId) };
}

function session(email: string, name = 'Session Ada'): BffAuthOutcome {
  return { claims: { sub: 'auth-sub', email, name }, reject: false, reason: 'ok' };
}

async function personCount(ctx: RequestContext): Promise<number> {
  return (await ctx.data.mdmEntityIndex.findMany({ where: { subtype: 'Person' } })).length;
}

async function loginCount(ctx: RequestContext, email: string): Promise<number> {
  return (await ctx.data.mdmTag.findMany({ where: { tag: email, namespace: MDM_LOGIN_NAMESPACE } })).length;
}

async function seedAmbiguous(ctx: RequestContext, email: string): Promise<void> {
  await ensureOrganizationCompany(ctx, binding('org-a'), config('mod-a'));
  const ada = await ctx.mdm.entity.create({ details: { subtype: 'Person', name: 'Ada', countryCode: 'US' } });
  const grace = await ctx.mdm.entity.create({ details: { subtype: 'Person', name: 'Grace', countryCode: 'US' } });
  const mail = await ctx.mdm.entity.create({
    details: { subtype: 'ContactChannel', name: 'mail', contactType: 'Email', value: email, countryCode: 'US' },
  });
  await ctx.mdm.entity.link({ fromId: ada.mdmId, toId: mail.mdmId, type: 'HasContact' });
  await ctx.mdm.entity.link({ fromId: grace.mdmId, toId: mail.mdmId, type: 'HasContact' });
}

test('register uses the session and ignores identity fields in the body', async () => {
  const ctx = ctxAt('2026-10-17');
  await ensureOrganizationCompany(ctx, binding('org-a'), config('mod-a'));
  const before = await personCount(ctx);
  const ignored = await handleSessionRegistration(ctx, session('ada@example.com', 'Session Ada'), {
    kind: 'read-own',
    requestId: 'missing',
    alphaFollowUp: false,
    loadScope: () => scope('org-a', 'mod-a'),
  });
  assert.equal(ignored.statusCode, 404);
  assert.equal(await personCount(ctx), before);

  const registered = await handleSessionRegistration(ctx, session('ada@example.com', 'Session Ada'), {
    kind: 'register',
    body: { email: 'mallory@example.com', name: 'Body Mallory', mdmId: 'mdm-body' },
    alphaFollowUp: false,
    loadScope: () => scope('org-a', 'mod-a'),
  });
  assert.equal(registered.statusCode, 200);
  assert.equal(registered.body.ok, true);
  const data = registered.body.data as { status: string; person?: { mdmId: string } };
  assert.equal(data.status, 'incomplete');
  assert.equal(await personCount(ctx), before + 1);
  assert.equal(await loginCount(ctx, 'ada@example.com'), 1);
  assert.equal(await loginCount(ctx, 'mallory@example.com'), 0);
  const person = await ctx.mdm.entity.get({ mdmId: data.person?.mdmId ?? '' });
  assert.equal(person.details.name, 'Session Ada');
});

test('own read, org list and resolve stay on id and token', async () => {
  const ctx = ctxAt('2026-10-17');
  const email = 'shared@example.com';
  await seedAmbiguous(ctx, email);
  const before = await personCount(ctx);
  const opened = await handleSessionRegistration(ctx, session(email), {
    kind: 'register',
    body: { email: 'other@example.com', organizationKey: 'org-b' },
    alphaFollowUp: false,
    loadScope: () => scope('org-a', 'mod-a'),
  });
  assert.equal(opened.body.ok, true);
  const pending = opened.body.data as { status: string; requestId?: string };
  assert.equal(pending.status, 'pending');
  assert.equal(typeof pending.requestId, 'string');
  assert.equal(await personCount(ctx), before);

  const own = await handleSessionRegistration(ctx, session(email), {
    kind: 'read-own',
    requestId: pending.requestId,
    alphaFollowUp: false,
    loadScope: () => scope('org-a', 'mod-a'),
  });
  assert.equal(own.statusCode, 200);
  assert.equal(await personCount(ctx), before);
  const ownData = own.body.data as { requestId: string; status: string };
  assert.equal(ownData.requestId, pending.requestId);
  assert.equal(ownData.status, 'pending');
  assert.equal('email' in (own.body.data as object), false);

  const stranger = await handleSessionRegistration(ctx, session('stranger@example.com'), {
    kind: 'read-own',
    requestId: pending.requestId,
    alphaFollowUp: true,
    loadScope: () => scope('org-a', 'mod-a'),
  });
  assert.equal(stranger.statusCode, 404);
  assert.equal(stranger.body.error?.code, 'NOT_FOUND');

  const closed = await handleSessionRegistration(ctx, session(email), {
    kind: 'list',
    alphaFollowUp: false,
    loadScope: () => scope('org-a', 'mod-a'),
  });
  assert.equal(closed.statusCode, 404);
  assert.equal(closed.body.error?.code, 'NOT_AVAILABLE');

  const otherOrg = await handleSessionRegistration(ctx, session(email), {
    kind: 'list',
    alphaFollowUp: true,
    loadScope: () => scope('org-b', 'mod-b'),
  });
  assert.equal(otherOrg.statusCode, 200);
  assert.deepEqual(otherOrg.body.data, []);

  const listed = await handleSessionRegistration(ctx, session(email), {
    kind: 'list',
    alphaFollowUp: true,
    loadScope: () => scope('org-a', 'mod-a'),
  });
  assert.equal(listed.statusCode, 200);
  const rows = listed.body.data as Array<{ requestId: string; candidateIds: string[]; organizationKey: string }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].requestId, pending.requestId);
  assert.equal(rows[0].organizationKey, 'org-a');
  assert.equal(rows[0].candidateIds.length, 2);
  assert.equal(JSON.stringify(rows).includes('mdmId'), false);

  const forged = await handleSessionRegistration(ctx, session('admin@example.com'), {
    kind: 'resolve',
    alphaFollowUp: true,
    loadScope: () => scope('org-a', 'mod-a'),
    body: {
      requestId: pending.requestId,
      expectedVersion: 1,
      decision: 'use-existing',
      candidateId: rows[0].candidateIds[0],
      email: email,
      mdmId: 'mdm-forged',
      name: 'Forged',
      organizationKey: 'org-b',
    },
  });
  assert.equal(forged.statusCode, 400);
  assert.equal(forged.body.error?.code, 'VALIDATION_ERROR');
  assert.equal(await personCount(ctx), before);

  const badToken = await handleSessionRegistration(ctx, session('admin@example.com'), {
    kind: 'resolve',
    alphaFollowUp: true,
    loadScope: () => scope('org-a', 'mod-a'),
    body: { requestId: pending.requestId, expectedVersion: 1, decision: 'use-existing', candidateId: 'not-a-token' },
  });
  assert.equal(badToken.statusCode, 409);
  assert.equal(badToken.body.error?.code, 'ACCESS_REQUEST_CANDIDATE_INVALID');

  const resolved = await handleSessionRegistration(ctx, session('admin@example.com'), {
    kind: 'resolve',
    alphaFollowUp: true,
    loadScope: () => scope('org-a', 'mod-a'),
    body: { requestId: pending.requestId, expectedVersion: 1, decision: 'use-existing', candidateId: rows[0].candidateIds[0] },
  });
  assert.equal(resolved.statusCode, 200);
  assert.equal(resolved.body.ok, true);
  const again = await handleSessionRegistration(ctx, session('admin@example.com'), {
    kind: 'resolve',
    alphaFollowUp: true,
    loadScope: () => scope('org-a', 'mod-a'),
    body: { requestId: pending.requestId, expectedVersion: 1, decision: 'use-existing', candidateId: rows[0].candidateIds[0] },
  });
  assert.equal(again.statusCode, 200);
  const clash = await handleSessionRegistration(ctx, session('admin@example.com'), {
    kind: 'resolve',
    alphaFollowUp: true,
    loadScope: () => scope('org-a', 'mod-a'),
    body: { requestId: pending.requestId, expectedVersion: 1, decision: 'create-new' },
  });
  assert.equal(clash.statusCode, 409);
  assert.equal(clash.body.error?.code, 'ACCESS_REQUEST_CONFLICT');
  const details = clash.body.error?.details as { status?: string; version?: number };
  assert.equal(details.status, 'resolved');
  assert.equal(typeof details.version, 'number');
  assert.equal(await personCount(ctx), before);
  assert.equal(await loginCount(ctx, email), 1);
});

test('create-new is the persisted decision, not a client flag on register', async () => {
  const ctx = ctxAt('2026-10-17');
  const email = 'fresh@example.com';
  await seedAmbiguous(ctx, email);
  const before = await personCount(ctx);
  const opened = await handleSessionRegistration(ctx, session(email, 'Fresh'), {
    kind: 'register',
    alphaFollowUp: false,
    loadScope: () => scope('org-a', 'mod-a'),
  });
  const pending = opened.body.data as { requestId: string };
  const created = await handleSessionRegistration(ctx, session('resolver@example.com', 'Resolver'), {
    kind: 'resolve',
    alphaFollowUp: true,
    loadScope: () => scope('org-a', 'mod-a'),
    body: { requestId: pending.requestId, expectedVersion: 1, decision: 'create-new' },
  });
  assert.equal(created.statusCode, 200);
  assert.equal(await personCount(ctx), before + 1);
  assert.equal(await loginCount(ctx, email), 1);
});

test('missing claims are 401 and anonymous Fastify routes ignore a body identity', async () => {
  const ctx = ctxAt('2026-10-17');
  await ensureOrganizationCompany(ctx, binding('org-a'), config('mod-a'));
  const noEmail = await handleSessionRegistration(ctx, { claims: { sub: 'u', email: '' }, reject: false, reason: 'ok' }, {
    kind: 'register',
    body: { email: 'ada@example.com', name: 'Ada' },
    alphaFollowUp: true,
    loadScope: () => scope('org-a', 'mod-a'),
  });
  assert.equal(noEmail.statusCode, 401);
  assert.equal(noEmail.body.error?.code, 'UNAUTHENTICATED');
  const noClaims = await handleSessionRegistration(ctx, { reject: false, reason: 'missing-token' }, {
    kind: 'list',
    alphaFollowUp: true,
    loadScope: () => scope('org-a', 'mod-a'),
  });
  assert.equal(noClaims.statusCode, 401);

  const app = Fastify({ logger: false });
  registerSessionRegistrationRoutes(app, {
    refreshedAuthCookie: (token) => `cauth=${token}`,
    createContext: () => ctx,
    loadScope: () => scope('org-a', 'mod-a'),
  });
  const register = await app.inject({
    method: 'POST',
    url: '/session/register',
    payload: { email: 'ada@example.com', name: 'Ada', mdmId: 'mdm-1' },
  });
  assert.equal(register.statusCode, 401);
  assert.equal(register.headers['cache-control'], 'no-store');
  assert.equal(register.json().error.code, 'UNAUTHENTICATED');
  const listed = await app.inject({ method: 'GET', url: '/session/registration/requests' });
  assert.equal(listed.statusCode, 401);
  const resolve = await app.inject({
    method: 'POST',
    url: '/session/registration/resolve',
    payload: { email: 'ada@example.com', requestId: 'r', expectedVersion: 1, decision: 'create-new' },
  });
  assert.equal(resolve.statusCode, 401);
  assert.equal(await personCount(ctx), 0);
  assert.equal(await loginCount(ctx, 'ada@example.com'), 0);
  await app.close();
});

test('route default loader runs when loadScope is omitted and reports missing onboarding', async () => {
  const projectId = '102099';
  const origin = 'http://localhost:2099';
  const bench: LocalTestConfig = {
    enabled: true,
    projectId,
    organizationKey: 'org-bench',
    companyMdmId: 'company-1',
    cmOrgId: `runtime-test:${projectId}`,
    cmTarget: 'http://127.0.0.1:8180',
    storagePrefix: 'desenv_',
    allowedOrigins: [origin],
    cookieKey: 'k'.repeat(32),
    personas: {
      responsavel: {
        alias: 'responsavel',
        email: 'ada@example.com',
        name: 'Ada',
        sub: `local-test:${projectId}:responsavel`,
        personMdmId: 'person-1',
        cmUserId: 'cm-1',
      },
      membro: {
        alias: 'membro',
        email: 'membro@example.com',
        name: 'Membro',
        sub: `local-test:${projectId}:membro`,
        personMdmId: 'person-2',
        cmUserId: 'cm-2',
      },
    },
  };
  setLocalTestConfigLoaderForTests(() => bench);
  const ctx = ctxAt('2026-10-18');
  const app = Fastify({ logger: false });
  registerSessionRegistrationRoutes(app, {
    refreshedAuthCookie: (token) => `cauth=${token}`,
    createContext: () => ctx,
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/session/register',
      headers: {
        host: 'localhost:2099',
        origin,
        cookie: `collab_local_test_${projectId}=${mintLocalTestCookie('responsavel', bench)}`,
      },
      payload: { email: 'mallory@example.com' },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.json().error.code, 'NOT_AVAILABLE');
    assert.equal(await personCount(ctx), 0);
  } finally {
    setLocalTestConfigLoaderForTests();
    await app.close();
  }
});

test('HTTP reexports the shared loader and old injections omit projectId', () => {
  assert.equal(loadRegistrationScope, sharedLoadRegistrationScope);
  const injected: SessionRegistrationScope = scope('org-a', 'mod-a');
  assert.equal('projectId' in injected, false);
  assert.throws(
    () => loadRegistrationScope(),
    (error: { code?: string }) => error?.code === 'NOT_AVAILABLE',
  );
});

test('startServer registers the doors only with onboarding and before the catch-all', () => {
  const source = readFileSync(new URL('./startServer.ts', import.meta.url), 'utf8');
  const call = source.indexOf('registerSessionRegistrationRoutes(app, { refreshedAuthCookie })');
  const catchAll = source.indexOf("app.get('/*'");
  assert.ok(call > 0 && catchAll > call);
  const window = source.slice(Math.max(0, call - 220), call + 80);
  assert.match(window, /readOnboardingConfig\(readProjectsConfig\(\)\)/);
  assert.doesNotMatch(window, /requestMeta|verifiedEmail|body\.email/);
});
