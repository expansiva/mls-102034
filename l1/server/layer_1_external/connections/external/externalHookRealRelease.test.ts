/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/externalHookRealRelease.test.ts" enhancement="_blank"/>
// rt322 s2: the arrival at the hook through the PRODUCTION wiring (`productionDeps()`, the real `sharedAssistantRunners`, the real
// release declaration loader, the real serve index and `execMessage`) against a COMPILED release of mls-102047 (the `telegram` module).
// Only the environment is a fixture: the secret, the organization, and the "already seen" set (memory mode, no Postgres).
// Opt-in: it needs a folder laid out like the runtime root (config.json + dist/local with the compiled 102047), given in RT322_ROOT.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import Fastify from 'fastify';
import { runAsCallerModule } from '/_102034_/l1/server/layer_1_external/connections/callerModule.js';
import { installCmBench, type CmBench } from '/_102034_/l1/server/layer_1_external/connections/cm/cmBench.js';
import { resolveRepository } from '/_102034_/l1/server/layer_2_application/repositoryRegistry.js';
import { createAssistantContext } from '/_102034_/l1/workflow/assistantRuntime.js';
import type { ExternalCallRow } from '/_102034_/l1/server/layer_1_external/connections/external/externalCallStore.js';
import type { ExternalHookDeps } from '/_102034_/l1/server/layer_1_external/connections/external/externalHook.js';
import { productionDeps, registerExternalHookRoutes } from '/_102034_/l1/server/layer_1_external/transport/http/externalHookHttp.js';

// The hook through the PRODUCTION wiring (`productionDeps()`, the real `sharedAssistantRunners`, the real release declaration loader, the real
// serve index, the real `execMessage` and the real route of the module) against the SOURCE of the project mls-102047 (the telegram module), read
// through the cm bench `projectRoot` (the platform and the module run as the same code: one `AppError`, one registry). The environment is the
// only fixture: the secret, the organization, the project file, the store of "already seen", and the bots. Opt-in: RT322_ROOT = the folder of
// the project (e.g. mls-base/mls-102047), without it the proof is skipped.
const ROOT = process.env.RT322_ROOT ?? '';
const PROJECT = '102047';
const SECRET = 'incoming-secret-123';
let projectFiles = '';
let bench: CmBench | undefined;
const logs: string[] = [];
const originalWarn = console.warn;
const originalLog = console.log;
const originalInfo = console.info;

before(() => {
  if (!ROOT) return;
  projectFiles = mkdtempSync(path.join(tmpdir(), 'rt330-project-files-'));
  writeFileSync(path.join(projectFiles, `${PROJECT}.json`), JSON.stringify({
    schema: 1,
    generatedAt: '2026-11-27T12:00:00.000Z',
    org: { orgId: 'org-1', slug: 'org', name: 'Org', createdAt: '2026-11-27T12:00:00.000Z' },
    project: { domain: '102047.collabcodes.com', projectId: PROJECT, appEnv: null, language: null, type: 'client', createdAt: '2026-11-27T12:00:00.000Z' },
    collabMessages: { token: 'cm-token-123456' },
  }));
  process.env.CBE_PROJECT_FILES_DIR = projectFiles;
  process.env.COLLAB_PROJECT_ID = PROJECT;
  bench = installCmBench(PROJECT, {}, { projectRoot: ROOT });
  console.warn = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); originalWarn(...args); };
  console.info = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); originalInfo(...args); };
});

after(() => {
  console.warn = originalWarn;
  console.info = originalInfo;
  bench?.restore();
  delete process.env.CBE_PROJECT_FILES_DIR;
  delete process.env.COLLAB_PROJECT_ID;
  if (projectFiles) rmSync(projectFiles, { recursive: true, force: true });
});

afterEach(() => { logs.length = 0; });

