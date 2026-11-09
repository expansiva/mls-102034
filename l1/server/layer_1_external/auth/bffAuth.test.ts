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

// rt197: the rejection names the condition, never a value.
async function rejectionLog(headers: Record<string, string>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try {
    await withDraftEnv(SECRET, async () => { await resolveBffSession(headers); });
  } finally {
    console.error = original;
  }
  return lines;
}

test('draft rejection log: missing-secret, secret-mismatch and bad-claims are told apart, with who answered', async () => {
  process.env.COLLAB_DRAFT = 'team-102047';
  process.env.COLLAB_PROJECT_ID = '102047';
  try {
    const missing = await rejectionLog({ 'x-collab-draft-identity': encoded(CLAIMS) });
    assert.match(missing.join('\n'), /draft identity rejected \(missing-secret\) draft=team-102047 project=102047 pid=\d+ up=\d+s/u);
    const mismatch = await rejectionLog({ 'x-collab-draft-identity-secret': 'b'.repeat(64), 'x-collab-draft-identity': encoded(CLAIMS) });
    assert.match(mismatch.join('\n'), /draft identity rejected \(secret-mismatch\) draft=team-102047 project=102047 pid=\d+ up=\d+s/u);
    const badClaims = await rejectionLog({ 'x-collab-draft-identity-secret': SECRET, 'x-collab-draft-identity': '%%%not-base64-json%%%' });
    assert.match(badClaims.join('\n'), /draft identity rejected \(bad-claims\)/u);
    for (const line of [...missing, ...mismatch, ...badClaims]) {
      assert.ok(!line.includes(SECRET) && !line.includes('b'.repeat(64)), 'o log nunca traz o segredo');
    }
  } finally {
    delete process.env.COLLAB_DRAFT;
    delete process.env.COLLAB_PROJECT_ID;
  }
});

test('draft rejection keeps the same outcome for the caller (invalid-token) whatever the condition', async () => {
  for (const headers of [
    { 'x-collab-draft-identity': encoded(CLAIMS) },
    { 'x-collab-draft-identity-secret': 'b'.repeat(64), 'x-collab-draft-identity': encoded(CLAIMS) },
    { 'x-collab-draft-identity-secret': SECRET, 'x-collab-draft-identity': '%%%' },
  ]) {
    await withDraftEnv(SECRET, async () => {
      assert.deepEqual(await resolveBffSession(headers), { reject: true, reason: 'invalid-token' });
    });
  }
});
