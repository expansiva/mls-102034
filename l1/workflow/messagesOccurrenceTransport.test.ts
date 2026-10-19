/// <mls fileReference="_102034_/l1/workflow/messagesOccurrenceTransport.test.ts" enhancement="_blank"/>
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
  createWorkflowEngine,
  type MessagesTaskOccurrencePortOptions,
  type MessagesWorkflowIdentities,
  type TaskWorkflowEngine,
  type TaskWorkflowOpen,
} from '/_102034_/l1/workflow/index.js';
import type { WorkflowPlanInput } from '/_102034_/l1/workflow/plan.js';

const TOKEN_FILE = 'sentinel-rt101-file-token';
const TOKEN_GLOBAL = 'sentinel-rt101-global-token';
const AS_USER = 'cm-tech-explicit';
const ENV_USER = 'user-from-env';
const ALLOWED = new Set(['getModuleTask', 'openModuleTask', 'applyIntents']);

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

function writeCredential(projectId: string, orgId: string): void {
  const dir = process.env.CBE_PROJECT_FILES_DIR;
  if (dir === undefined) throw new Error('credential dir missing');
  writeFileSync(join(dir, `${projectId}.json`), JSON.stringify({
    schema: 1,
    generatedAt: '2026-10-19T00:00:00.000Z',
    org: { orgId, slug: 'private', name: 'Private', createdAt: '2026-10-19T00:00:00.000Z' },
    project: {
      projectId,
      domain: 'app.test',
      appEnv: null,
      language: null,
      type: 'app',
      createdAt: '2026-10-19T00:00:00.000Z',
    },
    collabMessages: { token: TOKEN_FILE },
  }));
}

