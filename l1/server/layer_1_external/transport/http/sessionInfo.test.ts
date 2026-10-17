/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/sessionInfo.test.ts" enhancement="_blank" />

// `/session/info` must surface the same authority union as `moduleAuthorities` (top-level ∪
// `active_org.teams[].roles`). The unused `authorities` field is gone: no reader consumed it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { claimAuthorities } from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';
import { resolveSessionInfoBody, sessionInfoBody } from '/_102034_/l1/server/layer_1_external/transport/http/startServer.js';
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
