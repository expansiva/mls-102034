/// <mls fileReference="_102034_/l1/mdm/registration.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { resetAlphaAuthoritiesCache } from '/_102034_/l1/server/layer_1_external/config/alphaAuthorities.js';
import type { OrganizationBinding } from '/_102034_/l1/server/layer_1_external/config/onboardingConfig.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { loadRegistrationScope } from '/_102034_/l1/server/layer_1_external/config/registrationScope.js';
import { resetResolvedTableDefinitionsCache } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import type { MdmKvRecord } from '/_102034_/l1/mdm/module.js';
import { ensureOrganizationCompany } from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';
import {
  listOrganizationAccessRequests,
  openAccessRequest,
  resolveAccessRequest,
} from '/_102034_/l1/mdm/layer_3_usecases/registrationRequests.js';
import { writeRegistrationStore } from '/_102034_/l1/mdm/layer_3_usecases/registrationStore.js';
import { requestRecordKey } from '/_102034_/l1/mdm/layer_3_usecases/selfRegistration.js';
import { listPendingAccessRequests, readAccessRequestState } from '/_102034_/l1/mdm/registration.js';

const previousCwd = process.cwd();
const workspace = mkdtempSync(join(tmpdir(), 'rt88-s3-'));
const configPath = join(workspace, 'config.json');

before(() => {
  symlinkSync(fileURLToPath(new URL('../..', import.meta.url)), join(workspace, 'mls-102034'));
  mkdirSync(join(workspace, 'dist', 'local', '_102099_', 'l5'), { recursive: true });
  writeFileSync(join(workspace, 'dist', 'local', '_102099_', 'l5', 'project.json'), JSON.stringify({
    orgName: 'Oficina Lima',
    appEnv: 'development',
  }));
  process.chdir(workspace);
  applyConfig({ alpha: true, onboarding: true });
  resetResolvedTableDefinitionsCache();
});

after(() => {
  process.chdir(previousCwd);
  resetProjectsConfigCache();
  resetAlphaAuthoritiesCache();
  resetResolvedTableDefinitionsCache();
  rmSync(workspace, { recursive: true, force: true });
});

