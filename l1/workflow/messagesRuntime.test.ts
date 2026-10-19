/// <mls fileReference="_102034_/l1/workflow/messagesRuntime.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { resetRunningReleaseCache } from '/_102034_/l1/server/layer_1_external/cbe/cbeRelease.js';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { AIModuleStep, TaskData } from '/_102036_/l2/shared/interfaces.js';
import {
  createMemoryOccurrencePort,
  createMessagesTaskOccurrencePort,
  createRuntimeMessagesTaskPort,
  createWorkflowEngine,
  type TaskWorkflowEngine,
  type TaskWorkflowOpen,
} from '/_102034_/l1/workflow/index.js';
import type { WorkflowPlanInput } from '/_102034_/l1/workflow/plan.js';

const TOKEN_GLOBAL = 'sentinel-rt102-global-token';
const ENV_USER = 'human-from-env';
const DECOY_EMAIL = 'decoy@telemetry.test';
const ACTIONS = new Set(['getModuleTask', 'openModuleTask', 'applyIntents', 'linkModulePerson', 'resolveModulePeople']);

type Seen = {
  action: string;
  authorization: string | undefined;
  userHeader: string | undefined;
  orgHeader: string | undefined;
  appHeader: string | undefined;
  cookie: string | undefined;
  body: Record<string, unknown>;
};

type Reply = { httpStatus: number; body: Record<string, unknown> };
type PersonState = 'linked' | 'unlinked' | 'removed';
type Stored = { mdmId: string; cmUserId: string; state: PersonState; email: string };

const servers: Array<{ close: () => Promise<void> }> = [];
const tempDirs: string[] = [];
const savedEnv = {
  CBE_PROJECT_FILES_DIR: process.env.CBE_PROJECT_FILES_DIR,
  MSG_PROXY_TARGET: process.env.MSG_PROXY_TARGET,
  MSG_PROXY_TOKEN: process.env.MSG_PROXY_TOKEN,
  MSG_PROXY_ORG_ID: process.env.MSG_PROXY_ORG_ID,
  MSG_PROXY_USER_ID: process.env.MSG_PROXY_USER_ID,
};

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) await server.close();
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetRunningReleaseCache();
});

function header(req: http.IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(', ') : value;
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => { chunks.push(chunk); });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function listen(onRequest: http.RequestListener): Promise<number> {
  const sockets = new Set<Socket>();
  const server = http.createServer(onRequest);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => { sockets.delete(socket); });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      servers.push({
        async close(): Promise<void> {
          for (const socket of sockets) socket.destroy();
          if (!server.listening) return;
          await new Promise<void>((done, fail) => {
            server.close((error) => { if (error) fail(error); else done(); });
          });
        },
      });
      resolve(address.port);
    });
  });
}

interface People {
  ownerMdm: string;
  ownerCm: string;
  ownerEmail: string;
  byMdm: string;
  byCm: string;
  byEmail: string;
  actorMdm: string;
  actorCm: string;
  actorEmail: string;
  memberMdm: string;
  memberCm: string;
  memberEmail: string;
  storyMdm: string;
  storyCm: string;
  storyEmail: string;
}

interface Directed {
  project: string;
  org: string;
  token: string;
  module: string;
  entity: string;
  recordId: string;
  processId: string;
  version: string;
  occurrenceTitle: string;
  inputTitle: string;
  processTitle: string;
  moduleTitle: string;
  stepA: string;
  stepB: string;
  titleA: string;
  titleB: string;
  kindB: 'mechanical' | 'llm';
  actorRef: string;
  functionRef: string;
  people: People;
  threadId: string;
  taskId: string;
  revision: number;
  bumpedRevision: number;
  roomMode: 'person' | 'group';
  groupKey?: string;
  priorCommand: string;
  advanceCommand: string;
}

