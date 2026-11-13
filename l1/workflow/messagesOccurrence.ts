/// <mls fileReference="_102034_/l1/workflow/messagesOccurrence.ts" enhancement="_blank"/>
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  createServerMessagesClient,
  type MessagesCallResult,
  type ServerMessagesClient,
} from '/_102034_/l1/server/layer_1_external/collabMessages/client.js';
import type {
  AgentIntentModuleAdvance,
  TaskData,
} from '/_102036_/l2/shared/interfaces.js';
import type {
  OccurrenceKey,
  TaskOccurrenceAdvanceCommand,
  TaskLlmStepRefusal,
  TaskOccurrenceAdvanceResult,
  TaskOccurrenceLlmCommand,
  TaskOccurrenceLlmPort,
  TaskOccurrenceLlmResult,
  TaskOccurrenceOpenCommand,
  TaskOccurrenceOpenResult,
  TaskOccurrenceSnapshot,
  WorkflowExecutor,
} from '/_102034_/l1/workflow/contracts.js';
import {
  decodeTaskSnapshot,
  encodeOpenModuleTask,
  groupedCmIdentities,
  projectMessage,
  toCm,
  type MessagesWorkflowIdentities,
} from '/_102034_/l1/workflow/messagesTask.js';

type TaskClient = Pick<ServerMessagesClient, 'openModuleTask' | 'getModuleTask' | 'advanceModuleTask'>
  & Partial<Pick<ServerMessagesClient, 'requestModuleLlmStep'>>;

export interface MessagesTaskOccurrencePortOptions {
  projectId: string;
  moduleId: string;
  asUserId: string;
  identities: MessagesWorkflowIdentities;
  client?: TaskClient;
}

const PROTOCOL = 'Module task payload is not valid.';
const REJECTED = 'Module task was rejected.';
const BUSY = 'Module task is busy.';
const INCOMPLETE = 'Module task is incomplete.';
const ROOM_UNAVAILABLE = 'Module task room is unavailable.';
const REMOTE_STATUS = new Set([400, 401, 403, 404, 409, 422, 507]);

function protocol(): never {
  throw new AppError('WORKFLOW_CM_PROTOCOL_ERROR', PROTOCOL, 502);
}

function rejected(statusCode: number): never {
  throw new AppError('WORKFLOW_CM_REJECTED', REJECTED, statusCode);
}

function busy(): never {
  throw new AppError('WORKFLOW_CM_BUSY', BUSY, 503);
}

function incomplete(): never {
  throw new AppError('WORKFLOW_CM_TASK_INCOMPLETE', INCOMPLETE, 503);
}

function roomUnavailable(): never {
  throw new AppError('WORKFLOW_CM_ROOM_UNAVAILABLE', ROOM_UNAVAILABLE, 503);
}

function mismatch(): never {
  throw new AppError('WORKFLOW_TASK_MISMATCH', 'Module task does not match the command.', 409);
}

