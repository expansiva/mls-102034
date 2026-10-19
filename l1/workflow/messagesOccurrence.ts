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
  TaskOccurrenceAdvanceResult,
  TaskOccurrenceOpenCommand,
  TaskOccurrenceOpenResult,
  TaskOccurrencePort,
  TaskOccurrenceSnapshot,
  WorkflowExecutor,
} from '/_102034_/l1/workflow/contracts.js';
import {
  decodeTaskSnapshot,
  encodeOpenModuleTask,
  projectMessage,
  toCm,
  type MessagesWorkflowIdentities,
} from '/_102034_/l1/workflow/messagesTask.js';

type TaskClient = Pick<ServerMessagesClient, 'openModuleTask' | 'getModuleTask' | 'advanceModuleTask'>;

export interface MessagesTaskOccurrencePortOptions {
  projectId: string;
  moduleId: string;
  asUserId: string;
  identities: MessagesWorkflowIdentities;
  client?: TaskClient;
}

const PROTOCOL = 'Module task payload is not valid.';

function protocol(): never {
  throw new AppError('WORKFLOW_CM_PROTOCOL_ERROR', PROTOCOL, 502);
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

function confirmedAbsent(httpStatus: number, statusCode: number, msg: string | undefined): boolean {
  return (httpStatus === 200 || httpStatus === 404) && statusCode === 404 && msg === 'not_found';
}

function accepted(httpStatus: number, statusCode: number): boolean {
  return httpStatus === 200 && statusCode === 200;
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

export function createMessagesTaskOccurrencePort(options: MessagesTaskOccurrencePortOptions): TaskOccurrencePort {
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
    if (confirmedAbsent(result.httpStatus, result.body.statusCode, result.body.msg)) return null;
    if (!accepted(result.httpStatus, result.body.statusCode) || result.body.task === undefined) protocol();
    return decodeTaskSnapshot(ctx, identities, result.body.task, key, result.body.room?.threadId);
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
      if (!accepted(result.httpStatus, result.body.statusCode) || typeof result.body.created !== 'boolean' || result.body.task === undefined) {
        protocol();
      }
      const occurrence = await view(ctx, command.ref, result.body.task, result.body.room?.threadId);
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
      if (confirmedAbsent(current.httpStatus, current.body.statusCode, current.body.msg)) mismatch();
      if (!accepted(current.httpStatus, current.body.statusCode) || !sameRef(current.body.task, key)) protocol();
      if (current.body.task?.PK !== command.taskId) mismatch();
      const intent: AgentIntentModuleAdvance = {
        type: 'module-advance',
        taskId: command.taskId,
        commandId: command.commandId,
        expectedRevision: command.expectedRevision,
        from: command.from,
        to: command.to,
        actorNow: command.actorNow === null ? null : await toCm(ctx, identities, command.actorNow),
        done: command.done,
        executor: await encodeExecutor(ctx, identities, command.executor),
      };
      if (command.note !== undefined) intent.note = command.note;
      if (command.wake !== undefined) intent.wake = { ...command.wake };
      if (command.message !== undefined) intent.message = { content: command.message.content };
      const result = await client.advanceModuleTask(asUserId, intent);
      return finishAdvance(ctx, identities, key, command, result);
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
  const stop = body.msg === 'conflict' || body.msg === 'paused';
  const signaled409 = result.httpStatus === 409 || body.statusCode === 409;
  if (signaled409 && stop) {
    if (body.task === undefined || !sameRef(body.task, key) || body.task.PK !== command.taskId) protocol();
    return pack(ctx, identities, key, command, body.msg === 'paused' ? 'paused' : 'conflict', body.task, body.moduleMessage);
  }
  if (signaled409 || !accepted(result.httpStatus, body.statusCode)) protocol();
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
