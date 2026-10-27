/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeProviderToken.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { handleProviderToken, type ProviderTokenReply } from '/_102034_/l1/server/layer_1_external/cbe/cbeProviderToken.js';

const ENV_KEYS = [
  'COLLAB_GITHUB_CLIENT_ID',
  'COLLAB_GITHUB_CLIENT_SECRET',
  'COLLAB_GITLAB_CLIENT_ID',
  'COLLAB_GITLAB_CLIENT_SECRET',
] as const;

const saved: Record<string, string | undefined> = {};

function saveEnv(): void {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

function setEnv(): void {
  process.env.COLLAB_GITHUB_CLIENT_ID = 'gh-id';
  process.env.COLLAB_GITHUB_CLIENT_SECRET = 'gh-secret';
  process.env.COLLAB_GITLAB_CLIENT_ID = 'gl-id';
  process.env.COLLAB_GITLAB_CLIENT_SECRET = 'gl-secret';
}

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

function capture(): { sent: { status?: number; body?: unknown }; reply: ProviderTokenReply } {
  const sent: { status?: number; body?: unknown } = {};
  const reply: ProviderTokenReply = {
    code(status: number) {
      sent.status = status;
      return { send(body: unknown) { sent.body = body; } };
    },
  };
  return { sent, reply };
}

saveEnv();
afterEach(() => {
  restoreEnv();
});

describe('providerToken', () => {
  it('returns 401 without a collab-auth email', async () => {
    setEnv();
    const { sent, reply } = capture();
    await handleProviderToken(
      { headers: { host: '102047.collabcodes.com' } },
      { source: 'github', code: 'abc', redirectUri: 'https://102047.collabcodes.com?source=github' },
      reply,
      {},
    );
    assert.equal(sent.status, 401);
  });

  it('returns 400 when the redirect host differs', async () => {
    setEnv();
    const { sent, reply } = capture();
    let called = false;
    await handleProviderToken(
      { headers: { host: '102047.collabcodes.com' } },
      { source: 'github', code: 'abc', redirectUri: 'https://evil.example?source=github' },
      reply,
      { email: 'a@collab.codes' },
      () => { called = true; return Promise.reject(new Error('fetch')); },
    );
    assert.equal(sent.status, 400);
    assert.equal(called, false);
  });

  it('returns 503 and names the missing key', async () => {
    clearEnv();
    process.env.COLLAB_GITHUB_CLIENT_ID = 'gh-id';
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); };
    try {
      const { sent, reply } = capture();
      await handleProviderToken(
        { headers: { host: '102047.collabcodes.com' } },
        { source: 'github', code: 'abc', redirectUri: 'https://102047.collabcodes.com?source=github' },
        reply,
        { email: 'a@collab.codes' },
      );
      assert.equal(sent.status, 503);
      assert.deepEqual((sent.body as { error: string }).error, 'PROVIDER_NOT_CONFIGURED');
      assert.ok(errors.some((line) => line.includes('COLLAB_GITHUB_CLIENT_SECRET')));
      assert.equal(errors.some((line) => line.includes('gh-id')), false);
    } finally {
      console.error = original;
    }
  });

  it('returns 502 when the provider omits access_token and does not log the body', async () => {
    setEnv();
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); };
    try {
      const { sent, reply } = capture();
      await handleProviderToken(
        { headers: { host: '102047.collabcodes.com' } },
        { source: 'github', code: 'abc', redirectUri: 'https://102047.collabcodes.com?source=github' },
        reply,
        { email: 'a@collab.codes' },
        () => Promise.resolve(new Response(JSON.stringify({
          error: 'bad_verification_code',
          decoy: 'token-must-not-appear',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
      );
      assert.equal(sent.status, 502);
      assert.equal((sent.body as { error: string }).error, 'PROVIDER_EXCHANGE_FAILED');
      const log = errors.join('\n');
      assert.ok(log.includes('bad_verification_code'));
      assert.equal(log.includes('token-must-not-appear'), false);
      assert.equal(log.includes('gh-secret'), false);
    } finally {
      console.error = original;
    }
  });

  it('returns 502 when the exchange throws and logs only the error name', async () => {
    setEnv();
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); };
    try {
      const { sent, reply } = capture();
      await handleProviderToken(
        { headers: { host: '102047.collabcodes.com' } },
        { source: 'github', code: 'the-code', redirectUri: 'https://102047.collabcodes.com?source=github' },
        reply,
        { email: 'a@collab.codes' },
        () => Promise.reject(new TypeError('fetch failed: client_secret=gh-secret code=the-code')),
      );
      assert.equal(sent.status, 502);
      assert.equal((sent.body as { error: string }).error, 'PROVIDER_EXCHANGE_FAILED');
      const log = errors.join('\n');
      assert.ok(log.includes('PROVIDER_EXCHANGE_FAILED TypeError'));
      assert.equal(log.includes('gh-secret'), false);
      assert.equal(log.includes('the-code'), false);
    } finally {
      console.error = original;
    }
  });

  it('returns the GitHub token and posts the same redirect_uri', async () => {
    await expectExchange('github', 'https://github.com/login/oauth/access_token', undefined);
  });

  it('returns the GitLab token and posts grant_type plus redirect_uri', async () => {
    await expectExchange('gitlab', 'https://gitlab.com/oauth/token', 'authorization_code');
  });
});

async function expectExchange(source: 'github' | 'gitlab', url: string, grant: string | undefined): Promise<void> {
  setEnv();
  const token = `token-value-${source}`;
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); };
  let posted: { url?: string; body?: unknown } = {};
  try {
    const { sent, reply } = capture();
    const redirectUri = `https://102047.collabcodes.com?source=${source}`;
    await handleProviderToken(
      { headers: { host: '102047.collabcodes.com' } },
      { source, code: 'the-code', redirectUri },
      reply,
      { email: 'a@collab.codes' },
      (input, init) => {
        posted = { url: String(input), body: JSON.parse(String(init?.body)) };
        return Promise.resolve(new Response(JSON.stringify({ access_token: token }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      },
    );
    assert.equal(sent.status, 200);
    assert.equal((sent.body as { token: string }).token, token);
    assert.equal(posted.url, url);
    const body = posted.body as Record<string, string>;
    assert.equal(body.redirect_uri, redirectUri);
    assert.equal(body.code, 'the-code');
    assert.equal(body.client_id, source === 'github' ? 'gh-id' : 'gl-id');
    assert.equal(body.client_secret, source === 'github' ? 'gh-secret' : 'gl-secret');
    assert.equal(body.grant_type, grant);
    const log = errors.join('\n');
    assert.equal(log.includes(token), false);
    assert.equal(log.includes('the-code'), false);
    assert.equal(log.includes('gh-secret'), false);
    assert.equal(log.includes('gl-secret'), false);
  } finally {
    console.error = original;
  }
}