const CASES: Directed[] = [
  {
    project: '102201', org: 'org-rt102-a', token: 'token-app-a', module: 'mod-a', entity: 'ordem', recordId: 'rec-a',
    processId: 'proc-a', version: 'rel-a', occurrenceTitle: 'Occurrence A', inputTitle: 'Input A',
    processTitle: 'Process A', moduleTitle: 'Module A', stepA: 'start-a', stepB: 'act-a', titleA: 'Start A', titleB: 'Act A',
    kindB: 'mechanical', actorRef: 'role-a', functionRef: 'fn-a',
    people: {
      ownerMdm: '', ownerCm: 'cm-owner-a', ownerEmail: 'owner-a@academia.test',
      byMdm: '', byCm: 'cm-by-a', byEmail: 'by-a@academia.test',
      actorMdm: '', actorCm: 'cm-actor-a', actorEmail: 'actor-a@academia.test',
      memberMdm: '', memberCm: 'cm-member-a', memberEmail: 'member-a@academia.test',
      storyMdm: '', storyCm: 'cm-story-a', storyEmail: 'story-a@academia.test',
    },
    threadId: 'room-a', taskId: 'task-a', revision: 4, bumpedRevision: 91, roomMode: 'person',
    priorCommand: 'prior-a', advanceCommand: 'adv-a',
  },
  {
    project: '102202', org: 'org-rt102-b', token: 'token-app-b', module: 'mod-b', entity: 'caso', recordId: 'rec-b',
    processId: 'proc-b', version: 'rel-b', occurrenceTitle: 'Occurrence B', inputTitle: 'Input B',
    processTitle: 'Process B', moduleTitle: 'Module B', stepA: 'start-b', stepB: 'ask-b', titleA: 'Start B', titleB: 'Ask B',
    kindB: 'llm', actorRef: 'role-b', functionRef: 'fn-b',
    people: {
      ownerMdm: '', ownerCm: 'cm-owner-b', ownerEmail: 'owner-b@academia.test',
      byMdm: '', byCm: 'cm-by-b', byEmail: 'by-b@academia.test',
      actorMdm: '', actorCm: 'cm-actor-b', actorEmail: 'actor-b@academia.test',
      memberMdm: '', memberCm: 'cm-member-b', memberEmail: 'member-b@academia.test',
      storyMdm: '', storyCm: 'cm-story-b', storyEmail: 'story-b@academia.test',
    },
    threadId: 'room-b', taskId: 'task-b', revision: 7, bumpedRevision: 70, roomMode: 'group', groupKey: 'group-b',
    priorCommand: 'prior-b', advanceCommand: 'adv-b',
  },
];

function writeCredential(item: Directed): void {
  const dir = process.env.CBE_PROJECT_FILES_DIR;
  if (dir === undefined) throw new Error('credential dir missing');
  writeFileSync(join(dir, `${item.project}.json`), JSON.stringify({
    schema: 1,
    generatedAt: '2026-10-19T00:00:00.000Z',
    org: { orgId: item.org, slug: 'private', name: 'Private', createdAt: '2026-10-19T00:00:00.000Z' },
    project: {
      projectId: item.project,
      domain: 'app.test',
      appEnv: null,
      language: null,
      type: 'app',
      createdAt: '2026-10-19T00:00:00.000Z',
    },
    collabMessages: { token: item.token },
  }));
}

