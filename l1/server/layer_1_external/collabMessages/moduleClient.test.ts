import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createServerMessagesClient } from '/_102034_/l1/server/layer_1_external/collabMessages/client.js';
import type { ServerMessagesClient } from '/_102034_/l1/server/layer_1_external/collabMessages/client.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type {
  AgentIntent,
  AgentIntentModuleAdvance,
  RequestEnsureModuleThread,
  RequestGetModuleTask,
  RequestListModuleTasks,
  RequestOpenModuleTask,
} from '/_102036_/l2/shared/interfaces.js';

const GLOBAL_TOKEN = 'SENTINEL_TOKEN_rt79';
const TOKEN_A = 'SENTINEL_TOKEN_rt94_app_a';
const TOKEN_B = 'SENTINEL_TOKEN_rt94_app_b';
const APP_A = '102094';
const APP_B = '102095';
const ORG_A = 'org-private-a';
const ORG_B = 'org-private-b';
const ORG_ENV = 'org-from-env';
const USER_ENV = 'user-from-env';
const USER = 'cm-user-tech';

const EXPECTED_MODULE_METHODS = [
  'advanceModuleTask',
  'ensureModuleThread',
  'getModuleTask',
  // Identity actions: their matrix lives in moduleIdentityClient.test.ts and moduleIdentityTransport.test.ts.
  'linkModulePerson',
  'listModuleTasks',
  'openModuleTask',
  'resolveModulePeople',
] as const;

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
  const dir = mkdtempSync(join(tmpdir(), 'rt94-mod-'));
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

function ref(project: string): RequestGetModuleTask['ref'] {
  return { project, module: 'mod', entity: 'order', recordId: 'rec-1', processId: 'proc-1' };
}

function ensureInput(project: string): Omit<RequestEnsureModuleThread, 'action' | 'userId'> {
  return { email: 'a@b.c', project, module: 'mod', name: 'Room' };
}

function openInput(project: string): Omit<RequestOpenModuleTask, 'action' | 'userId'> {
  return {
    ref: { ...ref(project), workflowVersion: null },
    plan: {
      processId: 'proc-1',
      title: 'plan',
      moduleTitle: 'Module',
      steps: [{ key: 's', kind: 'mechanical', ownerKind: 'module', next: [] }],
    },
    startStep: 's',
    origin: { kind: 'schedule', config: 'nightly' },
    owner: 'owner-1',
    actorNow: null,
    title: 't',
    room: { mode: 'exclusive' },
    executor: { kind: 'routine', name: 'nightly' },
    message: { content: 'opened' },
  };
}

function listInput(project: string): Omit<RequestListModuleTasks, 'action' | 'userId'> {
  return { project, module: 'mod', processId: 'proc-1', cursor: 'cursor-1', pageSize: 20 };
}

function advanceIntent(taskId = 'task-1'): AgentIntentModuleAdvance {
  return {
    type: 'module-advance',
    taskId,
    commandId: 'cmd-1',
    expectedRevision: 4,
    from: 's',
    to: 's2',
    actorNow: null,
    executor: { kind: 'routine', name: 'nightly' },
    wake: { everyMinutes: 15, routine: 'nightly' },
    message: { content: 'advanced' },
  };
}

function envelope(status: number, extra: Record<string, unknown> = {}): { statusCode: number } {
  return { statusCode: status, ...extra };
}