function bindLoopback(): Promise<{ seen: Seen[]; push: (reply: Reply) => void }> {
  const seen: Seen[] = [];
  const queue: Reply[] = [];
  const portPromise = listen(async (req, res) => {
    const body = await readBody(req);
    const item: Seen = {
      action: String(body.action),
      authorization: header(req, 'authorization'),
      userHeader: header(req, 'x-user-id'),
      orgHeader: header(req, 'x-org-id'),
      appHeader: header(req, 'x-app-id'),
      cookie: header(req, 'cookie'),
      body,
    };
    seen.push(item);
    const reply = queue.shift() ?? { httpStatus: 500, body: { statusCode: 500, msg: 'unscripted' } };
    res.writeHead(reply.httpStatus, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });
  return portPromise.then((port) => {
    process.env.MSG_PROXY_TARGET = `http://127.0.0.1:${port}`;
    process.env.MSG_PROXY_TOKEN = TOKEN_GLOBAL;
    process.env.MSG_PROXY_ORG_ID = 'org-from-env';
    process.env.MSG_PROXY_USER_ID = ENV_USER;
    return {
      seen,
      push(reply: Reply): void {
        queue.push(reply);
      },
    };
  });
}

function requestCtx(): RequestContext {
  const ctx = createRequestContext();
  ctx.requestMeta = { requestId: 'rt101', userId: 'telemetry-only', source: 'test' };
  return ctx;
}

interface People {
  ownerMdm: string;
  ownerCm: string;
  byMdm: string;
  byCm: string;
  actorMdm: string;
  actorCm: string;
  memberMdm: string;
  memberCm: string;
}

function testIdentities(people: People): MessagesWorkflowIdentities {
  const toCm = new Map([
    [people.ownerMdm, people.ownerCm],
    [people.byMdm, people.byCm],
    [people.actorMdm, people.actorCm],
    [people.memberMdm, people.memberCm],
  ]);
  const toMdm = new Map([...toCm.entries()].map(([mdm, cm]) => [cm, mdm]));
  return {
    async toCmUserId(_ctx, mdmId) {
      const cm = toCm.get(mdmId);
      if (cm === undefined) throw new AppError('IDENTITY_NOT_FOUND', 'missing', 404);
      return cm;
    },
    async toMdmId(_ctx, userId) {
      const mdm = toMdm.get(userId);
      if (mdm === undefined) throw new AppError('IDENTITY_NOT_FOUND', 'missing', 404);
      return mdm;
    },
  };
}

interface Directed {
  project: string;
  org: string;
  module: string;
  entity: string;
  recordId: string;
  otherRecordId: string;
  processId: string;
  version: string;
  occurrenceTitle: string;
  inputTitle: string;
  processTitle: string;
  moduleTitle: string;
  otherProcessTitle: string;
  stepA: string;
  stepB: string;
  titleA: string;
  titleB: string;
  kindB: 'mechanical' | 'llm' | 'wait';
  actorRef: string;
  functionRef: string;
  conditions: string;
  param: string;
  people: People;
  threadId: string;
  taskId: string;
  revision: number;
  bumpedRevision: number;
  passes: number;
  priorCommand: string;
  openCommand: string;
  advanceCommand: string;
  roomMode: 'person' | 'group';
  groupKey?: string;
}

const CASES: Directed[] = [
  {
    project: '102101', org: 'org-rt101-a', module: 'mod-a', entity: 'ordem', recordId: 'rec-a', otherRecordId: 'rec-a2',
    processId: 'proc-a', version: 'rel-a', occurrenceTitle: 'Occurrence A', inputTitle: 'Input A',
    processTitle: 'Process A', moduleTitle: 'Module A', otherProcessTitle: 'Process B',
    stepA: 'start-a', stepB: 'act-a', titleA: 'Start A', titleB: 'Act A', kindB: 'mechanical',
    actorRef: 'role-a', functionRef: 'fn-a', conditions: 'ready-a', param: 'lane-a',
    people: { ownerMdm: 'mdm-owner-a', ownerCm: 'cm-owner-a', byMdm: 'mdm-by-a', byCm: 'cm-by-a', actorMdm: 'mdm-actor-a', actorCm: 'cm-actor-a', memberMdm: 'mdm-member-a', memberCm: 'cm-member-a' },
    threadId: 'room-a', taskId: 'task-a', revision: 4, bumpedRevision: 91, passes: 2,
    priorCommand: 'prior-a', openCommand: 'open-a', advanceCommand: 'adv-a', roomMode: 'person',
  },
  {
    project: '102102', org: 'org-rt101-b', module: 'mod-b', entity: 'caso', recordId: 'rec-b', otherRecordId: 'rec-b2',
    processId: 'proc-b', version: 'rel-b', occurrenceTitle: 'Occurrence B', inputTitle: 'Input B',
    processTitle: 'Process B stored', moduleTitle: 'Module B stored', otherProcessTitle: 'Process B next',
    stepA: 'start-b', stepB: 'ask-b', titleA: 'Start B', titleB: 'Ask B', kindB: 'llm',
    actorRef: 'role-b', functionRef: 'fn-b', conditions: 'ready-b', param: 'lane-b',
    people: { ownerMdm: 'mdm-owner-b', ownerCm: 'cm-owner-b', byMdm: 'mdm-by-b', byCm: 'cm-by-b', actorMdm: 'mdm-actor-b', actorCm: 'cm-actor-b', memberMdm: 'mdm-member-b', memberCm: 'cm-member-b' },
    threadId: 'room-b', taskId: 'task-b', revision: 7, bumpedRevision: 70, passes: 3,
    priorCommand: 'prior-b', openCommand: 'open-b', advanceCommand: 'adv-b', roomMode: 'group', groupKey: 'group-b',
  },
  {
    project: '102103', org: 'org-rt101-c', module: 'mod-c', entity: 'fila', recordId: 'rec-c', otherRecordId: 'rec-c2',
    processId: 'proc-c', version: 'rel-c', occurrenceTitle: 'Occurrence C', inputTitle: 'Input C',
    processTitle: 'Process C stored', moduleTitle: 'Module C stored', otherProcessTitle: 'Process C next',
    stepA: 'start-c', stepB: 'wait-c', titleA: 'Start C', titleB: 'Wait C', kindB: 'wait',
    actorRef: 'role-c', functionRef: 'fn-c', conditions: 'ready-c', param: 'lane-c',
    people: { ownerMdm: 'mdm-owner-c', ownerCm: 'cm-owner-c', byMdm: 'mdm-by-c', byCm: 'cm-by-c', actorMdm: 'mdm-actor-c', actorCm: 'cm-actor-c', memberMdm: 'mdm-member-c', memberCm: 'cm-member-c' },
    threadId: 'room-c', taskId: 'task-c', revision: 2, bumpedRevision: 20, passes: 1,
    priorCommand: 'prior-c', openCommand: 'open-c', advanceCommand: 'adv-c', roomMode: 'person',
  },
];

function ownerKind(kind: Directed['kindB'] | 'human'): 'person' | 'module' | 'agent' | 'clock' {
  if (kind === 'human') return 'person';
  if (kind === 'mechanical') return 'module';
  if (kind === 'llm') return 'agent';
  return 'clock';
}

function planOf(item: Directed, which: 'stored' | 'templateB' | 'next'): WorkflowPlanInput {
  const processTitle = which === 'stored' ? item.processTitle : which === 'templateB' ? 'Template B' : item.otherProcessTitle;
  const moduleTitle = which === 'stored' ? item.moduleTitle : which === 'templateB' ? 'Template module B' : `${item.moduleTitle} next`;
  const stepB = which === 'next' ? `${item.stepB}-next` : item.stepB;
  return {
    processId: item.processId,
    title: processTitle,
    moduleTitle,
    steps: [
      {
        stepId: item.stepA,
        kind: 'human',
        title: which === 'templateB' ? 'Template start B' : item.titleA,
        next: [stepB],
        actorRef: item.actorRef,
        conditions: item.conditions,
        params: { lane: item.param },
      },
      {
        stepId: stepB,
        kind: item.kindB,
        title: which === 'templateB' ? 'Template act B' : item.titleB,
        next: [],
        functionRef: item.functionRef,
        ...(item.kindB === 'llm' ? { journeyRef: `journey-${item.project}` } : {}),
      },
    ],
  };
}

function child(item: Directed, key: string, status: AIModuleStep['status'], message?: 'pending' | 'sent'): AIModuleStep {
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
      passes: item.passes,
      actorNow: item.people.actorCm,
      ...(second
        ? { functionRef: item.functionRef, ...(item.kindB === 'llm' ? { journeyRef: `journey-${item.project}` } : {}) }
        : { actorRef: item.actorRef, conditions: item.conditions, params: { lane: item.param } }),
      ...(status === 'in_progress' ? { wake: { everyMinutes: 15, routine: 'nightly', nextAt: '2026-10-19T12:15:00.000Z', seq: 3 } } : {}),
    },
  };
  void message;
}

