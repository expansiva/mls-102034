/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeProviderToken.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { handleProviderToken, type ProviderTokenReply } from '/_102034_/l1/server/layer_1_external/cbe/cbeProviderToken.js';

const savedAppconfig = process.env.COLLAB_APPCONFIG_FILE;
const tempDirs: string[] = [];

function restoreEnv(): void {
  if (savedAppconfig === undefined) delete process.env.COLLAB_APPCONFIG_FILE;
  else process.env.COLLAB_APPCONFIG_FILE = savedAppconfig;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

function writeAppconfig(value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'provider-token-'));
  tempDirs.push(dir);
  const file = join(dir, 'appconfig.json');
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  process.env.COLLAB_APPCONFIG_FILE = file;
  return file;
}

function providersFile(github: { clientId: string; clientSecret: string }, gitlab = github): string {
  return writeAppconfig({ oauthProviders: { github, gitlab } });
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

function captureErrors(): { errors: string[]; restore: () => void } {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); };
  return { errors, restore: () => { console.error = original; } };
}

afterEach(() => {
  restoreEnv();
});

describe('providerToken', () => {
  it('returns 401 without a collab-auth email', async () => {
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

  it('returns 503 and names the path when the appconfig file is missing', async () => {
    const missing = join(tmpdir(), 'provider-token-absent', 'appconfig.json');
    process.env.COLLAB_APPCONFIG_FILE = missing;
    const { errors, restore } = captureErrors();
    try {
      const { sent, reply } = capture();
      await handleProviderToken(
        { headers: { host: '102047.collabcodes.com' } },
        { source: 'github', code: 'abc', redirectUri: 'https://102047.collabcodes.com?source=github' },
        reply,
        { email: 'a@collab.codes' },
      );
      assert.equal(sent.status, 503);
      assert.equal((sent.body as { error: string }).error, 'PROVIDER_NOT_CONFIGURED');
      assert.ok(errors.some((line) => line.includes(missing)));
    } finally {
      restore();
    }
  });

  it('returns 503 and does not log the file when the JSON is invalid', async () => {
    const file = writeAppconfig('{"oauthProviders": not-json secret-in-file}');
    const { errors, restore } = captureErrors();
    try {
      const { sent, reply } = capture();
      await handleProviderToken(
        { headers: { host: '102047.collabcodes.com' } },
        { source: 'github', code: 'abc', redirectUri: 'https://102047.collabcodes.com?source=github' },
        reply,
        { email: 'a@collab.codes' },
      );
      assert.equal(sent.status, 503);
      assert.equal((sent.body as { error: string }).error, 'PROVIDER_NOT_CONFIGURED');
      const log = errors.join('\n');
      assert.ok(log.includes(file));
      assert.ok(log.includes('invalid JSON'));
      assert.equal(log.includes('secret-in-file'), false);
    } finally {
      restore();
    }
  });

  it('returns 503 and says it cannot read the path when it is not a readable file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'provider-token-dir-'));
    process.env.COLLAB_APPCONFIG_FILE = dir;
    const { errors, restore } = captureErrors();
    try {
      const { sent, reply } = capture();
      await handleProviderToken(
        { headers: { host: '102047.collabcodes.com' } },
        { source: 'github', code: 'abc', redirectUri: 'https://102047.collabcodes.com?source=github' },
        reply,
        { email: 'a@collab.codes' },
      );
      assert.equal(sent.status, 503);
      assert.ok(errors.join('\n').includes(`cannot read ${dir} (EISDIR)`));
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns 503 and names the missing field', async () => {
    const file = writeAppconfig({
      oauthProviders: { github: { clientId: 'gh-id-must-not-log' } },
    });
    const { errors, restore } = captureErrors();
    try {
      const { sent, reply } = capture();
      await handleProviderToken(
        { headers: { host: '102047.collabcodes.com' } },
        { source: 'github', code: 'abc', redirectUri: 'https://102047.collabcodes.com?source=github' },
        reply,
        { email: 'a@collab.codes' },
      );
      assert.equal(sent.status, 503);
      assert.equal((sent.body as { error: string }).error, 'PROVIDER_NOT_CONFIGURED');
      const log = errors.join('\n');
      assert.ok(log.includes(`${file} oauthProviders.github.clientSecret`));
      assert.equal(log.includes('gh-id-must-not-log'), false);
    } finally {
      restore();
    }
  });

  it('returns 502 when the provider omits access_token and does not log the body', async () => {
    providersFile({ clientId: 'gh-id', clientSecret: 'gh-secret' });
    const { errors, restore } = captureErrors();
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
      restore();
    }
  });

  it('returns 502 when the exchange throws and logs only the error name', async () => {
    providersFile({ clientId: 'gh-id', clientSecret: 'gh-secret' });
    const { errors, restore } = captureErrors();
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
      restore();
    }
  });

  it('returns the GitHub token and posts the id and secret from the file', async () => {
    await expectExchange('github', 'https://github.com/login/oauth/access_token', undefined);
  });

  it('returns the GitLab token and posts grant_type plus the file credentials', async () => {
    await expectExchange('gitlab', 'https://gitlab.com/oauth/token', 'authorization_code');
  });

  it('reads the file again on the next call', async () => {
    const file = providersFile({ clientId: 'id-1', clientSecret: 'secret-1' });
    const posted: string[] = [];
    const fetchImpl: typeof fetch = (_input, init) => {
      posted.push((JSON.parse(String(init?.body)) as { client_id: string }).client_id);
      return Promise.resolve(new Response(JSON.stringify({ access_token: 'tok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    };
    const call = () => handleProviderToken(
      { headers: { host: '102047.collabcodes.com' } },
      { source: 'github', code: 'the-code', redirectUri: 'https://102047.collabcodes.com?source=github' },
      capture().reply,
      { email: 'a@collab.codes' },
      fetchImpl,
    );
    await call();
    writeFileSync(file, JSON.stringify({
      oauthProviders: { github: { clientId: 'id-2', clientSecret: 'secret-2' } },
    }));
    await call();
    assert.deepEqual(posted, ['id-1', 'id-2']);
  });
});

async function expectExchange(source: 'github' | 'gitlab', url: string, grant: string | undefined): Promise<void> {
  providersFile(
    { clientId: 'gh-id', clientSecret: 'gh-secret' },
    { clientId: 'gl-id', clientSecret: 'gl-secret' },
  );
  const token = `token-value-${source}`;
  const { errors, restore } = captureErrors();
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
    restore();
  }
}