describe('module messages client', () => {
  it('exposes exactly the module methods covered by this matrix', () => {
    const client = createServerMessagesClient({ projectId: APP_A, env: globalEnv(), fetchImpl: async () => jsonResponse(200, envelope(200)) });
    const exposed = Object.keys(client).filter((name) => name.includes('Module') || name.includes('module')).sort();
    assert.deepEqual(exposed, [...EXPECTED_MODULE_METHODS]);
  });

  it('runs the five module methods for two apps concurrently with private tokens', async () => {
    const dir = projectFilesDir();
    writeAppFile(dir, APP_A, TOKEN_A, ORG_A);
    writeAppFile(dir, APP_B, TOKEN_B, ORG_B);
    const { fetchImpl, calls } = mockFetch((seen) => {
      const action = seen.body.action;
      if (action === 'getModuleTask') return jsonResponse(200, envelope(200, { task: { id: 't' }, room: { id: 'room' } }));
      if (action === 'listModuleTasks') return jsonResponse(200, envelope(200, { items: [], cursor: 'next' }));
      if (action === 'applyIntents') return jsonResponse(200, envelope(200, { task: { id: 't', revision: 5 } }));
      if (action === 'openModuleTask') return jsonResponse(200, envelope(200, { task: { id: 't' }, room: { id: 'room' }, created: true }));
      return jsonResponse(200, envelope(200, { userId: USER, thread: { id: 'th' }, created: false }));
    });
    const clientA = createServerMessagesClient({ projectId: APP_A, env: globalEnv(), fetchImpl });
    const clientB = createServerMessagesClient({ projectId: APP_B, env: globalEnv(), fetchImpl });
    const taskId = 'shared-task';
    await Promise.all([
      runFive(clientA, APP_A, taskId),
      runFive(clientB, APP_B, taskId),
    ]);
    assert.equal(calls.length, 10);
    for (const call of calls) {
      const app = call.headers['x-app-id'];
      assert.equal(call.url, 'http://cm.test/msg');
      assert.equal('cookie' in call.headers, false);
      assert.equal(call.headers['x-user-id'], USER);
      assert.equal(call.body.userId, USER);
      assert.notEqual(call.headers.authorization, `Bearer ${GLOBAL_TOKEN}`);
      assert.notEqual(call.headers['x-org-id'], ORG_ENV);
      if (app === APP_A) {
        assert.equal(call.headers.authorization, `Bearer ${TOKEN_A}`);
        assert.equal(call.headers['x-org-id'], ORG_A);
      } else {
        assert.equal(app, APP_B);
        assert.equal(call.headers.authorization, `Bearer ${TOKEN_B}`);
        assert.equal(call.headers['x-org-id'], ORG_B);
      }
      if (call.body.action === 'applyIntents') {
        const intents = call.body.intents as AgentIntentModuleAdvance[];
        assert.equal(intents.length, 1);
        assert.equal(intents[0].type, 'module-advance');
        assert.equal(intents[0].taskId, taskId);
        assert.equal(intents[0].executor.kind, 'routine');
        assert.equal('by' in ((call.body as { origin?: object }).origin ?? {}), false);
      }
      if (call.body.action === 'openModuleTask') {
        const origin = call.body.origin as { kind: string; by?: string };
        assert.equal(origin.kind, 'schedule');
        assert.equal(origin.by, undefined);
        assert.deepEqual(call.body.message, { content: 'opened' });
        assert.equal((call.body.ref as { project: string }).project, app);
      }
    }
  });

  it('rejects a divergent project or ref before fetch', async () => {
    const dir = projectFilesDir();
    writeAppFile(dir, APP_A, TOKEN_A, ORG_A);
    let fetches = 0;
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return jsonResponse(200, envelope(200));
    };
    const client = createServerMessagesClient({ projectId: APP_A, env: globalEnv(), fetchImpl });
    const cases = [
      () => client.ensureModuleThread(USER, ensureInput(APP_B)),
      () => client.openModuleTask(USER, openInput(APP_B)),
      () => client.getModuleTask(USER, { ref: ref(APP_B) }),
      () => client.listModuleTasks(USER, listInput(APP_B)),
    ];
    for (const run of cases) {
      await assert.rejects(run, (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'MSG_APP_SCOPE_INVALID');
        assert.equal(err.statusCode, 400);
        return true;
      });
    }
    assert.equal(fetches, 0);
  });

  it('preserves get, list and advance envelopes, including 403 on the same taskId', async () => {
    const dir = projectFilesDir();
    writeAppFile(dir, APP_A, TOKEN_A, ORG_A);
    writeAppFile(dir, APP_B, TOKEN_B, ORG_B);
    const task = { taskId: 'shared-task', revision: 4, status: 'running' };
    const cases: { http: number; body: Record<string, unknown>; run: (client: ServerMessagesClient) => Promise<unknown> }[] = [];
    const { fetchImpl, calls } = mockFetch(() => {
      const item = cases[calls.length - 1];
      return jsonResponse(item.http, item.body);
    });
    const clientA = createServerMessagesClient({ projectId: APP_A, env: globalEnv(), fetchImpl });
    const clientB = createServerMessagesClient({ projectId: APP_B, env: globalEnv(), fetchImpl });
    const getRef = { ref: ref(APP_A) };
    cases.push(
      { http: 404, body: envelope(404, { code: 'not_found' }), run: (c) => c.getModuleTask(USER, getRef) },
      { http: 403, body: envelope(403, { code: 'forbidden' }), run: (c) => c.getModuleTask(USER, getRef) },
      { http: 409, body: envelope(409, { code: 'legacy_module_task', task }), run: (c) => c.getModuleTask(USER, getRef) },
      { http: 200, body: envelope(200, { items: [{ ref: { ...ref(APP_A), workflowVersion: null }, taskId: 'shared-task', revision: 4, status: 'running' }], cursor: 'p2' }), run: (c) => c.listModuleTasks(USER, listInput(APP_A)) },
      { http: 200, body: envelope(200, { code: 'applied', task: { ...task, revision: 5 } }), run: (c) => c.advanceModuleTask(USER, advanceIntent('shared-task')) },
      { http: 200, body: envelope(200, { code: 'unchanged', task }), run: (c) => c.advanceModuleTask(USER, advanceIntent('shared-task')) },
      { http: 409, body: envelope(409, { code: 'conflict', task }), run: (c) => c.advanceModuleTask(USER, advanceIntent('shared-task')) },
      { http: 507, body: envelope(507, { code: 'task_too_large' }), run: (c) => c.advanceModuleTask(USER, advanceIntent('shared-task')) },
      { http: 403, body: envelope(403, { code: 'forbidden' }), run: (c) => c.advanceModuleTask(USER, advanceIntent('shared-task')) },
    );
    for (const item of cases) {
      const client = item === cases[8] ? clientB : clientA;
      const result = await item.run(client);
      assert.deepEqual(result, { httpStatus: item.http, body: item.body });
    }
    const listCall = calls[3];
    assert.equal(listCall.body.action, 'listModuleTasks');
    assert.equal(listCall.body.processId, 'proc-1');
    assert.equal(listCall.body.cursor, 'cursor-1');
    assert.equal(listCall.body.pageSize, 20);
    const foreign = calls[8];
    assert.equal(foreign.headers.authorization, `Bearer ${TOKEN_B}`);
    assert.equal(foreign.headers['x-app-id'], APP_B);
    assert.equal(foreign.body.action, 'applyIntents');
    assert.equal(calls.filter((call) => call.body.action === 'openModuleTask' || call.body.action === 'getModuleTask').length, 3);
  });

  it('keeps advance payload across explicit attempts and leaves person executor untouched', async () => {
    const dir = projectFilesDir();
    writeAppFile(dir, APP_A, TOKEN_A, ORG_A);
    const routine = advanceIntent();
    const person: AgentIntentModuleAdvance = {
      ...advanceIntent('task-2'),
      commandId: 'cmd-person',
      expectedRevision: 9,
      executor: { kind: 'person', userId: 'person-9' },
    };
    const { fetchImpl, calls } = mockFetch(() => jsonResponse(200, envelope(200, { task: { id: 't' } })));
    const client = createServerMessagesClient({ projectId: APP_A, env: globalEnv(), fetchImpl });
    await client.advanceModuleTask(USER, routine);
    await client.advanceModuleTask(USER, routine);
    await client.advanceModuleTask(USER, person);
    assert.equal(routine.commandId, 'cmd-1');
    assert.equal(routine.expectedRevision, 4);
    assert.deepEqual(routine.wake, { everyMinutes: 15, routine: 'nightly' });
    assert.deepEqual(routine.executor, { kind: 'routine', name: 'nightly' });
    assert.equal(calls[0].body.action, 'applyIntents');
    assert.deepEqual(calls[0].body.intents, [routine]);
    assert.deepEqual(calls[1].body.intents, [routine]);
    assert.deepEqual((calls[2].body.intents as AgentIntentModuleAdvance[])[0].executor, { kind: 'person', userId: 'person-9' });
    assert.equal(JSON.stringify(calls[0].body).includes('origin'), false);
  });

  it('refuses module intents on generic applyIntents without a request', async () => {
    let fetches = 0;
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return jsonResponse(200, envelope(200));
    };
    const client = createServerMessagesClient({ projectId: APP_A, env: globalEnv(), fetchImpl });
    const common: AgentIntent = {
      type: 'pause-or-continue',
      messageId: 'm',
      threadId: 'th',
      taskId: 't',
      reason: 'wait',
    };
    const batches: AgentIntent[][] = [
      [advanceIntent()],
      [{ type: 'module-progress', taskId: 't' } as unknown as AgentIntent],
      [common, advanceIntent()],
    ];
    for (const intents of batches) {
      await assert.rejects(
        () => client.applyIntents(USER, { intents }),
        (err: unknown) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.code, 'MSG_MODULE_INTENT_UNSUPPORTED');
          assert.equal(err.statusCode, 400);
          return true;
        },
      );
    }
    const kept = await client.applyIntents(USER, { intents: [common] });
    assert.equal(kept.httpStatus, 200);
    assert.equal(fetches, 1);
  });

  it('refuses an advance whose discriminator is not module-advance', async () => {
    let fetches = 0;
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return jsonResponse(200, envelope(200));
    };
    const client = createServerMessagesClient({ projectId: APP_A, env: globalEnv(), fetchImpl });
    const intent = { ...advanceIntent(), type: 'module-progress' } as unknown as AgentIntentModuleAdvance;
    await assert.rejects(
      () => client.advanceModuleTask(USER, intent),
      (err: unknown) => err instanceof AppError && err.code === 'MSG_MODULE_INTENT_UNSUPPORTED' && err.statusCode === 400,
    );
    assert.equal(fetches, 0);
  });

  it('does not fall back to the global credential when the app file is missing or invalid', async () => {
    const dir = projectFilesDir();
    let fetches = 0;
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return jsonResponse(200, envelope(200));
    };
    const missing = createServerMessagesClient({ projectId: APP_A, env: globalEnv(), fetchImpl });
    await assert.rejects(() => missing.getModuleTask(USER, { ref: ref(APP_A) }), (err: unknown) => err instanceof AppError);
    writeFileSync(join(dir, `${APP_B}.json`), '{');
    const invalid = createServerMessagesClient({ projectId: APP_B, env: globalEnv(), fetchImpl });
    await assert.rejects(() => invalid.listModuleTasks(USER, listInput(APP_B)), (err: unknown) => err instanceof AppError);
    const unconfigured = createServerMessagesClient({ env: globalEnv(), fetchImpl });
    await assert.rejects(
      () => unconfigured.advanceModuleTask(USER, advanceIntent()),
      (err: unknown) => err instanceof AppError && err.code === 'MSG_APP_NOT_CONFIGURED' && err.statusCode === 503,
    );
    assert.equal(fetches, 0);
  });
});

async function runFive(client: ServerMessagesClient, project: string, taskId: string): Promise<void> {
  await client.ensureModuleThread(USER, ensureInput(project));
  await client.openModuleTask(USER, openInput(project));
  await client.getModuleTask(USER, { ref: ref(project) });
  await client.listModuleTasks(USER, listInput(project));
  await client.advanceModuleTask(USER, advanceIntent(taskId));
}