function history(item: Directed, messageState: 'pending' | 'sent' | 'absent'): TaskData['module'] extends infer M ? M extends { history: infer H } ? H : never : never {
  const prior = {
    at: '2026-10-19T00:00:00.000Z',
    commandId: item.priorCommand,
    from: item.stepA,
    step: item.stepA,
    actorNow: item.people.actorCm,
    done: false,
    note: 'earlier',
    executor: { kind: 'person' as const, userId: item.people.actorCm },
    message: { state: 'sent' as const, threadId: item.threadId, orderAt: '2026-10-19T00:00:01.000Z', content: 'hidden-prior', author: 'person' as const, userId: item.people.actorCm },
  };
  const opening = {
    at: '2026-10-19T00:01:00.000Z',
    commandId: item.openCommand,
    from: null,
    step: item.stepA,
    actorNow: item.people.actorCm,
    done: false,
    executor: { kind: 'person' as const, userId: item.people.byCm },
    ...(messageState === 'absent' ? {} : {
      message: { state: messageState, threadId: item.threadId, orderAt: '2026-10-19T00:01:01.000Z', content: 'hidden-open', author: 'person' as const, userId: item.people.byCm },
    }),
  };
  return [prior, opening];
}

function taskOf(item: Directed, recordId: string, revision: number, messageState: 'pending' | 'sent' | 'absent'): TaskData {
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
        recordId,
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
      history: history(item, messageState),
    },
  };
}