function bindLoopback(route: (body: Record<string, unknown>) => Reply): Promise<{ seen: Seen[] }> {
  const seen: Seen[] = [];
  const portPromise = listen(async (req, res) => {
    const body = await readBody(req);
    seen.push({
      action: String(body.action),
      authorization: header(req, 'authorization'),
      userHeader: header(req, 'x-user-id'),
      orgHeader: header(req, 'x-org-id'),
      appHeader: header(req, 'x-app-id'),
      cookie: header(req, 'cookie'),
      body,
    });
    const reply = route(body);
    res.writeHead(reply.httpStatus, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });
  return portPromise.then((port) => {
    process.env.MSG_PROXY_TARGET = `http://127.0.0.1:${port}`;
    process.env.MSG_PROXY_TOKEN = TOKEN_GLOBAL;
    process.env.MSG_PROXY_ORG_ID = 'org-from-env';
    process.env.MSG_PROXY_USER_ID = ENV_USER;
    return { seen };
  });
}

function requestCtx(projectId: string): RequestContext {
  const ctx = createRequestContext();
  ctx.requestMeta = { requestId: 'rt102', userId: DECOY_EMAIL, source: 'test' };
  ctx.sessionContext.activeCompanyId = 'company-decoy';
  ctx.sessionContext.project.projectId = projectId;
  return ctx;
}

async function bindPeople(ctx: RequestContext, people: People): Promise<void> {
  async function one(email: string): Promise<string> {
    const created = await ctx.mdm.entity.create({
      details: { subtype: 'Person', name: 'Aluno Runtime', status: 'Active' },
    });
    await ctx.mdm.identity.setLogin(created.mdmId, email);
    return created.mdmId;
  }
  people.ownerMdm = await one(people.ownerEmail);
  people.byMdm = await one(people.byEmail);
  people.actorMdm = await one(people.actorEmail);
  people.memberMdm = await one(people.memberEmail);
  people.storyMdm = await one(people.storyEmail);
}

function indexPeople(people: People): { byMdm: Map<string, Stored>; byCm: Map<string, Stored> } {
  const rows: Stored[] = [
    { mdmId: people.ownerMdm, cmUserId: people.ownerCm, state: 'unlinked', email: people.ownerEmail },
    { mdmId: people.byMdm, cmUserId: people.byCm, state: 'unlinked', email: people.byEmail },
    { mdmId: people.actorMdm, cmUserId: people.actorCm, state: 'unlinked', email: people.actorEmail },
    { mdmId: people.memberMdm, cmUserId: people.memberCm, state: 'unlinked', email: people.memberEmail },
    { mdmId: people.storyMdm, cmUserId: people.storyCm, state: 'linked', email: people.storyEmail },
  ];
  return {
    byMdm: new Map(rows.map((row) => [row.mdmId, row])),
    byCm: new Map(rows.map((row) => [row.cmUserId, row])),
  };
}

function ok(body: Record<string, unknown>): Reply {
  return { httpStatus: 200, body: { statusCode: 200, ...body } };
}

function personView(row: Stored, asked: 'mdm' | 'cm'): Record<string, unknown> {
  if (row.state === 'unlinked') {
    return asked === 'mdm' ? { mdmId: row.mdmId, state: 'unlinked' } : { cmUserId: row.cmUserId, state: 'unlinked' };
  }
  return { mdmId: row.mdmId, cmUserId: row.cmUserId, state: row.state };
}

function planOf(item: Directed, which: 'stored' | 'templateB'): WorkflowPlanInput {
  return {
    processId: item.processId,
    title: which === 'stored' ? item.processTitle : 'Template B',
    moduleTitle: which === 'stored' ? item.moduleTitle : 'Template module B',
    steps: [
      {
        stepId: item.stepA,
        kind: 'human',
        title: which === 'templateB' ? 'Template start B' : item.titleA,
        next: [item.stepB],
        actorRef: item.actorRef,
      },
      {
        stepId: item.stepB,
        kind: item.kindB,
        title: which === 'templateB' ? 'Template act B' : item.titleB,
        next: [],
        functionRef: item.functionRef,
        ...(item.kindB === 'llm' ? { journeyRef: `journey-${item.project}` } : {}),
      },
    ],
  };
}

function ownerKind(kind: 'human' | Directed['kindB']): 'person' | 'module' | 'agent' {
  if (kind === 'human') return 'person';
  if (kind === 'mechanical') return 'module';
  return 'agent';
}

function child(item: Directed, key: string, status: AIModuleStep['status']): AIModuleStep {
  const second = key !== item.stepA;
  const kind = second ? item.kindB : 'human';
  return {
    type: 'module',
    stepId: second ? 2 : 1,
    status,
    stepTitle: second ? item.titleB : item.titleA,
    interaction: null,
    nextSteps: [],
    module: {
      key,
      kind,
      ownerKind: ownerKind(kind),
      next: second ? [] : [item.stepB],
      passes: 1,
      actorNow: second ? item.people.storyCm : item.people.actorCm,
      ...(second
        ? { functionRef: item.functionRef, ...(item.kindB === 'llm' ? { journeyRef: `journey-${item.project}` } : {}) }
        : { actorRef: item.actorRef }),
    },
  };
}

function taskOf(item: Directed, revision: number, messageState: 'pending' | 'absent'): TaskData {
  const current = child(item, item.stepA, 'in_progress');
  const next = child(item, item.stepB, 'pending');
  const root: AIModuleStep = {
    type: 'module',
    stepId: 0,
    status: 'pending',
    stepTitle: item.processTitle,
    interaction: null,
    nextSteps: [current, next],
    module: { key: item.processId, kind: 'human', ownerKind: 'person', next: [item.stepA], passes: 1 },
  };
  return {
    PK: item.taskId,
    SK: 'metadata',
    title: item.occurrenceTitle,
    owner: item.people.ownerCm,
    team: null,
    status: 'in progress',
    last_updated: 1,
    last_update_log: null,
    taskRoom: { enabled: true, threadId: item.threadId },
    iaCompressed: { nextSteps: [root], longMemory: {}, queueBackEnd: [], queueFrontEnd: [] },
    module: {
      ref: {
        project: item.project,
        module: item.module,
        entity: item.entity,
        recordId: item.recordId,
        processId: item.processId,
        workflowVersion: item.version,
      },
      origin: { kind: 'screen', by: item.people.byCm },
      owner: item.people.ownerCm,
      revision,
      room: {
        mode: item.roomMode,
        ...(item.groupKey === undefined ? {} : { groupKey: item.groupKey }),
        members: [item.people.memberCm],
      },
      moduleTitle: item.moduleTitle,
      history: [
        {
          at: '2026-10-19T00:00:00.000Z',
          commandId: item.priorCommand,
          from: item.stepA,
          step: item.stepA,
          actorNow: item.people.storyCm,
          done: false,
          executor: { kind: 'person', userId: item.people.storyCm },
          message: { state: 'sent', threadId: item.threadId, orderAt: '2026-10-19T00:00:01.000Z', content: 'hidden-prior', author: 'person', userId: item.people.storyCm },
        },
        {
          at: '2026-10-19T00:01:00.000Z',
          commandId: 'open-cmd',
          from: null,
          step: item.stepA,
          actorNow: item.people.actorCm,
          done: false,
          executor: { kind: 'routine', name: 'nightly' },
          ...(messageState === 'absent' ? {} : {
            message: { state: messageState, threadId: item.threadId, orderAt: '2026-10-19T00:01:01.000Z', content: 'hidden', author: 'person', userId: item.people.actorCm },
          }),
        },
      ],
    },
  };
}

function openInput(item: Directed, plan: WorkflowPlanInput): TaskWorkflowOpen {
  return {
    key: { project: item.project, module: item.module, processId: item.processId, entity: item.entity, recordId: item.recordId },
    plan,
    title: item.inputTitle,
    firstStep: item.stepA,
    actorNow: item.people.actorMdm,
    owner: item.people.ownerMdm,
    origin: { kind: 'screen', by: item.people.byMdm },
    executor: { kind: 'person', mdmId: item.people.actorMdm },
    room: {
      mode: item.roomMode,
      ...(item.groupKey === undefined ? {} : { groupKey: item.groupKey }),
      members: [item.people.memberMdm],
    },
    message: { content: 'from-caller' },
  };
}

function engineFor(item: Directed): TaskWorkflowEngine {
  return createWorkflowEngine(createRuntimeMessagesTaskPort({
    projectId: item.project,
    moduleId: item.module,
  }));
}

async function withRelease(run: () => Promise<void>): Promise<void> {
  const previous = process.cwd();
  const root = mkdtempSync(join(tmpdir(), 'rt102-rel-'));
  tempDirs.push(root);
  writeFileSync(join(root, 'release.json'), JSON.stringify({ id: 'rel-runtime' }));
  process.chdir(root);
  resetRunningReleaseCache();
  try {
    await run();
  } finally {
    process.chdir(previous);
  }
}

test('production composition is exported beside the generic library', () => {
  assert.equal(typeof createRuntimeMessagesTaskPort, 'function');
  assert.equal(typeof createMessagesTaskOccurrencePort, 'function');
  assert.equal(typeof createMemoryOccurrencePort, 'function');
  const legacy = createWorkflowEngine(createMemoryOccurrencePort());
  assert.equal(typeof legacy.open, 'function');
});

test('real factory links through server login and resumes the canonical plan', async () => {
  await withRelease(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rt102-runtime-'));
    tempDirs.push(dir);
    process.env.CBE_PROJECT_FILES_DIR = dir;
    for (const item of CASES) {
      writeCredential(item);
      const ctx = requestCtx(item.project);
      await bindPeople(ctx, item.people);
      const book = indexPeople(item.people);
      let mode: 'live' | 'diverge-owner' | 'busy' | 'room' = 'live';
      let opened = false;
      const loop = await bindLoopback((body) => {
        const action = String(body.action);
        assert.equal(body.userId, `app:${item.project}`);
        assert.equal(JSON.stringify(body).includes(DECOY_EMAIL), false);
        assert.equal(JSON.stringify(body).includes(ENV_USER), false);
        if (action === 'linkModulePerson') {
          const mdmId = String(body.mdmId);
          const row = book.byMdm.get(mdmId);
          assert.ok(row);
          assert.equal(body.loginEmail, row.email);
          assert.equal(row.state, 'unlinked');
          row.state = 'linked';
          return ok({ cmUserId: row.cmUserId, outcome: 'linked' });
        }
        if (action === 'resolveModulePeople') {
          const mdmIds = body.mdmIds as string[] | undefined;
          const cmUserIds = body.cmUserIds as string[] | undefined;
          if (mdmIds && cmUserIds) {
            const row = book.byMdm.get(mdmIds[0]);
            assert.ok(row);
            if (mode === 'diverge-owner' && row.mdmId === item.people.ownerMdm) {
              return ok({ people: [
                { mdmId: row.mdmId, cmUserId: 'cm-other', state: 'linked' },
                { mdmId: 'mdm-other', cmUserId: row.cmUserId, state: 'linked' },
              ] });
            }
            return ok({ people: [personView(row, 'mdm'), personView(row, 'cm')] });
          }
          if (mdmIds) {
            const row = book.byMdm.get(mdmIds[0]);
            assert.ok(row);
            return ok({ people: [personView(row, 'mdm')] });
          }
          const row = book.byCm.get((cmUserIds ?? [])[0]);
          if (!row || row.state === 'unlinked') return ok({ people: [{ cmUserId: (cmUserIds ?? [])[0], state: 'unlinked' }] });
          return ok({ people: [personView(row, 'cm')] });
        }
        if (action === 'getModuleTask') {
          const ref = body.ref as { recordId?: string } | undefined;
          if (mode === 'busy') return { httpStatus: 503, body: { statusCode: 503, msg: 'busy', taskId: item.taskId } };
          if (mode === 'room' && ref?.recordId === item.recordId) {
            return { httpStatus: 200, body: { statusCode: 200, task: taskOf(item, item.revision, 'pending'), room: null, roomIssue: 'not_linked' } };
          }
          if (!opened || ref?.recordId !== item.recordId) return { httpStatus: 200, body: { statusCode: 404, msg: 'not_found' } };
          return ok({ task: taskOf(item, item.revision, 'pending'), room: { threadId: item.threadId } });
        }
        if (action === 'openModuleTask') {
          assert.equal(body.owner, item.people.ownerCm);
          assert.equal((body.origin as { by: string }).by, item.people.byCm);
          assert.equal(body.actorNow, item.people.actorCm);
          assert.deepEqual((body.room as { members: string[] }).members, [item.people.memberCm]);
          assert.equal((body.executor as { kind: string }).kind, 'person');
          assert.equal((body.executor as { userId: string }).userId, item.people.actorCm);
          assert.equal(JSON.stringify(body).includes(item.people.ownerMdm), false);
          assert.equal(JSON.stringify(body).includes(item.people.storyMdm), false);
          opened = true;
          const pending = { state: 'pending', threadId: item.threadId, orderAt: '2026-10-19T00:02:00.000Z', content: 'hidden', author: 'hidden', userId: item.people.actorCm };
          return ok({ task: taskOf(item, item.revision, 'pending'), room: { threadId: item.threadId }, created: true, moduleMessage: pending });
        }
        if (action === 'applyIntents') {
          const intent = (body.intents as Array<Record<string, unknown>>)[0];
          return ok({
            task: taskOf(item, item.bumpedRevision, 'pending'),
            room: { threadId: item.threadId },
            moduleAdvance: { commandId: intent.commandId, outcome: 'applied' },
            moduleMessage: { state: 'pending', threadId: item.threadId, orderAt: '2026-10-19T00:04:00.000Z', content: 'hidden', author: 'hidden', userId: item.people.actorCm },
          });
        }
        return { httpStatus: 500, body: { statusCode: 500, msg: 'unscripted' } };
      });

      const created = await engineFor(item).open(ctx, openInput(item, planOf(item, 'stored')));
      assert.equal(created.outcome, 'created');
      assert.equal(created.occurrence.owner, item.people.ownerMdm);
      assert.equal(created.occurrence.origin.by, item.people.byMdm);
      assert.equal(created.occurrence.actorNow, item.people.actorMdm);
      assert.deepEqual(created.occurrence.room.members, [item.people.memberMdm]);
      assert.equal(created.occurrence.history[0].actorNow, item.people.storyMdm);
      assert.equal(created.occurrence.history[0].executor.kind, 'person');
      if (created.occurrence.history[0].executor.kind === 'person') {
        assert.equal(created.occurrence.history[0].executor.mdmId, item.people.storyMdm);
      }
      assert.equal(created.occurrence.history[1].executor.kind, 'routine');
      assert.equal(created.moduleMessage?.state, 'pending');
      assert.equal(created.occurrence.plan.title, item.processTitle);
      const links = loop.seen.filter((hit) => hit.action === 'linkModulePerson');
      assert.equal(links.length, 4);

      await ctx.mdm.identity.setLogin(item.people.ownerMdm, 'changed-login@academia.test');
      const before = loop.seen.length;
      const resumed = await engineFor(item).open(ctx, openInput(item, planOf(item, 'templateB')));
      assert.equal(resumed.outcome, 'existing');
      assert.equal(resumed.occurrence.plan.title, item.processTitle);
      assert.equal(resumed.occurrence.plan.steps[1].title, item.titleB);
      assert.equal(loop.seen.slice(before).some((hit) => hit.action === 'linkModulePerson' || hit.action === 'openModuleTask'), false);

      const posts = loop.seen.filter((hit) => hit.action === 'applyIntents').length;
      mode = 'busy';
      await assert.rejects(
        () => engineFor(item).advance(ctx, openInput(item, planOf(item, 'stored')).key, {
          commandId: item.advanceCommand,
          expectedRevision: item.revision,
          from: item.stepA,
          to: item.stepB,
          actorNow: item.people.actorMdm,
          executor: { kind: 'routine', name: 'nightly' },
        }),
        (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_CM_BUSY',
      );
      mode = 'room';
      await assert.rejects(
        () => engineFor(item).advance(ctx, openInput(item, planOf(item, 'stored')).key, {
          commandId: item.advanceCommand,
          expectedRevision: item.revision,
          from: item.stepA,
          to: item.stepB,
          actorNow: item.people.actorMdm,
          executor: { kind: 'routine', name: 'nightly' },
        }),
        (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_CM_ROOM_UNAVAILABLE',
      );
      assert.equal(loop.seen.filter((hit) => hit.action === 'applyIntents').length, posts);
      mode = 'live';

      const advanced = await engineFor(item).advance(ctx, openInput(item, planOf(item, 'stored')).key, {
        commandId: item.advanceCommand,
        expectedRevision: item.revision,
        from: item.stepA,
        to: item.stepB,
        actorNow: item.people.actorMdm,
        executor: { kind: 'routine', name: 'nightly' },
        message: { content: 'advance-caller' },
      });
      assert.equal(advanced.moduleMessage?.state, 'pending');
      const intent = loop.seen.filter((hit) => hit.action === 'applyIntents').at(-1)?.body.intents as Array<Record<string, unknown>>;
      assert.equal((intent[0].executor as { kind: string }).kind, 'routine');
      assert.equal((intent[0].executor as { name: string }).name, 'nightly');
      assert.equal('userId' in (intent[0].executor as object), false);

      const owner = book.byMdm.get(item.people.ownerMdm);
      assert.ok(owner);
      owner.state = 'removed';
      const found = await engineFor(item).find(ctx, openInput(item, planOf(item, 'stored')).key);
      assert.equal(found?.owner, item.people.ownerMdm);
      const opens = loop.seen.filter((hit) => hit.action === 'openModuleTask').length;
      await assert.rejects(
        () => engineFor(item).open(ctx, {
          ...openInput(item, planOf(item, 'stored')),
          key: { ...openInput(item, planOf(item, 'stored')).key, recordId: `${item.recordId}-new` },
        }),
        (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_IDENTITY_REMOVED',
      );
      assert.equal(loop.seen.filter((hit) => hit.action === 'openModuleTask').length, opens);

      mode = 'diverge-owner';
      owner.state = 'linked';
      await assert.rejects(
        () => engineFor(item).open(ctx, {
          ...openInput(item, planOf(item, 'stored')),
          key: { ...openInput(item, planOf(item, 'stored')).key, recordId: `${item.recordId}-split` },
        }),
        (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_IDENTITY_INCOMPLETE',
      );
      assert.equal(loop.seen.filter((hit) => hit.action === 'openModuleTask').length, opens);

      for (const hit of loop.seen) {
        assert.equal(ACTIONS.has(hit.action), true);
        assert.equal(hit.authorization, `Bearer ${item.token}`);
        assert.equal(hit.authorization === `Bearer ${TOKEN_GLOBAL}`, false);
        assert.equal(hit.userHeader, `app:${item.project}`);
        assert.equal(hit.userHeader === ENV_USER, false);
        assert.equal(hit.body.userId, `app:${item.project}`);
        assert.equal(hit.orgHeader, item.org);
        assert.equal(hit.appHeader, item.project);
        assert.equal(hit.cookie, undefined);
      }
      for (const action of ACTIONS) assert.equal(loop.seen.some((hit) => hit.action === action), true);
    }
  });
});
