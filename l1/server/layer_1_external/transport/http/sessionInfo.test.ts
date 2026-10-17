/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/sessionInfo.test.ts" enhancement="_blank" />

// `/session/info` must surface the same authority union as `moduleAuthorities` (top-level ∪
// `active_org.teams[].roles`). The unused `authorities` field is gone: no reader consumed it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { resetResolvedTableDefinitionsCache } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { claimAuthorities } from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';
import { OnboardingConfigError } from '/_102034_/l1/server/layer_1_external/config/onboardingConfig.js';
import { openOrRecoverAccessRequest } from '/_102034_/l1/mdm/layer_3_usecases/selfRegistration.js';
import { normalizeRegistrationEmail } from '/_102034_/l1/mdm/layer_3_usecases/registrationCandidates.js';
import {
  resolveClientOnboardingEntry,
  resolveSessionInfoBody,
  sessionInfoBody,
  type SessionOnboardingSource,
} from '/_102034_/l1/server/layer_1_external/transport/http/startServer.js';
import type { CollabAuthClaims } from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';
import { applyVerifiedEmailToSession, createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';

const activeOrgOnly: CollabAuthClaims = {
  sub: 'u1',
  email: 'aluno@academia.test',
  active_org: {
    teams: [{ roles: ['mensalidadesAcademia:aluno', 'sites:admin'] }],
  },
};

function sameMembers(actual: readonly string[], expected: readonly string[]): void {
  assert.equal(actual.length, expected.length);
  assert.equal(new Set(actual).size, expected.length, 'no duplicates');
  assert.deepEqual(new Set(actual), new Set(expected));
}

test('claimAuthorities unions top-level and active_org.teams[].roles without duplicates', () => {
  sameMembers(claimAuthorities(activeOrgOnly), ['mensalidadesAcademia:aluno', 'sites:admin']);

  const union: CollabAuthClaims = {
    sub: 'u1',
    email: 'a@b.c',
    authorities: ['mensalidadesAcademia:aluno', 'mensalidadesAcademia:admin'],
    roles: ['mensalidadesAcademia:aluno'],
    active_org: { teams: [{ roles: ['mensalidadesAcademia:aluno', 'mensalidadesAcademia:responsavel'] }] },
  };
  sameMembers(claimAuthorities(union), [
    'mensalidadesAcademia:admin',
    'mensalidadesAcademia:aluno',
    'mensalidadesAcademia:responsavel',
  ]);

  assert.deepEqual(claimAuthorities(undefined), []);
  assert.deepEqual(claimAuthorities({ sub: 'u1', email: 'a@b.c' }), []);
});

test('/session/info with only active_org roles fills allAuthorities and realAuthorities', () => {
  const body = sessionInfoBody({ claims: activeOrgOnly, reject: false, reason: 'ok' }, 'development', null);
  assert.equal(body.authenticated, true);
  sameMembers(body.allAuthorities, ['mensalidadesAcademia:aluno', 'sites:admin']);
  sameMembers(body.realAuthorities, ['mensalidadesAcademia:aluno', 'sites:admin']);
  assert.equal(body.overridden, false);
  assert.equal('authorities' in body, false, 'the unused authorities field must not come back');
});

test('/session/info with top-level and active_org is the union without duplicates', () => {
  const claims: CollabAuthClaims = {
    sub: 'u1',
    email: 'a@b.c',
    authorities: ['mensalidadesAcademia:aluno', 'sites:admin'],
    roles: ['mensalidadesAcademia:aluno'],
    active_org: { teams: [{ roles: ['sites:admin', 'mensalidadesAcademia:responsavel'] }] },
  };
  const body = sessionInfoBody({ claims, reject: false, reason: 'ok' }, 'development', null);
  sameMembers(body.allAuthorities, [
    'mensalidadesAcademia:aluno',
    'mensalidadesAcademia:responsavel',
    'sites:admin',
  ]);
  sameMembers(body.realAuthorities, body.allAuthorities);
  assert.equal('authorities' in body, false);
});

test('/session/info without a session is anonymous with empty lists', () => {
  const body = sessionInfoBody({ reject: false, reason: 'missing-token' }, 'development', null);
  assert.equal(body.authenticated, false);
  assert.deepEqual(body.allAuthorities, []);
  assert.deepEqual(body.realAuthorities, []);
  assert.equal(body.email, null);
  assert.equal(body.userId, null);
  assert.equal('authorities' in body, false);
});

test('presentation override replaces allAuthorities and keeps realAuthorities from active_org', () => {
  const body = sessionInfoBody(
    { claims: activeOrgOnly, reject: false, reason: 'ok' },
    'presentation',
    { userId: 'u1', authorities: ['petShop:admin'], setAt: 'now' },
  );
  assert.deepEqual(body.allAuthorities, ['petShop:admin']);
  sameMembers(body.realAuthorities, ['mensalidadesAcademia:aluno', 'sites:admin']);
  assert.equal(body.overridden, true);
  assert.equal('authorities' in body, false);
});

test('/session/info handler uses claimAuthorities and does not emit authorities', () => {
  const source = readFileSync(new URL('./startServer.ts', import.meta.url), 'utf8');
  const start = source.indexOf("app.get('/session/info'");
  const end = source.indexOf("app.post('/session/authority-override'");
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /const ctx = createDefaultRequestContext\(\)/);
  assert.match(handler, /readAuthorityOverride\(ctx, session\.claims\.sub\)/);
  assert.match(handler, /resolveSessionInfoBody\(ctx, session, mode, override\)/);
  assert.doesNotMatch(handler, /sessionInfoBody\(session, mode, override\)/);
  assert.doesNotMatch(handler, /\bauthorities:/);
  assert.doesNotMatch(handler, /request\.(query|body)|meta\.userId/);
});