function absent(): Reply {
  return { httpStatus: 200, body: { statusCode: 404, msg: 'not_found' } };
}

function found(task: TaskData, extra: Record<string, unknown> = {}): Reply {
  return { httpStatus: 200, body: { statusCode: 200, task, room: { threadId: task.taskRoom?.threadId }, ...extra } };
}

function assertHeaders(item: Seen, project: string, org: string): void {
  assert.equal(ALLOWED.has(item.action), true);
  const authorization: string | undefined = item.authorization;
  const userHeader: string | undefined = item.userHeader;
  assert.equal(authorization === `Bearer ${TOKEN_GLOBAL}`, false);
  assert.equal(authorization, `Bearer ${TOKEN_FILE}`);
  assert.equal(userHeader === ENV_USER, false);
  assert.equal(userHeader, AS_USER);
  assert.equal(item.orgHeader, org);
  assert.equal(item.appHeader, project);
  assert.equal(item.cookie, undefined);
  assert.equal(JSON.stringify(item.body).includes(TOKEN_FILE), false);
  assert.equal(JSON.stringify(item.body).includes(TOKEN_GLOBAL), false);
}

async function withRelease(run: () => Promise<void>): Promise<void> {
  const previous = process.cwd();
  const root = mkdtempSync(join(tmpdir(), 'rt101-rel-'));
  tempDirs.push(root);
  writeFileSync(join(root, 'release.json'), JSON.stringify({ id: 'rel-transport' }));
  process.chdir(root);
  resetRunningReleaseCache();
  try {
    await run();
  } finally {
    process.chdir(previous);
  }
}

