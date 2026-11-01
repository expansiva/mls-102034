/// <mls fileReference="_102034_/l1/server/layer_1_external/auth/bffAuth.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBffSession, type CollabAuthClaims } from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';

const SECRET = 'a'.repeat(64);
const CLAIMS: CollabAuthClaims = { sub: 'persona-1', email: 'persona@example.test', authorities: ['comandaRestaurante:garcom'] };

function encoded(claims: CollabAuthClaims): string {
  return Buffer.from(JSON.stringify(claims)).toString('base64url');
}

function withDraftEnv(value: string | undefined, run: () => Promise<void>): Promise<void> {
  const previous = process.env.COLLAB_DRAFT_IDENTITY_SECRET;
  if (value === undefined) delete process.env.COLLAB_DRAFT_IDENTITY_SECRET;
  else process.env.COLLAB_DRAFT_IDENTITY_SECRET = value;
  return run().finally(() => {
    if (previous === undefined) delete process.env.COLLAB_DRAFT_IDENTITY_SECRET;
    else process.env.COLLAB_DRAFT_IDENTITY_SECRET = previous;
  });
}

test('draft identity header is ignored when the draft secret env is absent', async () => {
  await withDraftEnv(undefined, async () => {
    const outcome = await resolveBffSession({
      'x-collab-draft-identity-secret': SECRET,
      'x-collab-draft-identity': encoded(CLAIMS),
    });
    assert.equal(outcome.reason, 'missing-token');
    assert.equal(outcome.reject, false);
    assert.equal(outcome.claims, undefined);
  });
});

test('draft process accepts claims when the secret matches', async () => {
  await withDraftEnv(SECRET, async () => {
    const outcome = await resolveBffSession({
      'x-collab-draft-identity-secret': SECRET,
      'x-collab-draft-identity': encoded(CLAIMS),
    });
    assert.equal(outcome.reject, false);
    assert.equal(outcome.reason, 'ok');
    assert.deepEqual(outcome.claims, CLAIMS);
  });
});

test('draft process rejects a wrong secret', async () => {
  await withDraftEnv(SECRET, async () => {
    const outcome = await resolveBffSession({
      'x-collab-draft-identity-secret': 'b'.repeat(64),
      'x-collab-draft-identity': encoded(CLAIMS),
    });
    assert.deepEqual(outcome, { reject: true, reason: 'invalid-token' });
  });
});

test('draft process stays anonymous when the identity headers are absent', async () => {
  await withDraftEnv(SECRET, async () => {
    const outcome = await resolveBffSession({});
    assert.deepEqual(outcome, { reject: false, reason: 'missing-token' });
  });
});

test('draft process rejects the right secret with claims that do not decode', async () => {
  await withDraftEnv(SECRET, async () => {
    for (const bad of ['!!!not-base64url-json', Buffer.from('[1,2]').toString('base64url'), Buffer.from('null').toString('base64url')]) {
      const outcome = await resolveBffSession({ 'x-collab-draft-identity-secret': SECRET, 'x-collab-draft-identity': bad });
      assert.deepEqual(outcome, { reject: true, reason: 'invalid-token' });
    }
    const missingClaims = await resolveBffSession({ 'x-collab-draft-identity-secret': SECRET });
    assert.deepEqual(missingClaims, { reject: true, reason: 'invalid-token' });
  });
});