async function personWithLogin(
  ctx: ReturnType<typeof createRequestContext>,
  name: string,
  email: string,
) {
  const person = await ctx.mdm.entity.create({
    details: { subtype: 'Person', name, status: 'Active' },
  });
  await ctx.mdm.identity.setLogin(person.mdmId, email);
  return person;
}

function claimsFor(sub: string, email?: string): CollabAuthClaims {
  const claims = { sub, name: 'Oidc Name', picture: 'https://idp.example/a.png' };
  return (email ? { ...claims, email } : claims) as CollabAuthClaims;
}

test('resolveSessionInfoBody projects the MDM person of a linked login and keeps the IdP sub', async () => {
  const ctx = createRequestContext();
  const aluno = await personWithLogin(ctx, 'Aluno Sessao', 'sessao@academia.test');
  const session = { claims: claimsFor('auth-sub-aluno', 'sessao@academia.test'), reject: false, reason: 'ok' as const };
  const body = await resolveSessionInfoBody(ctx, session, 'presentation', {
    userId: 'auth-sub-aluno',
    authorities: ['petShop:admin'],
    setAt: 'now',
  });
  const viaBff = await applyVerifiedEmailToSession(ctx, ctx.sessionContext, 'sessao@academia.test');
  assert.deepEqual(body.person, { mdmId: aluno.mdmId });
  assert.equal(body.person?.mdmId, viaBff.person?.mdmId);
  assert.equal(body.userId, 'auth-sub-aluno');
  assert.equal(body.authenticated, true);
  assert.equal(body.email, 'sessao@academia.test');
  assert.equal(body.name, 'Oidc Name');
  assert.equal(body.picture, 'https://idp.example/a.png');
  assert.deepEqual(body.allAuthorities, ['petShop:admin']);
  assert.equal(body.overridden, true);
  assert.equal(JSON.stringify(body).includes('auth-token'), false);
  assert.deepEqual(Object.keys(body.person ?? {}), ['mdmId']);
});