function openInput(item: Directed, recordId: string, plan: WorkflowPlanInput): TaskWorkflowOpen {
  return {
    key: { project: item.project, module: item.module, processId: item.processId, entity: item.entity, recordId },
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
  const options: MessagesTaskOccurrencePortOptions = {
    projectId: item.project,
    moduleId: item.module,
    asUserId: AS_USER,
    identities: testIdentities(item.people),
  };
  return createWorkflowEngine(createMessagesTaskOccurrencePort(options));
}

test('public workflow entry keeps the legacy engine and requires an explicit resolver', () => {
  assert.equal(typeof createMemoryOccurrencePort, 'function');
  assert.equal(typeof createMessagesTaskOccurrencePort, 'function');
  const legacy = createWorkflowEngine(createMemoryOccurrencePort());
  assert.equal(typeof legacy.open, 'function');
  const options: MessagesTaskOccurrencePortOptions = {
    projectId: '102101',
    moduleId: 'mod-a',
    asUserId: AS_USER,
    identities: testIdentities(CASES[0].people),
  };
  assert.equal(createMessagesTaskOccurrencePort(options).kind, 'task');
});

test('loopback transport keeps canonical A, then opens the next occurrence as B', async () => {
  await withRelease(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rt101-transport-'));
    tempDirs.push(dir);
    process.env.CBE_PROJECT_FILES_DIR = dir;
    for (const item of CASES) {
      writeCredential(item.project, item.org);
      const loop = await bindLoopback();
      const ctx = requestCtx();
      const canonical = taskOf(item, item.recordId, item.revision, 'pending');
      const pendingMessage = { state: 'pending', threadId: item.threadId, orderAt: '2026-10-19T00:02:00.000Z', content: 'hidden', author: 'hidden', userId: item.people.actorCm };

      loop.push(absent());
      loop.push(found(canonical, { created: true, moduleMessage: pendingMessage }));
      const created = await engineFor(item).open(ctx, openInput(item, item.recordId, planOf(item, 'stored')));
      assert.equal(created.outcome, 'created');
      assert.equal(created.occurrence.title, item.occurrenceTitle);
      assert.equal(created.occurrence.title === item.inputTitle, false);
      assert.equal(created.occurrence.revision, item.revision);
      assert.equal(created.occurrence.plan.title, item.processTitle);
      assert.equal(created.occurrence.owner, item.people.ownerMdm);
      assert.equal(created.occurrence.origin.by, item.people.byMdm);
      assert.equal(created.occurrence.actorNow, item.people.actorMdm);
      assert.deepEqual(created.occurrence.room.members, [item.people.memberMdm]);
      assert.equal(created.moduleMessage?.state, 'pending');
      assert.equal(created.occurrence.history[0].commandId, item.priorCommand);
      assert.equal(created.occurrence.history[0].message?.state, 'sent');
      assert.equal(JSON.stringify(created).includes('hidden'), false);

      const openBody = loop.seen[1].body;
      assert.equal(openBody.action, 'openModuleTask');
      const sentPlan = openBody.plan as { title: string; steps: Array<{ key: string; actorRef?: string; functionRef?: string }> };
      assert.equal(sentPlan.title, item.processTitle);
      assert.equal(sentPlan.steps[0].key, item.stepA);
      assert.equal(sentPlan.steps[0].actorRef, item.actorRef);
      assert.equal(sentPlan.steps[1].functionRef, item.functionRef);
      assert.equal(openBody.owner, item.people.ownerCm);
      assert.equal((openBody.origin as { by: string }).by, item.people.byCm);
      assert.equal(openBody.actorNow, item.people.actorCm);
      assert.deepEqual((openBody.room as { members: string[] }).members, [item.people.memberCm]);
      assert.equal((openBody.executor as { userId: string }).userId, item.people.actorCm);

      loop.push(found(canonical));
      const resumed = await engineFor(item).open(ctx, openInput(item, item.recordId, planOf(item, 'templateB')));
      assert.equal(resumed.outcome, 'existing');
      assert.equal(resumed.occurrence.plan.title, item.processTitle);
      assert.equal(resumed.occurrence.plan.title === 'Template B', false);
      assert.equal(resumed.occurrence.plan.steps[1].title, item.titleB);
      assert.equal(resumed.occurrence.revision, item.revision);
      assert.equal(resumed.moduleMessage?.state, 'pending');
      assert.equal(loop.seen.filter((hit) => hit.action === 'openModuleTask').length, 1);

      const nextTask = taskOf(item, item.otherRecordId, 1, 'sent');
      nextTask.module!.moduleTitle = `${item.moduleTitle} next`;
      const nextRoot = nextTask.iaCompressed?.nextSteps[0] as AIModuleStep;
      nextRoot.stepTitle = item.otherProcessTitle;
      loop.push(absent());
      loop.push(found(nextTask, { created: true, moduleMessage: { state: 'sent', threadId: item.threadId, orderAt: '2026-10-19T00:03:00.000Z' } }));
      const next = await engineFor(item).open(ctx, openInput(item, item.otherRecordId, planOf(item, 'next')));
      assert.equal(next.outcome, 'created');
      assert.equal(next.occurrence.plan.title, item.otherProcessTitle);
      assert.equal(next.occurrence.ref.recordId, item.otherRecordId);
      assert.equal(next.moduleMessage?.state, 'sent');
      const nextOpen = loop.seen.filter((hit) => hit.action === 'openModuleTask')[1].body;
      assert.equal((nextOpen.plan as { title: string }).title, item.otherProcessTitle);
      assert.equal((nextOpen.ref as { recordId: string }).recordId, item.otherRecordId);

      const bumped = taskOf(item, item.recordId, item.bumpedRevision, 'absent');
      loop.push(found(canonical));
      loop.push(found(canonical));
      loop.push(found(bumped, {
        moduleAdvance: { commandId: item.advanceCommand, outcome: 'unchanged' },
        moduleMessage: pendingMessage,
      }));
      const unchanged = await engineFor(item).advance(ctx, openInput(item, item.recordId, planOf(item, 'stored')).key, {
        commandId: item.advanceCommand,
        expectedRevision: item.revision,
        from: item.stepA,
        to: item.stepB,
        actorNow: item.people.actorMdm,
        executor: { kind: 'routine', name: 'nightly' },
        message: { content: 'advance-caller' },
      });
      assert.equal(unchanged.outcome, 'unchanged');
      assert.equal(unchanged.occurrence.revision, item.bumpedRevision);
      assert.equal(unchanged.moduleMessage?.state, 'pending');

      loop.push(found(canonical));
      loop.push(found(canonical));
      loop.push(found(bumped, {
        moduleAdvance: { commandId: item.advanceCommand, outcome: 'applied' },
        moduleMessage: pendingMessage,
      }));
      const applied = await engineFor(item).advance(ctx, openInput(item, item.recordId, planOf(item, 'stored')).key, {
        commandId: item.advanceCommand,
        expectedRevision: item.revision,
        from: item.stepA,
        to: item.stepB,
        actorNow: item.people.actorMdm,
        executor: { kind: 'person', mdmId: item.people.actorMdm },
      });
      assert.equal(applied.outcome, 'advanced');
      const appliedState: string | undefined = applied.moduleMessage?.state;
      assert.equal(appliedState === 'sent', false);
      assert.equal(appliedState, 'pending');

      for (const hit of loop.seen) assertHeaders(hit, item.project, item.org);
      assert.equal(loop.seen.some((hit) => !ALLOWED.has(hit.action)), false);
    }
  });
});

