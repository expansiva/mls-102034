import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createServerMessagesClient } from '/_102034_/l1/server/layer_1_external/collabMessages/client.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type {
  RequestLinkModulePerson,
  RequestResolveModulePeople,
} from '/_102036_/l2/shared/interfaces.js';

const GLOBAL_TOKEN = 'SENTINEL_TOKEN_rt102_global';
const TOKEN_A = 'SENTINEL_TOKEN_rt102_app_a';
const TOKEN_B = 'SENTINEL_TOKEN_rt102_app_b';
const APP_A = '102094';
const APP_B = '102095';
const ORG_A = 'org-private-a';
const ORG_B = 'org-private-b';
const ORG_ENV = 'org-from-env';
const USER_ENV = 'user-from-env';

type Seen = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

const envKeys = ['MSG_PROXY_TOKEN', 'MSG_PROXY_USER_ID', 'MSG_PROXY_ORG_ID', 'MSG_PROXY_TARGET', 'CBE_PROJECT_FILES_DIR'] as const;
const saved: Record<string, string | undefined> = {};
const tempDirs: string[] = [];

function saveEnv(): void {
  for (const key of envKeys) saved[key] = process.env[key];
}

function restoreEnv(): void {
  for (const key of envKeys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

saveEnv();

afterEach(() => {
  restoreEnv();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function projectFilesDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rt102-id-'));
  tempDirs.push(dir);
  process.env.CBE_PROJECT_FILES_DIR = dir;
  return dir;
}

function writeAppFile(dir: string, projectId: string, token: string, orgId: string): void {
  writeFileSync(join(dir, `${projectId}.json`), JSON.stringify({
    schema: 1,
    generatedAt: '2026-10-19T00:00:00.000Z',
    org: { orgId, slug: 'private', name: 'Private', createdAt: '2026-10-19T00:00:00.000Z' },
    project: { projectId, domain: 'app.test', appEnv: null, language: null, type: 'app', createdAt: '2026-10-19T00:00:00.000Z' },
    collabMessages: { token },
  }));
}

function globalEnv(): NodeJS.ProcessEnv {
  return {
    MSG_PROXY_TOKEN: GLOBAL_TOKEN,
    MSG_PROXY_USER_ID: USER_ENV,
    MSG_PROXY_ORG_ID: ORG_ENV,
    MSG_PROXY_TARGET: 'http://cm.test',
  };
}

function mockFetch(handler: (seen: Seen) => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: Seen[];
} {
  const calls: Seen[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers: Record<string, string> = {};
    const raw = init?.headers;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [key, value] of Object.entries(raw as Record<string, string>)) headers[key] = value;
    }
    const seen: Seen = {
      url: String(input),
      headers,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    };
    calls.push(seen);
    return handler(seen);
  };
  return { fetchImpl, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function envelope(status: number, extra: Record<string, unknown> = {}): { statusCode: number } {
  return { statusCode: status, ...extra };
}

function tech(projectId: string): string {
  return `app:${projectId}`;
}

function linkInput(): Omit<RequestLinkModulePerson, 'action' | 'userId'> {
  return { mdmId: 'mdm-1', loginEmail: 'person@app.test' };
}

function resolveInput(): Omit<RequestResolveModulePeople, 'action' | 'userId'> {
  return { mdmIds: ['mdm-1'], cmUserIds: ['cm-1'] };
}

describe('module identity client', () => {
  it('sends each app credential and the caller userId for link and resolve', async () => {
    const dir = projectFilesDir();
    writeAppFile(dir, APP_A, TOKEN_A, ORG_A);
    writeAppFile(dir, APP_B, TOKEN_B, ORG_B);
    const { fetchImpl, calls } = mockFetch((seen) => {
      if (seen.body.action === 'linkModulePerson') {
        return jsonResponse(200, envelope(200, { cmUserId: 'cm-1', outcome: 'linked' }));
      }
      return jsonResponse(200, envelope(200, {
        people: [{ mdmId: 'mdm-1', cmUserId: 'cm-1', state: 'linked' }],
      }));
    });
    const clientA = createServerMessagesClient({ projectId: APP_A, env: globalEnv(), fetchImpl });
    const clientB = createServerMessagesClient({ projectId: APP_B, env: globalEnv(), fetchImpl });
    const [linkA, linkB, resolveA, resolveB] = await Promise.all([
      clientA.linkModulePerson(tech(APP_A), linkInput()),
      clientB.linkModulePerson(tech(APP_B), linkInput()),
      clientA.resolveModulePeople(tech(APP_A), resolveInput()),
      clientB.resolveModulePeople(tech(APP_B), resolveInput()),
    ]);
    assert.equal(linkA.body.outcome, 'linked');
    assert.equal(linkB.body.outcome, 'linked');
    assert.equal(resolveA.body.people?.[0].state, 'linked');
    assert.equal(resolveB.body.people?.[0].state, 'linked');
    assert.equal(calls.length, 4);
    for (const call of calls) {
      const app = call.headers['x-app-id'];
      assert.equal(call.url, 'http://cm.test/msg');
      assert.equal('cookie' in call.headers, false);
      assert.notEqual(call.headers.authorization, `Bearer ${GLOBAL_TOKEN}`);
      assert.notEqual(call.headers['x-org-id'], ORG_ENV);
      assert.notEqual(call.headers['x-user-id'], USER_ENV);
      assert.equal(call.body.action === 'linkModulePerson' || call.body.action === 'resolveModulePeople', true);
      if (app === APP_A) {
        assert.equal(call.headers.authorization, `Bearer ${TOKEN_A}`);
        assert.equal(call.headers['x-org-id'], ORG_A);
        assert.equal(call.headers['x-user-id'], tech(APP_A));
        assert.equal(call.body.userId, tech(APP_A));
      } else {
        assert.equal(app, APP_B);
        assert.equal(call.headers.authorization, `Bearer ${TOKEN_B}`);
        assert.equal(call.headers['x-org-id'], ORG_B);
        assert.equal(call.headers['x-user-id'], tech(APP_B));
        assert.equal(call.body.userId, tech(APP_B));
      }
    }
  });

  it('keeps action and userId when the input carries the same fields', async () => {
    const dir = projectFilesDir();
    writeAppFile(dir, APP_A, TOKEN_A, ORG_A);
    const { fetchImpl, calls } = mockFetch((seen) => {
      if (seen.body.action === 'linkModulePerson') {
        return jsonResponse(200, envelope(200, { cmUserId: 'cm-1', outcome: 'existing' }));
      }
      return jsonResponse(200, envelope(200, { people: [] }));
    });
    const client = createServerMessagesClient({ projectId: APP_A, env: globalEnv(), fetchImpl });
    const link = await client.linkModulePerson(tech(APP_A), {
      ...linkInput(),
      action: 'addMessage',
      userId: 'human-from-input',
      project: APP_B,
    } as Omit<RequestLinkModulePerson, 'action' | 'userId'>);
    const resolved = await client.resolveModulePeople(tech(APP_A), {
      ...resolveInput(),
      action: 'applyIntents',
      userId: 'human-from-input',
    } as Omit<RequestResolveModulePeople, 'action' | 'userId'>);
    assert.equal(link.body.outcome, 'existing');
    assert.deepEqual(resolved.body.people, []);
    assert.equal(calls[0].body.action, 'linkModulePerson');
    assert.equal(calls[0].body.userId, tech(APP_A));
    assert.equal(calls[0].headers['x-app-id'], APP_A);
    assert.equal(calls[0].body.mdmId, 'mdm-1');
    assert.equal(calls[1].body.action, 'resolveModulePeople');
    assert.equal(calls[1].body.userId, tech(APP_A));
    assert.notEqual(calls[1].body.action, 'applyIntents');
  });

  it('refuses both methods before fetch when the application is not configured', async () => {
    let fetches = 0;
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return jsonResponse(200, envelope(200));
    };
    const client = createServerMessagesClient({ env: globalEnv(), fetchImpl });
    for (const run of [
      () => client.linkModulePerson(tech(APP_A), linkInput()),
      () => client.resolveModulePeople(tech(APP_A), resolveInput()),
    ]) {
      await assert.rejects(run, (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'MSG_APP_NOT_CONFIGURED');
        assert.equal(err.statusCode, 503);
        return true;
      });
    }
    assert.equal(fetches, 0);
  });

  it('returns link outcomes, people states and error envelopes unchanged', async () => {
    const dir = projectFilesDir();
    writeAppFile(dir, APP_A, TOKEN_A, ORG_A);
    const cases: { http: number; body: Record<string, unknown> }[] = [
      { http: 200, body: envelope(200, { cmUserId: 'cm-1', outcome: 'linked' }) },
      { http: 200, body: envelope(200, { cmUserId: 'cm-1', outcome: 'existing' }) },
      { http: 409, body: envelope(409, { code: 'link_conflict' }) },
      { http: 404, body: envelope(404, { code: 'user_not_found' }) },
      { http: 200, body: envelope(200, { people: [
        { mdmId: 'mdm-1', cmUserId: 'cm-1', state: 'linked' },
        { mdmId: 'mdm-2', state: 'unlinked' },
        { mdmId: 'mdm-3', cmUserId: 'cm-3', state: 'removed' },
      ] }) },
      { http: 503, body: envelope(503, { code: 'busy' }) },
    ];
    const { fetchImpl, calls } = mockFetch(() => {
      const item = cases[calls.length - 1];
      return jsonResponse(item.http, item.body);
    });
    const client = createServerMessagesClient({ projectId: APP_A, env: globalEnv(), fetchImpl });
    const results = [
      await client.linkModulePerson(tech(APP_A), linkInput()),
      await client.linkModulePerson(tech(APP_A), linkInput()),
      await client.linkModulePerson(tech(APP_A), linkInput()),
      await client.linkModulePerson(tech(APP_A), linkInput()),
      await client.resolveModulePeople(tech(APP_A), resolveInput()),
      await client.resolveModulePeople(tech(APP_A), resolveInput()),
    ];
    for (let i = 0; i < cases.length; i += 1) {
      assert.deepEqual(results[i], { httpStatus: cases[i].http, body: cases[i].body });
    }
    assert.equal(calls.length, cases.length);
    assert.equal(calls.filter((call) => call.body.action === 'applyIntents').length, 0);
  });
});