describe('the hook through the production wiring and the source of 102047 (rt322, rt330)', { skip: ROOT === '' }, () => {
  const records: ExternalCallRow[] = [];
  const forgotten: string[] = [];
  const build = () => {
    const base = productionDeps();
    const deps: ExternalHookDeps = {
      ...base,
      secretOf: async (_ref, id) => (id === 'incomingMessageSecret' ? SECRET : null),
      organizationOf: () => 'org-1',
      record: async (row) => { records.push(row); await base.record(row); },
      forget: async (notice) => { forgotten.push(notice.noticeId); await base.forget(notice); },
    };
    const app = Fastify({ logger: false });
    registerExternalHookRoutes(app, deps);
    return app;
  };
  const update = (updateId: number) => JSON.stringify({ update_id: updateId, message: { message_id: updateId, date: 1, chat: { id: 5, type: 'private' }, from: { id: 5 }, text: 'oi' } });
  const post = (app: ReturnType<typeof build>, updateId: number, query: string) => app.inject({
    method: 'POST',
    url: `/hook/${PROJECT}/telegram/telegram/messageArrived${query}`,
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
    payload: update(updateId),
  });

  it('1. a bot the module does not have: 200 `refused` (the sender stops), record refused/not_found, and the same update again is a duplicate', async () => {
    const app = build();
    const first = await post(app, 101, '?b=ghost');
    originalLog(`CASE1 HTTP ${first.statusCode} ${first.body}`);
    assert.equal(first.statusCode, 200);
    assert.deepEqual(JSON.parse(first.body), { ok: true, message: 'refused' });
    const record = records.at(-1);
    assert.equal(record?.outcome, 'refused');
    assert.match(record?.denialReason ?? '', /^not_found: /u);
    assert.equal(forgotten.includes('101'), false, 'the notice is kept');
    const again = await post(app, 101, '?b=ghost');
    assert.equal(again.statusCode, 200);
    assert.deepEqual(JSON.parse(again.body), { ok: true, message: 'already received' });
    assert.equal(logs.some((line) => line.includes('declaration refused') || line.includes('no-route-in-module') || line.includes('unknown-operation')), false);
  });

  it('2. no `?b=` at all: what the real route answers, and whether the notice is kept', async () => {
    const app = build();
    const first = await post(app, 102, '');
    originalLog(`CASE2 HTTP ${first.statusCode} ${first.body} outcome=${records.at(-1)?.outcome} reason=${records.at(-1)?.denialReason ?? '-'} forgotten=${forgotten.includes('102')}`);
    // MEASURED: the route of the telegram throws MISSING_BOT_PARAMETER (422) before it reads the bot, so it is `refused` for the platform: 200 and
    // the notice is kept (a repeat would say the same: the address has no bot). It is not the `invalid` 503 the design assumed.
    assert.equal(first.statusCode, 200);
    assert.equal(records.at(-1)?.outcome, 'refused');
    assert.match(records.at(-1)?.denialReason ?? '', /^refused: The delivery address has no bot parameter/u);
    assert.equal(forgotten.includes('102'), false);
  });

  it('3. a bot the module knows but that is paused: the route answers as the module says (refused, not an error), 200 and a repeat is a duplicate', async () => {
    const app = build();
    await post(app, 103, '?b=ghost');
    const bots = runAsCallerModule('telegram', () => resolveRepository<{ create(bot: unknown): Promise<unknown> }>(createAssistantContext(PROJECT), 'TelegramBotRepository'));
    await bots.create({ id: 'bot-7', version: 1, name: 'Bot 7', audience: 'employees', agentId: 'agent-1', status: 'paused', details: { accessKey: 'key-123456' } });
    logs.length = 0;
    const first = await post(app, 104, '?b=bot-7');
    originalLog(`CASE3 HTTP ${first.statusCode} ${first.body} outcome=${records.at(-1)?.outcome} reason=${records.at(-1)?.denialReason ?? '-'}`);
    assert.equal(first.statusCode, 200);
    assert.equal(forgotten.includes('104'), false, 'kept');
    const again = await post(app, 104, '?b=bot-7');
    assert.equal(again.statusCode, 200);
    assert.deepEqual(JSON.parse(again.body), { ok: true, message: 'already received' });
    // The module ran with the hookParams: the arrival of the chat is the one of the bot of `?b=`.
    assert.equal(logs.some((line) => line.includes('declaration refused') || line.includes('no-route-in-module')), false);
  });
});