function boundId(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new AppError('MSG_APP_NOT_CONFIGURED', 'Messages integration is not configured for this application.', 503);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type EnvelopeBody = {
  statusCode: number;
  msg?: string;
  taskId?: unknown;
};

type EnvelopeVerdict =
  | { kind: 'absent' }
  | { kind: 'ok' }
  | { kind: 'busy' }
  | { kind: 'incomplete' }
  | { kind: 'rejected'; statusCode: number }
  | { kind: 'stop'; msg: 'conflict' | 'paused' }
  | { kind: 'protocol' };

function validTaskId(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function readTaskId(body: object): unknown {
  if (!('taskId' in body)) return undefined;
  const value = (body as { taskId?: unknown }).taskId;
  return value;
}

function classifyEnvelope(httpStatus: number, body: EnvelopeBody): EnvelopeVerdict {
  const statusCode = body.statusCode;
  if (typeof httpStatus !== 'number' || typeof statusCode !== 'number') return { kind: 'protocol' };
  const httpOk = httpStatus === 200;
  if (!httpOk && (statusCode === 200 || httpStatus !== statusCode)) return { kind: 'protocol' };
  if ((httpOk || httpStatus === 404) && statusCode === 404 && body.msg === 'not_found') return { kind: 'absent' };
  if (statusCode === 409 && (body.msg === 'conflict' || body.msg === 'paused')) return { kind: 'stop', msg: body.msg };
  if (statusCode === 503 && body.msg === 'busy') return { kind: 'busy' };
  if (statusCode === 503 && body.msg === 'module_task_incomplete') {
    return validTaskId(body.taskId) ? { kind: 'incomplete' } : { kind: 'protocol' };
  }
  if (httpOk && statusCode === 200) return { kind: 'ok' };
  if (REMOTE_STATUS.has(statusCode)) return { kind: 'rejected', statusCode };
  return { kind: 'protocol' };
}

function readRoomIssue(body: object): unknown {
  if (!('roomIssue' in body)) return undefined;
  return (body as { roomIssue?: unknown }).roomIssue;
}

function raiseEnvelope(verdict: Exclude<EnvelopeVerdict, { kind: 'ok' }>): never {
  if (verdict.kind === 'busy') busy();
  if (verdict.kind === 'incomplete') incomplete();
  if (verdict.kind === 'rejected' || verdict.kind === 'stop') rejected(verdict.kind === 'stop' ? 409 : verdict.statusCode);
  if (verdict.kind === 'absent') rejected(404);
  protocol();
}

function usableThread(task: TaskData, room: { threadId?: unknown } | null | undefined, roomIssue: unknown): string {
  if (room === null) {
    if (roomIssue === 'not_linked' || roomIssue === 'missing') roomUnavailable();
    protocol();
  }
  if (room === undefined || roomIssue !== undefined) protocol();
  const threadId = room.threadId;
  if (typeof threadId !== 'string' || threadId.length === 0 || threadId.trim() !== threadId) protocol();
  if (threadId !== task.taskRoom?.threadId) protocol();
  return threadId;
}

function sameRef(task: TaskData | undefined, key: OccurrenceKey): boolean {
  const ref = task?.module?.ref;
  if (ref === undefined) return false;
  return ref.project === key.project
    && ref.module === key.module
    && ref.entity === key.entity
    && ref.recordId === key.recordId
    && ref.processId === key.processId;
}

async function encodeExecutor(
  ctx: RequestContext,
  identities: MessagesWorkflowIdentities,
  executor: WorkflowExecutor,
): Promise<AgentIntentModuleAdvance['executor']> {
  if (executor.kind === 'routine') return { kind: 'routine', name: executor.name };
  return { kind: 'person', userId: await toCm(ctx, identities, executor.mdmId) };
}

const LLM_REFUSALS: Readonly<Record<TaskLlmStepRefusal, { code: string; message: string }>> = {
  paused: { code: 'WORKFLOW_LLM_PAUSED', message: 'The task is paused; the LLM step was not requested.' },
  llm_step_not_current: { code: 'WORKFLOW_LLM_STEP_NOT_CURRENT', message: 'The step is not the current LLM step.' },
  llm_pass_limit: { code: 'WORKFLOW_LLM_PASS_LIMIT', message: 'The LLM step passed its limit of passes; the task was paused.' },
  task_too_large: { code: 'WORKFLOW_LLM_TASK_TOO_LARGE', message: 'The task would grow beyond the size limit.' },
};

/** A refusal of the LLM step by its own code (`msg`); anything else goes through the generic envelope rules. */
function llmRefusal(msg: unknown): { code: string; message: string } | undefined {
  return typeof msg === 'string' && Object.prototype.hasOwnProperty.call(LLM_REFUSALS, msg)
    ? LLM_REFUSALS[msg as TaskLlmStepRefusal]
    : undefined;
}

function readLlmResult(body: { state?: unknown; result?: unknown; failure?: unknown; cost?: unknown }): TaskOccurrenceLlmResult {
  const state = body.state;
  if (state !== 'pending' && state !== 'in_progress' && state !== 'completed' && state !== 'failed') protocol();
  const out: TaskOccurrenceLlmResult = { state };
  if (body.result !== undefined) {
    if (typeof body.result !== 'string') protocol();
    out.result = body.result;
  }
  if (body.failure !== undefined) {
    if (!isRecord(body.failure) || typeof body.failure.code !== 'string' || typeof body.failure.message !== 'string') protocol();
    out.failure = { code: body.failure.code, message: body.failure.message };
  }
  if (body.cost !== undefined) {
    if (typeof body.cost !== 'number' || !Number.isFinite(body.cost)) protocol();
    out.cost = body.cost;
  }
  if (state === 'completed' && out.result === undefined) protocol();
  if (state === 'failed' && out.failure === undefined) protocol();
  return out;
}

export function createMessagesTaskOccurrencePort(options: MessagesTaskOccurrencePortOptions): TaskOccurrenceLlmPort {
  const projectId = boundId(options.projectId);
  const moduleId = boundId(options.moduleId);
  const asUserId = boundId(options.asUserId);
  const identities = options.identities;
  const client = options.client ?? createServerMessagesClient({ projectId });

  function inScope(key: OccurrenceKey): void {
    if (key.project !== projectId || key.module !== moduleId) {
      throw new AppError('MSG_APP_SCOPE_INVALID', 'Module operation is outside the configured application.', 400);
    }
  }

  async function read(ctx: RequestContext, key: OccurrenceKey): Promise<TaskOccurrenceSnapshot | null> {
    const result = await client.getModuleTask(asUserId, {
      ref: {
        project: key.project,
        module: key.module,
        entity: key.entity,
        recordId: key.recordId,
        processId: key.processId,
      },
    });
    const verdict = classifyEnvelope(result.httpStatus, { statusCode: result.body.statusCode, msg: result.body.msg, taskId: readTaskId(result.body) });
    if (verdict.kind === 'absent') return null;
    if (verdict.kind !== 'ok') raiseEnvelope(verdict);
    if (result.body.task === undefined) protocol();
    const threadId = usableThread(result.body.task, result.body.room, readRoomIssue(result.body));
    return decodeTaskSnapshot(ctx, identities, result.body.task, key, threadId);
  }

  async function view(
    ctx: RequestContext,
    key: OccurrenceKey,
    task: TaskData,
    roomThreadId?: string,
  ): Promise<TaskOccurrenceSnapshot> {
    const snapshot = await decodeTaskSnapshot(ctx, identities, task, key, roomThreadId);
    if (snapshot.taskId !== task.PK || snapshot.ref.project !== key.project || snapshot.ref.module !== key.module) protocol();
    return snapshot;
  }

  return {
    kind: 'task',
    async find(ctx, key) {
      inScope(key);
      return read(ctx, key);
    },
    async open(ctx, command) {
      inScope(command.ref);
      const encoded = await encodeOpenModuleTask(ctx, identities, command);
      const { action: _action, ...input } = encoded;
      const result = await client.openModuleTask(asUserId, input);
      const verdict = classifyEnvelope(result.httpStatus, { statusCode: result.body.statusCode, msg: result.body.msg, taskId: readTaskId(result.body) });
      if (verdict.kind !== 'ok') raiseEnvelope(verdict);
      if (typeof result.body.created !== 'boolean' || result.body.task === undefined) protocol();
      const threadId = usableThread(result.body.task, result.body.room, readRoomIssue(result.body));
      const occurrence = await view(ctx, command.ref, result.body.task, threadId);
      const outcome = result.body.created ? 'created' : 'existing';
      const returned = projectMessage(result.body.moduleMessage);
      const opening = occurrence.history.find((entry) => entry.from === null)?.message;
      const moduleMessage = returned ?? (outcome === 'existing' ? opening : undefined);
      const opened: TaskOccurrenceOpenResult = { outcome, occurrence };
      if (moduleMessage !== undefined) opened.moduleMessage = moduleMessage;
      return opened;
    },
    async advance(ctx, key, command) {
      inScope(key);
      const current = await client.getModuleTask(asUserId, {
        ref: {
          project: key.project,
          module: key.module,
          entity: key.entity,
          recordId: key.recordId,
          processId: key.processId,
        },
      });
      const verdict = classifyEnvelope(current.httpStatus, { statusCode: current.body.statusCode, msg: current.body.msg, taskId: readTaskId(current.body) });
      if (verdict.kind === 'absent') mismatch();
      if (verdict.kind !== 'ok') raiseEnvelope(verdict);
      const currentTask = current.body.task;
      if (currentTask === undefined || !sameRef(currentTask, key)) protocol();
      if (currentTask.PK !== command.taskId) mismatch();
      usableThread(currentTask, current.body.room, readRoomIssue(current.body));
      // The people of the command, in the order they are translated below, in one grouped call.
      const people = await groupedCmIdentities(ctx, identities, [
        command.actorNow,
        command.executor.kind === 'person' ? command.executor.mdmId : undefined,
      ]);
      const intent: AgentIntentModuleAdvance = {
        type: 'module-advance',
        taskId: command.taskId,
        commandId: command.commandId,
        expectedRevision: command.expectedRevision,
        from: command.from,
        to: command.to,
        actorNow: command.actorNow === null ? null : await toCm(ctx, people, command.actorNow),
        done: command.done,
        executor: await encodeExecutor(ctx, people, command.executor),
      };
      if (command.note !== undefined) intent.note = command.note;
      // Beside `note`, never inside `executor`, and only when the person is the executor: the cm refuses `via` otherwise.
      if (ctx.sessionContext?.via === 'nora' && command.executor.kind === 'person') intent.via = 'nora';
      if (command.wake !== undefined) intent.wake = { ...command.wake };
      if (command.message !== undefined) intent.message = { content: command.message.content };
      const result = await client.advanceModuleTask(asUserId, intent);
      return finishAdvance(ctx, identities, key, command, result);
    },
    async requestLlmStep(_ctx, key, command): Promise<TaskOccurrenceLlmResult> {
      inScope(key);
      if (client.requestModuleLlmStep === undefined) {
        throw new AppError('WORKFLOW_LLM_UNSUPPORTED', 'This messages client cannot ask an LLM step.', 501);
      }
      const result = await client.requestModuleLlmStep(asUserId, {
        ref: {
          project: key.project,
          module: key.module,
          entity: key.entity,
          recordId: key.recordId,
          processId: key.processId,
          // The request names the occurrence like the reads do; the version of the plan is not part of finding it.
          workflowVersion: null,
        },
        commandId: command.commandId,
        stepKey: command.stepKey,
        input: command.input,
        maxPasses: command.maxPasses,
        ...(command.tools === undefined ? {} : { tools: command.tools }),
      });
      const refusal = llmRefusal(result.body.msg);
      // Like the other module actions the envelope may travel with http 200 (statusCode in the body) or with the same http status.
      if (refusal !== undefined && REMOTE_STATUS.has(result.body.statusCode) && (result.httpStatus === result.body.statusCode || result.httpStatus === 200)) {
        throw new AppError(refusal.code, refusal.message, result.body.statusCode);
      }
      const verdict = classifyEnvelope(result.httpStatus, { statusCode: result.body.statusCode, msg: result.body.msg, taskId: readTaskId(result.body) });
      if (verdict.kind !== 'ok') raiseEnvelope(verdict);
      return readLlmResult(result.body);
    },
  };
}

async function finishAdvance(
  ctx: RequestContext,
  identities: MessagesWorkflowIdentities,
  key: OccurrenceKey,
  command: TaskOccurrenceAdvanceCommand,
  result: MessagesCallResult<{ task?: TaskData; moduleAdvance?: { commandId: string; outcome: 'applied' | 'unchanged' }; moduleMessage?: unknown }>,
): Promise<TaskOccurrenceAdvanceResult> {
  const body = result.body;
  const verdict = classifyEnvelope(result.httpStatus, { statusCode: body.statusCode, msg: body.msg, taskId: readTaskId(body) });
  if (verdict.kind === 'stop') {
    if (body.task === undefined || !sameRef(body.task, key) || body.task.PK !== command.taskId) protocol();
    return pack(ctx, identities, key, command, verdict.msg === 'paused' ? 'paused' : 'conflict', body.task, body.moduleMessage);
  }
  if (verdict.kind !== 'ok') raiseEnvelope(verdict);
  const advance = body.moduleAdvance;
  if (advance === undefined || advance.commandId !== command.commandId) protocol();
  if (advance.outcome !== 'applied' && advance.outcome !== 'unchanged') protocol();
  if (body.task === undefined || !sameRef(body.task, key) || body.task.PK !== command.taskId) protocol();
  return pack(
    ctx,
    identities,
    key,
    command,
    advance.outcome === 'applied' ? 'advanced' : 'unchanged',
    body.task,
    body.moduleMessage,
  );
}

async function pack(
  ctx: RequestContext,
  identities: MessagesWorkflowIdentities,
  key: OccurrenceKey,
  command: TaskOccurrenceAdvanceCommand,
  outcome: TaskOccurrenceAdvanceResult['outcome'],
  task: TaskData,
  moduleMessage: unknown,
): Promise<TaskOccurrenceAdvanceResult> {
  const occurrence = await decodeTaskSnapshot(ctx, identities, task, key, task.taskRoom?.threadId);
  if (occurrence.taskId !== command.taskId) protocol();
  const returned = projectMessage(moduleMessage);
  const recorded = occurrence.history.find((entry) => entry.commandId === command.commandId)?.message;
  const message = returned ?? recorded;
  const packed: TaskOccurrenceAdvanceResult = { outcome, occurrence };
  if (message !== undefined) packed.moduleMessage = message;
  return packed;
}
