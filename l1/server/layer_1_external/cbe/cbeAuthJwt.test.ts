import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeOrganizationId,
  availableOrganizations,
  sameSelectedSession,
  type CollabAuthClaims,
} from './cbeAuthJwt.js';

const claims = (sub: string, extra: Partial<CollabAuthClaims> = {}): CollabAuthClaims => ({
  sub,
  email: 'fixture@example.invalid',
  ...extra,
});

void test('orgs list never becomes an active organization, including one item', () => {
  assert.equal(activeOrganizationId(claims('user', { orgs: [] })), null);
  assert.equal(activeOrganizationId(claims('user', { orgs: [{ id: 'a', name: 'A' }] })), null);
  assert.equal(availableOrganizations(claims('user', { orgs: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] })).length, 2);
});

void test('signed active and legacy org claims must agree', () => {
  assert.equal(activeOrganizationId(claims('user', { active_org: { id: 'a' } })), 'a');
  assert.equal(activeOrganizationId(claims('user', { org_id: 'a' })), 'a');
  assert.equal(activeOrganizationId(claims('user', { org_id: 'a', active_org: { id: 'a' } })), 'a');
  assert.throws(() => activeOrganizationId(claims('user', { org_id: 'a', active_org: { id: 'b' } })));
});

void test('issuer response cannot switch subject or selected organization', () => {
  const original = claims('user', { orgs: [{ id: 'a', name: 'A' }] });
  assert.equal(sameSelectedSession(original, claims('user', { active_org: { id: 'a' } }), 'a'), true);
  assert.equal(sameSelectedSession(original, claims('another', { active_org: { id: 'a' } }), 'a'), false);
  assert.equal(sameSelectedSession(original, claims('user', { active_org: { id: 'b' } }), 'a'), false);
  assert.equal(sameSelectedSession(original, claims('user', { orgs: [{ id: 'a', name: 'A' }] }), 'a'), false);
});