test('resolveSessionInfoBody returns person null without a login row, without an e-mail, and when anonymous', async () => {
  const ctx = createRequestContext();
  const unbound = await resolveSessionInfoBody(
    ctx,
    { claims: claimsFor('sub-sem-vinculo', 'sem-login@academia.test'), reject: false, reason: 'ok' },
    'development',
    null,
  );
  const viaBff = await applyVerifiedEmailToSession(ctx, ctx.sessionContext, 'sem-login@academia.test');
  assert.equal(unbound.person, null);
  assert.equal(viaBff.person, undefined);
  assert.equal(unbound.userId, 'sub-sem-vinculo');
  assert.equal(unbound.authenticated, true);

  const noEmail = await resolveSessionInfoBody(
    ctx,
    { claims: claimsFor('sub-sem-email'), reject: false, reason: 'ok' },
    'development',
    null,
  );
  assert.equal(noEmail.person, null);
  assert.equal(noEmail.userId, 'sub-sem-email');

  const anonymous = await resolveSessionInfoBody(
    ctx,
    { reject: false, reason: 'missing-token' },
    'development',
    null,
  );
  assert.equal(anonymous.person, null);
  assert.equal(anonymous.authenticated, false);
  assert.equal(anonymous.userId, null);
});

test('resolveSessionInfoBody keeps two e-mails on two different people', async () => {
  const ctx = createRequestContext();
  const a = await personWithLogin(ctx, 'Pessoa A', 'a@academia.test');
  const b = await personWithLogin(ctx, 'Pessoa B', 'b@academia.test');
  const bodyA = await resolveSessionInfoBody(
    ctx,
    { claims: claimsFor('sub-a', 'a@academia.test'), reject: false, reason: 'ok' },
    'development',
    null,
  );
  const bodyB = await resolveSessionInfoBody(
    ctx,
    { claims: claimsFor('sub-b', 'b@academia.test'), reject: false, reason: 'ok' },
    'development',
    null,
  );
  const viaA = await applyVerifiedEmailToSession(ctx, ctx.sessionContext, 'a@academia.test');
  const viaB = await applyVerifiedEmailToSession(ctx, ctx.sessionContext, 'b@academia.test');
  assert.equal(bodyA.person?.mdmId, a.mdmId);
  assert.equal(bodyB.person?.mdmId, b.mdmId);
  assert.equal(bodyA.person?.mdmId, viaA.person?.mdmId);
  assert.equal(bodyB.person?.mdmId, viaB.person?.mdmId);
  assert.notEqual(bodyA.person?.mdmId, bodyB.person?.mdmId);
  assert.equal(bodyA.userId, 'sub-a');
  assert.equal(bodyB.userId, 'sub-b');
});

test('resolveSessionInfoBody returns person null when the MDM read fails and keeps the session fields', async () => {
  const ctx = createRequestContext();
  const aluno = await personWithLogin(ctx, 'Aluno Falha', 'falha@academia.test');
  ctx.cache.get = async () => {
    throw new Error('mdm read failed');
  };
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };
  try {
    const body = await resolveSessionInfoBody(
      ctx,
      { claims: claimsFor('sub-falha', 'falha@academia.test'), reject: false, reason: 'ok' },
      'development',
      null,
    );
    assert.equal(body.person, null);
    assert.equal(body.userId, 'sub-falha');
    assert.equal(body.authenticated, true);
    assert.equal(body.email, 'falha@academia.test');
    assert.equal(JSON.stringify(body).includes(aluno.mdmId), false);
    assert.equal(errors.some((line) => line.includes('falha@academia.test') || line.includes(aluno.mdmId)), false);
    assert.equal(errors.some((line) => line.includes('lookup-failed')), true);
  } finally {
    console.error = original;
  }
});

const entry = { entryPath: '/mod/pessoa', moduleBasePath: '/mod' };
const orgKey = 'org:rt83';

function enabledGate(companyMdmId?: string | null): SessionOnboardingSource {
  return { entry, organizationKey: orgKey, companyMdmId };
}