function applyConfig(options: { alpha: boolean; onboarding: boolean; redirect?: boolean }): void {
  const onboarding = options.onboarding
    ? {
      moduleId: 'inicio',
      entryPath: '/inicio',
      personType: 'Aluno',
      companyType: 'inicio.Academia',
      organizationSource: 'development-project',
      ...(options.redirect === false ? { redirect: false } : {}),
    }
    : undefined;
  writeFileSync(configPath, JSON.stringify({
    defaultProjectId: '102099',
    alphaAllAuthorities: options.alpha,
    ...(onboarding ? { onboarding } : {}),
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
  resetProjectsConfigCache();
  resetAlphaAuthoritiesCache();
}

function moduleCtx(moduleId: string | undefined = 'inicio', projectId: string | undefined = '102099'): RequestContext {
  const ctx = createRequestContext(createMemoryDataRuntime(), {
    ...(moduleId ? { moduleId } : {}),
    sessionContext: { project: { projectId } },
  });
  ctx.clock = { nowIso: () => '2026-10-18T15:00:00.000Z' };
  ctx.requestMeta = { userId: 'telemetry@example.com', source: 'message' };
  return ctx;
}

async function snapshot(ctx: RequestContext): Promise<string> {
  const rows = await ctx.data.moduleData.getTable<MdmKvRecord>('mdmKv').then((table) => table.findMany({}));
  return JSON.stringify(rows);
}

async function seedPair(ctx: RequestContext, binding: OrganizationBinding, email: string): Promise<void> {
  const config = loadRegistrationScope().config;
  await ensureOrganizationCompany(ctx, binding, config);
  const ada = await ctx.mdm.entity.create({ details: { subtype: 'Person', name: 'Ada', countryCode: 'US' } });
  const grace = await ctx.mdm.entity.create({ details: { subtype: 'Person', name: 'Grace', countryCode: 'US' } });
  const mail = await ctx.mdm.entity.create({
    details: { subtype: 'ContactChannel', name: 'mail', contactType: 'Email', value: email, countryCode: 'US' },
  });
  await ctx.mdm.entity.link({ fromId: ada.mdmId, toId: mail.mdmId, type: 'HasContact' });
  await ctx.mdm.entity.link({ fromId: grace.mdmId, toId: mail.mdmId, type: 'HasContact' });
}

test('pending read needs no person and returns only id, status and version', async () => {
  applyConfig({ alpha: true, onboarding: true, redirect: false });
  const scope = loadRegistrationScope();
  assert.equal(scope.config.redirect, false);
  const ctx = moduleCtx();
  assert.equal(ctx.sessionContext.person, undefined);
  await seedPair(ctx, scope.binding, 'ada@example.com');
  const opened = await openAccessRequest(ctx, scope.binding, { email: 'ada@example.com', name: 'Ada' });
  const before = await snapshot(ctx);
  const state = await readAccessRequestState(ctx, { requestId: opened.requestId });
  assert.deepEqual(state, { requestId: opened.requestId, status: 'pending', version: 1 });
  assert.deepEqual(Object.keys(state).sort(), ['requestId', 'status', 'version']);
  assert.equal(await snapshot(ctx), before);
});

test('resolved state uses the stored person and the pending list omits it', async () => {
  applyConfig({ alpha: true, onboarding: true });
  const scope = loadRegistrationScope();
  const ctx = moduleCtx();
  await seedPair(ctx, scope.binding, 'ada@example.com');
  await seedPair(ctx, scope.binding, 'grace@example.com');
  const ada = await openAccessRequest(ctx, scope.binding, { email: 'ada@example.com', name: 'Ada' });
  const grace = await openAccessRequest(ctx, scope.binding, { email: 'grace@example.com', name: 'Grace' });
  const listed = await listOrganizationAccessRequests(ctx, scope.binding.key);
  const token = listed.find((row) => row.requestId === ada.requestId)?.candidateIds[0];
  assert.ok(token);
  const resolved = await resolveAccessRequest(ctx, scope.binding, scope.config, { email: 'ada@example.com', name: 'Ada' }, {
    requestId: ada.requestId,
    expectedVersion: 1,
    decision: 'use-existing',
    candidateId: token,
  });
  const before = await snapshot(ctx);
  const state = await readAccessRequestState(ctx, { requestId: ada.requestId });
  assert.deepEqual(state, {
    requestId: ada.requestId,
    status: 'resolved',
    version: resolved.version,
    person: { mdmId: resolved.person.mdmId },
  });
  assert.equal('email' in state, false);
  ctx.sessionContext.person = { mdmId: 'reader-1', email: 'reader@example.com', name: 'Reader' };
  const pending = await listPendingAccessRequests(ctx);
  assert.deepEqual(pending.map((row) => row.requestId), [grace.requestId]);
  assert.equal(pending.every((row) => row.status === 'pending'), true);
  assert.equal(await snapshot(ctx), before);
});

test('another organization, a missing id and a resolved record without a target are refused', async () => {
  applyConfig({ alpha: true, onboarding: true });
  const scope = loadRegistrationScope();
  const ctx = moduleCtx();
  await seedPair(ctx, scope.binding, 'ada@example.com');
  const other: OrganizationBinding = { key: 'org-other', name: 'Other', source: 'project-file' };
  const opened = await openAccessRequest(ctx, other, { email: 'ada@example.com', name: 'Ada' });
  await assert.rejects(
    () => readAccessRequestState(ctx, { requestId: opened.requestId }),
    (error: unknown) => error instanceof AppError && error.code === 'NOT_FOUND',
  );
  await assert.rejects(
    () => readAccessRequestState(ctx, { requestId: 'missing-id' }),
    (error: unknown) => error instanceof AppError && error.code === 'NOT_FOUND',
  );
  const own = await openAccessRequest(ctx, scope.binding, { email: 'ada@example.com', name: 'Ada' });
  const stored = await ctx.data.moduleData.getTable<MdmKvRecord>('mdmKv').then((table) => table.findMany({}));
  const row = stored.find((item) => item.key === requestRecordKey(own.requestId));
  assert.ok(row);
  await writeRegistrationStore(ctx, row.key, { ...row.value, status: 'resolved', resolvedMdmId: '  ' });
  await assert.rejects(
    () => readAccessRequestState(ctx, { requestId: own.requestId }),
    (error: unknown) => error instanceof AppError && error.code === 'ACCESS_REQUEST_INVALID',
  );
});

test('wrong or absent project and module are forbidden; telemetry is not a person', async () => {
  applyConfig({ alpha: true, onboarding: true });
  const scope = loadRegistrationScope();
  const ready = moduleCtx();
  await seedPair(ready, scope.binding, 'ada@example.com');
  const opened = await openAccessRequest(ready, scope.binding, { email: 'ada@example.com', name: 'Ada' });

  const wrongModule = moduleCtx('outro');
  wrongModule.data = ready.data;
  wrongModule.mdm = ready.mdm;
  await assert.rejects(
    () => readAccessRequestState(wrongModule, { requestId: opened.requestId }),
    (error: unknown) => error instanceof AppError && error.code === 'FORBIDDEN' && error.statusCode === 403,
  );
  const wrongProject = moduleCtx('inicio', '102000');
  wrongProject.data = ready.data;
  wrongProject.mdm = ready.mdm;
  await assert.rejects(
    () => readAccessRequestState(wrongProject, { requestId: opened.requestId }),
    (error: unknown) => error instanceof AppError && error.code === 'FORBIDDEN',
  );
  const absent = moduleCtx('inicio', '102099');
  absent.moduleId = undefined;
  absent.sessionContext.project.projectId = undefined;
  absent.data = ready.data;
  await assert.rejects(
    () => readAccessRequestState(absent, { requestId: opened.requestId }),
    (error: unknown) => error instanceof AppError && error.code === 'FORBIDDEN',
  );

  await assert.rejects(
    () => listPendingAccessRequests(ready),
    (error: unknown) => error instanceof AppError && error.code === 'FORBIDDEN',
  );
  ready.sessionContext.person = { mdmId: ' ', email: 'telemetry@example.com', name: 'Nope' };
  await assert.rejects(
    () => listPendingAccessRequests(ready),
    (error: unknown) => error instanceof AppError && error.code === 'FORBIDDEN',
  );
});

test('alpha off and omitted onboarding are not available', async () => {
  applyConfig({ alpha: false, onboarding: true });
  const ctx = moduleCtx();
  await assert.rejects(
    () => readAccessRequestState(ctx, { requestId: 'any' }),
    (error: unknown) => error instanceof AppError && error.code === 'NOT_AVAILABLE' && error.statusCode === 404,
  );
  await assert.rejects(
    () => listPendingAccessRequests(ctx),
    (error: unknown) => error instanceof AppError && error.code === 'NOT_AVAILABLE',
  );
  applyConfig({ alpha: true, onboarding: false });
  await assert.rejects(
    () => readAccessRequestState(ctx, { requestId: 'any' }),
    (error: unknown) => error instanceof AppError && error.code === 'NOT_AVAILABLE' && error.statusCode === 404,
  );
});
