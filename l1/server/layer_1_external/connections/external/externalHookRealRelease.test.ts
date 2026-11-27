/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/externalHookRealRelease.test.ts" enhancement="_blank"/>
// rt322 s2: the arrival at the hook through the PRODUCTION wiring (`productionDeps()`, the real `sharedAssistantRunners`, the real
// release declaration loader, the real serve index and `execMessage`) against a COMPILED release of mls-102047 (the `telegram` module).
// Only the environment is a fixture: the secret, the organization, and the "already seen" set (memory mode, no Postgres).
// Opt-in: it needs a folder laid out like the runtime root (config.json + dist/local with the compiled 102047), given in RT322_ROOT.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, describe, it } from 'node:test';
import Fastify from 'fastify';
import { createAssistantContext } from '/_102034_/l1/workflow/assistantRuntime.js';
import type { ExternalHookDeps } from '/_102034_/l1/server/layer_1_external/connections/external/externalHook.js';
import { productionDeps, registerExternalHookRoutes } from '/_102034_/l1/server/layer_1_external/transport/http/externalHookHttp.js';

const ROOT = process.env.RT322_ROOT ?? '';
const PROJECT = '102047';
const SECRET = 'incoming-secret-123';
let previousCwd = '';
let projectFiles = '';
const logs: string[] = [];
const originalWarn = console.warn;
const originalLog = console.log;
const originalInfo = console.info;

before(() => {
  if (!ROOT) return;
  previousCwd = process.cwd();
  process.chdir(ROOT);
  // Environment fixture: the project file the sites writes (organization and the credential of the cm).
  projectFiles = mkdtempSync(path.join(tmpdir(), 'rt322-project-files-'));
  writeFileSync(path.join(projectFiles, `${PROJECT}.json`), JSON.stringify({
    schema: 1,
    generatedAt: '2026-11-26T12:00:00.000Z',
    org: { orgId: 'org-1', slug: 'org', name: 'Org', createdAt: '2026-11-26T12:00:00.000Z' },
    project: { domain: 'local', projectId: PROJECT, appEnv: null, language: null, type: 'client', createdAt: '2026-11-26T12:00:00.000Z' },
    collabMessages: { token: 'cm-token-123456' },
  }));
  process.env.CBE_PROJECT_FILES_DIR = projectFiles;
  console.warn = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); originalWarn(...args); };
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); originalLog(...args); };
  console.info = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); originalInfo(...args); };
});

after(() => {
  console.warn = originalWarn;
  console.log = originalLog;
  console.info = originalInfo;
  if (ROOT) process.chdir(previousCwd);
  if (projectFiles) rmSync(projectFiles, { recursive: true, force: true });
});

describe('rt322 s2: the hook through the production wiring and the compiled release of 102047', { skip: ROOT === '' }, () => {
  it('the route of the module runs (no declaration refused, no missing route); without a cm it stops at the workflow task: 503', async () => {
    const deps: ExternalHookDeps = {
      ...productionDeps(),
      secretOf: async (_ref, id) => (id === 'incomingMessageSecret' ? SECRET : null),
      organizationOf: () => 'org-1',
    };
    const app = Fastify({ logger: false });
    registerExternalHookRoutes(app, deps);
    const payload = JSON.stringify({ update_id: 4242, message: { message_id: 1, date: 1, chat: { id: 5, type: 'private' }, from: { id: 5 }, text: 'oi' } });
    const send = () => app.inject({
      method: 'POST',
      url: `/hook/${PROJECT}/telegram/telegram/messageArrived?b=bot-7`,
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
      payload,
    });
    // The first arrival loads the router of the module (it registers its repositories) and finds no bot: 503 and the notice is given back.
    const first = await send();
    originalLog(`FIRST HTTP ${first.statusCode} ${first.body}`);
    // Data of the environment: the bot of the address exists in the store of the module (paused: the route records the arrival and does not call the cm).
    // The release has its own copy of the platform (dist/local/_102034_): the registry and the data runtime to seed are the ones the route uses.
    const platform = (file: string) => import(pathToFileURL(path.join(ROOT, 'dist', 'local', '_102034_', file)).href);
    const { resolveRepository } = await platform('l1/server/layer_2_application/repositoryRegistry.js') as { resolveRepository<T>(ctx: unknown, port: string): T };
    const bots = resolveRepository<{ create(bot: unknown): Promise<unknown> }>(createAssistantContext(PROJECT), 'TelegramBotRepository');
    await bots.create({ id: 'bot-7', version: 1, name: 'Bot 7', audience: 'employees', agentId: 'agent-1', status: 'paused', details: { accessKey: 'key-123456' } });
    logs.length = 0;
    const response = await send();
    originalLog(`HTTP ${response.statusCode} ${response.body}`);
    originalLog(`LOGS\n${logs.join('\n')}`);
    const all = logs.join('\n');
    assert.equal(all.includes('declaration refused'), false, 'no declaration refused');
    assert.equal(all.includes('unknown-operation'), false);
    assert.equal(all.includes('no-route-in-module'), false, 'the route of the module is in the index (the config is the composed one)');
    // The route of the module ran with the hookParams: it found the bot of `?b=bot-7` and opened the conversation of the chat.
    const conversations = resolveRepository<{ list(filter: unknown): Promise<unknown[]> }>(createAssistantContext(PROJECT), 'TelegramConversationRepository');
    assert.equal((await conversations.list({ botId: 'bot-7' })).length, 1);
    // Expected without a cm: the route stops opening the workflow task at the cm, which the proof does not have.
    assert.equal(response.statusCode, 503);
    assert.equal(all.includes('serve telegram.messageArrived ok=false code=unavailable'), true);
  });
});