function page(path: string, aliases?: string[]) {
  return { path, entrypoint: '/page.js', tag: 'x-page', title: path, aliases };
}

function forbidWrites(ctx: ReturnType<typeof createRequestContext>): void {
  const refuse = async () => {
    throw new Error('GET /session/info wrote');
  };
  ctx.mdm.entity.create = refuse as typeof ctx.mdm.entity.create;
  ctx.mdm.entity.update = refuse as typeof ctx.mdm.entity.update;
  ctx.mdm.entity.link = refuse as typeof ctx.mdm.entity.link;
  ctx.mdm.identity.setLogin = refuse as typeof ctx.mdm.identity.setLogin;
  const getTable = ctx.data.moduleData.getTable.bind(ctx.data.moduleData);
  ctx.data.moduleData.getTable = (async (name: string) => {
    const table = await getTable(name);
    return new Proxy(table, {
      get(target, prop, receiver) {
        if (prop === 'upsert' || prop === 'insert' || prop === 'update' || prop === 'delete' || prop === 'save') {
          return refuse;
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }) as typeof ctx.data.moduleData.getTable;
}

test('resolveClientOnboardingEntry uses the client module route or alias and rejects a foreign module', () => {
  const apps = [
    { projectId: '100554', appId: 'inicio', basePath: '/master', routes: [page('/inicio/pessoa')] },
    {
      projectId: '102047',
      appId: 'inicio',
      basePath: '/inicio',
      routes: [page('/inicio/inicio_pessoa', ['/inicio', '/inicio/index.html'])],
    },
  ];
  assert.deepEqual(
    resolveClientOnboardingEntry({ moduleId: 'inicio', entryPath: '/inicio/inicio_pessoa' }, '102047', apps),
    { entryPath: '/inicio/inicio_pessoa', moduleBasePath: '/inicio' },
  );
  assert.equal(
    resolveClientOnboardingEntry({ moduleId: 'inicio', entryPath: '/inicio' }, '102047', apps).moduleBasePath,
    '/inicio',
  );
  assert.throws(
    () => resolveClientOnboardingEntry({ moduleId: 'inicio', entryPath: 'https://evil.test/inicio' }, '102047', apps),
    OnboardingConfigError,
  );
  assert.throws(
    () => resolveClientOnboardingEntry({ moduleId: 'ausente', entryPath: '/inicio' }, '102047', apps),
    /not a registered module/,
  );
  assert.throws(
    () => resolveClientOnboardingEntry({ moduleId: 'inicio', entryPath: '/outro' }, '102047', apps),
    /not a route of client module/,
  );
});

function useMdmWorkspace(): () => void {
  const previousCwd = process.cwd();
  const workspace = mkdtempSync(join(tmpdir(), 'rt83-s1-'));
  symlinkSync(fileURLToPath(new URL('../../../../../', import.meta.url)), join(workspace, 'mls-102034'));
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
  return () => {
    process.chdir(previousCwd);
    resetProjectsConfigCache();
    resetResolvedTableDefinitionsCache();
    rmSync(workspace, { recursive: true, force: true });
  };
}

test('onboarding session states come from the person predicate and the request index, without writes', async () => {
  const restore = useMdmWorkspace();
  try {
  const ctx = createRequestContext();
  const ready = await ctx.mdm.entity.create({
    details: { subtype: 'Person', name: 'Completa', status: 'Active', countryCode: 'US' },
  });
  await ctx.mdm.identity.setLogin(ready.mdmId, 'pronta@academia.test');
  const incomplete = await ctx.mdm.entity.create({
    details: { subtype: 'Person', name: 'Incompleta', status: 'Active', countryCode: 'BR' },
  });
  await ctx.mdm.identity.setLogin(incomplete.mdmId, 'incompleta@academia.test');
  const company = await ctx.mdm.entity.create({
    details: { subtype: 'Company', name: 'Org sem pais', legalName: 'Org sem pais', status: 'Active' },
  });
  const pendingEmail = normalizeRegistrationEmail('pendente@academia.test');
  const opened = await openOrRecoverAccessRequest(ctx, {
    organizationKey: orgKey,
    email: pendingEmail,
    name: 'Pendente',
    candidateMdmIds: [incomplete.mdmId],
  });
  forbidWrites(ctx);

  const readyBody = await resolveSessionInfoBody(
    ctx,
    { claims: claimsFor('sub-pronta', 'pronta@academia.test'), reject: false, reason: 'ok' },
    'development',
    null,
    enabledGate(company.mdmId),
  );
  assert.equal(readyBody.onboarding?.status, 'ready');
  assert.deepEqual(readyBody.person, { mdmId: ready.mdmId });
  assert.deepEqual(readyBody.company, { mdmId: company.mdmId });
  assert.equal(readyBody.userId, 'sub-pronta');
  assert.equal(readyBody.picture, 'https://idp.example/a.png');
  assert.equal(readyBody.onboarding?.entryPath, entry.entryPath);
  assert.equal(readyBody.onboarding?.requestId, undefined);

  const incompleteBody = await resolveSessionInfoBody(
    ctx,
    { claims: claimsFor('sub-inc', 'incompleta@academia.test'), reject: false, reason: 'ok' },
    'development',
    null,
    enabledGate(company.mdmId),
  );
  assert.equal(incompleteBody.onboarding?.status, 'incomplete');
  assert.deepEqual(incompleteBody.person, { mdmId: incomplete.mdmId });
  assert.deepEqual(incompleteBody.company, { mdmId: company.mdmId });

  const pendingBody = await resolveSessionInfoBody(
    ctx,
    { claims: claimsFor('sub-pend', pendingEmail), reject: false, reason: 'ok' },
    'development',
    null,
    enabledGate(null),
  );
  assert.equal(pendingBody.person, null);
  assert.equal(pendingBody.company, null);
  assert.equal(pendingBody.onboarding?.status, 'pending');
  assert.equal(pendingBody.onboarding?.requestId, opened.requestId);

  const unregistered = await resolveSessionInfoBody(
    ctx,
    { claims: claimsFor('sub-nova', 'nova@academia.test'), reject: false, reason: 'ok' },
    'development',
    null,
    enabledGate(null),
  );
  assert.equal(unregistered.person, null);
  assert.equal(unregistered.onboarding?.status, 'unregistered');
  assert.equal(unregistered.onboarding?.requestId, undefined);

  const anonymous = await resolveSessionInfoBody(
    ctx,
    { reject: false, reason: 'missing-token' },
    'development',
    null,
    enabledGate(company.mdmId),
  );
  assert.equal(anonymous.authenticated, false);
  assert.equal(anonymous.userId, null);
  assert.equal('onboarding' in anonymous, false);
  assert.equal('company' in anonymous, false);

  const legacy = await resolveSessionInfoBody(
    ctx,
    { claims: claimsFor('sub-pronta', 'pronta@academia.test'), reject: false, reason: 'ok' },
    'development',
    null,
    null,
  );
  assert.equal(legacy.person?.mdmId, ready.mdmId);
  assert.equal('onboarding' in legacy, false);
  assert.equal('company' in legacy, false);
  } finally {
    restore();
  }
});

test('a failed registration read is unavailable and is not unregistered', async () => {
  const ctx = createRequestContext();
  ctx.cache.get = async () => {
    throw new Error('mdm read failed');
  };
  const body = await resolveSessionInfoBody(
    ctx,
    { claims: claimsFor('sub-erro', 'erro@academia.test'), reject: false, reason: 'ok' },
    'development',
    null,
    enabledGate(null),
  );
  assert.equal(body.person, null);
  assert.equal(body.onboarding?.status, 'unavailable');
  assert.equal(body.onboarding?.requestId, undefined);
  assert.equal(body.userId, 'sub-erro');
});