test('a new port does not keep the previous response, and a dropped person translation does not post', async () => {
  await withRelease(async () => {
    const item = CASES[0];
    const dir = mkdtempSync(join(tmpdir(), 'rt101-transport-fresh-'));
    tempDirs.push(dir);
    process.env.CBE_PROJECT_FILES_DIR = dir;
    writeCredential(item.project, item.org);
    const loop = await bindLoopback();
    const ctx = requestCtx();
    loop.push(absent());
    loop.push(found(taskOf(item, item.recordId, item.revision, 'pending'), { created: true }));
    await engineFor(item).open(ctx, openInput(item, item.recordId, planOf(item, 'stored')));
    loop.push(absent());
    const again = await engineFor(item).find(ctx, openInput(item, item.recordId, planOf(item, 'stored')).key);
    assert.equal(again, null);
    assert.equal(loop.seen.at(-1)?.action, 'getModuleTask');

    const postsBefore = loop.seen.filter((hit) => hit.action === 'openModuleTask').length;
    const broken: MessagesWorkflowIdentities = {
      async toCmUserId(_ctx, mdmId) {
        if (mdmId === item.people.ownerMdm) throw new AppError('IDENTITY_NOT_FOUND', 'owner omitted', 404);
        return testIdentities(item.people).toCmUserId(_ctx, mdmId);
      },
      toMdmId: (_ctx, userId) => testIdentities(item.people).toMdmId(_ctx, userId),
    };
    // Documented stand-in for a reverted codec edit that skips owner translation:
    // the call fails closed and the raw MDM id is not posted.
    const brokenEngine = createWorkflowEngine(createMessagesTaskOccurrencePort({
      projectId: item.project,
      moduleId: item.module,
      asUserId: AS_USER,
      identities: broken,
    }));
    loop.push(absent());
    await assert.rejects(
      () => brokenEngine.open(ctx, openInput(item, item.otherRecordId, planOf(item, 'templateB'))),
      (error: unknown) => error instanceof AppError && error.code === 'IDENTITY_NOT_FOUND' && error.message.includes(TOKEN_FILE) === false,
    );
    assert.equal(loop.seen.filter((hit) => hit.action === 'openModuleTask').length, postsBefore);
    assert.equal(JSON.stringify(loop.seen).includes(item.people.ownerMdm), false);
  });
});
