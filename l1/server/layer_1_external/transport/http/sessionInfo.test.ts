/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/sessionInfo.test.ts" enhancement="_blank" />

// `/session/info` must surface the same authority union as `moduleAuthorities` (top-level ∪
// `active_org.teams[].roles`). The unused `authorities` field is gone: no reader consumed it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { claimAuthorities } from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';
import { sessionInfoBody } from '/_102034_/l1/server/layer_1_external/transport/http/startServer.js';
import type { CollabAuthClaims } from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';

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
  assert.match(handler, /sessionInfoBody\(session, mode, override\)/);
  assert.doesNotMatch(handler, /\bauthorities:/);
});
