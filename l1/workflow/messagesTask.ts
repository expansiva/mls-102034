/// <mls fileReference="_102034_/l1/workflow/messagesTask.ts" enhancement="_blank"/>
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type {
  AIModuleStep,
  AIPayload,
  ModulePlan,
  ModulePlanStep,
  RequestOpenModuleTask,
  TaskData,
  TaskModuleHistoryEntry,
} from '/_102036_/l2/shared/interfaces.js';
import type {
  OccurrenceKey,
  TaskOccurrenceHistoryEntry,
  TaskOccurrenceMessageStatus,
  TaskOccurrenceOpenCommand,
  TaskOccurrenceSnapshot,
  WorkflowExecutor,
  WorkflowOrigin,
  WorkflowRoomChoice,
} from '/_102034_/l1/workflow/contracts.js';
import { ownerOf, prepareWorkflowPlan, type WorkflowPlanStepInput } from '/_102034_/l1/workflow/plan.js';

/** Server-bound MDM ↔ CM user translation. This codec has no default. */
export interface MessagesWorkflowIdentities {
  toCmUserId(ctx: RequestContext, mdmId: string): Promise<string>;
  toMdmId(ctx: RequestContext, userId: string): Promise<string>;
}

const PROTOCOL = 'Module task payload is not valid.';

function protocol(): never {
  throw new AppError('WORKFLOW_CM_PROTOCOL_ERROR', PROTOCOL, 502);
}

function rethrowIdentity(error: unknown): never {
  if (error instanceof AppError) {
    throw new AppError(error.code, 'Identity could not be resolved.', error.statusCode);
  }
  protocol();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) return undefined;
  return value;
}

function requiredText(value: unknown): string {
  const parsed = text(value);
  if (parsed === undefined) protocol();
  return parsed;
}

async function toCm(ctx: RequestContext, identities: MessagesWorkflowIdentities, mdmId: string): Promise<string> {
  try {
    return requiredText(await identities.toCmUserId(ctx, mdmId));
  } catch (error) {
    rethrowIdentity(error);
  }
}

async function toMdm(ctx: RequestContext, identities: MessagesWorkflowIdentities, userId: string): Promise<string> {
  try {
    return requiredText(await identities.toMdmId(ctx, userId));
  } catch (error) {
    rethrowIdentity(error);
  }
}

function isModuleStep(step: AIPayload): step is AIModuleStep {
  return isRecord(step) && step.type === 'module';
}

function copyParams(params: Record<string, string> | undefined): Record<string, string> | undefined {
  if (params === undefined) return undefined;
  if (!isRecord(params)) protocol();
  const copy: Record<string, string> = {};
  for (const [name, value] of Object.entries(params)) {
    if (typeof value !== 'string') protocol();
    copy[name] = value;
  }
  return copy;
}

function wirePlanStep(step: {
  stepId: string;
  kind: ModulePlanStep['kind'];
  ownerKind: ModulePlanStep['ownerKind'];
  title: string;
  next: string[];
  actorRef?: string;
  journeyRef?: string;
  functionRef?: string;
  conditions?: string;
  params?: Record<string, string>;
}): ModulePlanStep {
  if (step.ownerKind !== ownerOf(step.kind)) protocol();
  const encoded: ModulePlanStep = {
    key: step.stepId,
    kind: step.kind,
    ownerKind: step.ownerKind,
    title: step.title,
    next: [...step.next],
  };
  if (step.actorRef !== undefined) encoded.actorRef = step.actorRef;
  if (step.journeyRef !== undefined) encoded.journeyRef = step.journeyRef;
  if (step.functionRef !== undefined) encoded.functionRef = step.functionRef;
  if (step.conditions !== undefined) encoded.conditions = step.conditions;
  if (step.params !== undefined) encoded.params = { ...step.params };
  return encoded;
}

/** Opening payload. Plan refs stay refs. Person ids go through the resolver. */
export async function encodeOpenModuleTask(
  ctx: RequestContext,
  identities: MessagesWorkflowIdentities,
  command: TaskOccurrenceOpenCommand,
): Promise<RequestOpenModuleTask> {
  const planSteps = command.plan.steps.map((step) => wirePlanStep(step));
  if (!planSteps.some((step) => step.key === command.firstStep)) protocol();
  const plan: ModulePlan = {
    processId: command.plan.processId,
    title: command.plan.title,
    moduleTitle: command.plan.moduleTitle,
    steps: planSteps,
  };
  const origin: WorkflowOrigin = { kind: command.origin.kind };
  if (command.origin.by !== undefined) origin.by = await toCm(ctx, identities, requiredText(command.origin.by));
  if (command.origin.config !== undefined) origin.config = command.origin.config;
  const room: WorkflowRoomChoice = { mode: command.room.mode };
  if (command.room.groupKey !== undefined) room.groupKey = command.room.groupKey;
  if (command.room.members !== undefined) {
    room.members = [];
    for (const member of command.room.members) room.members.push(await toCm(ctx, identities, requiredText(member)));
  }
  const executor = await encodeExecutor(ctx, identities, command.executor);
  const encoded: RequestOpenModuleTask = {
    action: 'openModuleTask',
    ref: {
      project: command.ref.project,
      module: command.ref.module,
      entity: command.ref.entity,
      recordId: command.ref.recordId,
      processId: command.ref.processId,
      workflowVersion: command.ref.workflowVersion,
    },
    plan,
    startStep: command.firstStep,
    origin,
    owner: await toCm(ctx, identities, requiredText(command.owner)),
    actorNow: command.actorNow === null ? null : await toCm(ctx, identities, requiredText(command.actorNow)),
    title: command.title,
    room,
    executor,
  };
  if (command.message !== undefined) encoded.message = { content: command.message.content };
  return encoded;
}

async function encodeExecutor(
  ctx: RequestContext,
  identities: MessagesWorkflowIdentities,
  executor: WorkflowExecutor,
): Promise<RequestOpenModuleTask['executor']> {
  if (executor.kind === 'routine') return { kind: 'routine', name: executor.name };
  return { kind: 'person', userId: await toCm(ctx, identities, requiredText(executor.mdmId)) };
}

function sameKey(ref: TaskData['module'], expected: OccurrenceKey): boolean {
  if (ref === undefined) return false;
  return ref.ref.project === expected.project
    && ref.ref.module === expected.module
    && ref.ref.entity === expected.entity
    && ref.ref.recordId === expected.recordId
    && ref.ref.processId === expected.processId;
}

function readWake(value: unknown): TaskOccurrenceSnapshot['wake'] {
  if (!isRecord(value)) protocol();
  const routine = requiredText(value.routine);
  const nextAt = requiredText(value.nextAt);
  if (typeof value.everyMinutes !== 'number' || typeof value.seq !== 'number') protocol();
  const wake: NonNullable<TaskOccurrenceSnapshot['wake']> = {
    everyMinutes: value.everyMinutes,
    routine,
    nextAt,
    seq: value.seq,
  };
  if (value.until !== undefined) wake.until = requiredText(value.until);
  return wake;
}

function projectMessage(message: TaskModuleHistoryEntry['message']): TaskOccurrenceMessageStatus | undefined {
  if (message === undefined) return undefined;
  if (message.state !== 'pending' && message.state !== 'sent') protocol();
  const projected: TaskOccurrenceMessageStatus = {
    state: message.state,
    threadId: requiredText(message.threadId),
  };
  if (message.orderAt !== undefined) projected.orderAt = requiredText(message.orderAt);
  return projected;
}

async function decodeHistory(
  ctx: RequestContext,
  identities: MessagesWorkflowIdentities,
  history: TaskModuleHistoryEntry[],
): Promise<TaskOccurrenceHistoryEntry[]> {
  if (!Array.isArray(history)) protocol();
  const decoded: TaskOccurrenceHistoryEntry[] = [];
  for (const entry of history) {
    if (!isRecord(entry) || typeof entry.done !== 'boolean') protocol();
    const executor = await decodeExecutor(ctx, identities, entry.executor);
    const item: TaskOccurrenceHistoryEntry = {
      at: requiredText(entry.at),
      commandId: requiredText(entry.commandId),
      executor,
      from: entry.from === null ? null : requiredText(entry.from),
      step: requiredText(entry.step),
      actorNow: entry.actorNow === null ? null : await toMdm(ctx, identities, requiredText(entry.actorNow)),
      done: entry.done,
      by: executor.kind === 'person' ? executor.mdmId : null,
    };
    if (entry.note !== undefined) item.note = requiredText(entry.note);
    const message = projectMessage(entry.message);
    if (message !== undefined) item.message = message;
    decoded.push(item);
  }
  return decoded;
}

async function decodeExecutor(
  ctx: RequestContext,
  identities: MessagesWorkflowIdentities,
  executor: TaskModuleHistoryEntry['executor'],
): Promise<WorkflowExecutor> {
  if (!isRecord(executor)) protocol();
  if (executor.kind === 'routine') return { kind: 'routine', name: requiredText(executor.name) };
  if (executor.kind !== 'person') protocol();
  return { kind: 'person', mdmId: await toMdm(ctx, identities, requiredText(executor.userId)) };
}

function childInput(child: AIModuleStep, processId: string): WorkflowPlanStepInput {
  const key = requiredText(child.module?.key);
  const title = requiredText(child.stepTitle);
  if (!Array.isArray(child.module.next)) protocol();
  if (child.module.kind !== 'human' && child.module.kind !== 'mechanical' && child.module.kind !== 'llm'
    && child.module.kind !== 'wait' && child.module.kind !== 'alert') protocol();
  if (child.module.ownerKind !== ownerOf(child.module.kind)) protocol();
  const step: WorkflowPlanStepInput = {
    stepId: key,
    kind: child.module.kind,
    title,
    next: [...child.module.next],
  };
  if (child.module.actorRef !== undefined) step.actorRef = requiredText(child.module.actorRef);
  if (child.module.journeyRef !== undefined) step.journeyRef = requiredText(child.module.journeyRef);
  if (child.module.functionRef !== undefined) step.functionRef = requiredText(child.module.functionRef);
  if (child.module.conditions !== undefined) step.conditions = child.module.conditions;
  if (child.module.params !== undefined) step.params = copyParams(child.module.params);
  if (step.stepId === 'end' || processId === '') protocol();
  return step;
}

function actorOf(child: AIModuleStep, firstKey: string): string | null {
  const actor = child.module.actorNow;
  if (actor === undefined) {
    if (child.module.key === firstKey) return null;
    protocol();
  }
  if (actor === null) return null;
  return requiredText(actor);
}

/** Canonical task view. Does not keep CM user ids or message bodies. */
export async function decodeTaskSnapshot(
  ctx: RequestContext,
  identities: MessagesWorkflowIdentities,
  task: TaskData,
  expected: OccurrenceKey,
  roomThreadId?: string,
): Promise<TaskOccurrenceSnapshot> {
  const moduleMeta = task.module;
  if (moduleMeta === undefined || !sameKey(moduleMeta, expected)) protocol();
  const version = moduleMeta.ref.workflowVersion;
  if (version !== null && typeof version !== 'string') protocol();
  if (!Number.isInteger(moduleMeta.revision) || moduleMeta.revision <= 0) protocol();
  const roomId = requiredText(task.taskRoom?.threadId);
  if (roomThreadId !== undefined && roomThreadId !== roomId) protocol();
  const rootPayloads = task.iaCompressed?.nextSteps;
  if (!Array.isArray(rootPayloads) || rootPayloads.length !== 1 || !isModuleStep(rootPayloads[0])) protocol();
  const root = rootPayloads[0];
  if (root.module.key !== expected.processId) protocol();
  const children = root.nextSteps;
  if (!Array.isArray(children) || children.length === 0 || !children.every(isModuleStep)) protocol();
  const steps = children.map((child) => childInput(child, expected.processId));
  let plan;
  try {
    plan = prepareWorkflowPlan({
      processId: requiredText(root.module.key),
      title: requiredText(root.stepTitle),
      moduleTitle: requiredText(moduleMeta.moduleTitle),
      steps,
    });
  } catch (error) {
    if (error instanceof AppError) protocol();
    throw error;
  }
  const firstKey = steps[0].stepId;
  const title = requiredText(task.title);
  const owner = await toMdm(ctx, identities, requiredText(moduleMeta.owner));
  const origin = await decodeOrigin(ctx, identities, moduleMeta.origin);
  const room = await decodeRoom(ctx, identities, moduleMeta.room);
  const history = await decodeHistory(ctx, identities, moduleMeta.history);
  const progress = await readProgress(ctx, identities, task, root, children, firstKey, history);
  return {
    ref: {
      project: moduleMeta.ref.project,
      module: moduleMeta.ref.module,
      processId: moduleMeta.ref.processId,
      entity: moduleMeta.ref.entity,
      recordId: moduleMeta.ref.recordId,
      workflowVersion: version,
    },
    plan,
    title,
    taskId: requiredText(task.PK),
    revision: moduleMeta.revision,
    status: task.status,
    owner,
    origin,
    room,
    roomId,
    step: progress.step,
    actorNow: progress.actorNow,
    done: progress.done,
    pass: progress.pass,
    ...(progress.wake === undefined ? {} : { wake: progress.wake }),
    history,
  };
}

async function decodeOrigin(
  ctx: RequestContext,
  identities: MessagesWorkflowIdentities,
  origin: NonNullable<TaskData['module']>['origin'],
): Promise<WorkflowOrigin> {
  if (!isRecord(origin)) protocol();
  if (origin.kind !== 'screen' && origin.kind !== 'channel' && origin.kind !== 'schedule' && origin.kind !== 'event') {
    protocol();
  }
  const decoded: WorkflowOrigin = { kind: origin.kind };
  if (origin.by !== undefined) decoded.by = await toMdm(ctx, identities, requiredText(origin.by));
  if (origin.config !== undefined) decoded.config = requiredText(origin.config);
  return decoded;
}

async function decodeRoom(
  ctx: RequestContext,
  identities: MessagesWorkflowIdentities,
  room: NonNullable<TaskData['module']>['room'],
): Promise<WorkflowRoomChoice> {
  if (!isRecord(room)) protocol();
  if (room.mode !== 'exclusive' && room.mode !== 'person' && room.mode !== 'group') protocol();
  const decoded: WorkflowRoomChoice = { mode: room.mode };
  if (room.groupKey !== undefined) decoded.groupKey = requiredText(room.groupKey);
  if (room.members !== undefined) {
    if (!Array.isArray(room.members)) protocol();
    decoded.members = [];
    for (const member of room.members) decoded.members.push(await toMdm(ctx, identities, requiredText(member)));
  }
  return decoded;
}

async function readProgress(
  ctx: RequestContext,
  identities: MessagesWorkflowIdentities,
  task: TaskData,
  root: AIModuleStep,
  children: AIModuleStep[],
  firstKey: string,
  history: TaskOccurrenceHistoryEntry[],
): Promise<Pick<TaskOccurrenceSnapshot, 'step' | 'actorNow' | 'done' | 'pass' | 'wake'>> {
  if (task.status === 'done') {
    if (root.status !== 'completed') protocol();
    const last = history[history.length - 1];
    if (last === undefined || last.done !== true) protocol();
    const closed = children.find((child) => child.module.key === last.step);
    if (closed === undefined || closed.status !== 'completed') protocol();
    if (children.some((child) => child.status === 'in_progress' || child.module.wake !== undefined || child.module.key === 'end')) {
      protocol();
    }
    const actor = actorOf(closed, firstKey);
    return {
      step: 'end',
      done: true,
      actorNow: actor === null ? null : await toMdm(ctx, identities, actor),
      pass: passOf(closed),
    };
  }
  if (task.status !== 'todo' && task.status !== 'in progress' && task.status !== 'paused' && task.status !== 'failed') {
    protocol();
  }
  const current = children.filter((child) => child.status === 'in_progress');
  if (current.length !== 1 || root.status === 'completed') protocol();
  const step = current[0];
  const actor = actorOf(step, firstKey);
  return {
    step: step.module.key,
    done: false,
    actorNow: actor === null ? null : await toMdm(ctx, identities, actor),
    pass: passOf(step),
    ...(step.module.wake === undefined ? {} : { wake: readWake(step.module.wake) }),
  };
}

function passOf(child: AIModuleStep): number {
  if (!Number.isInteger(child.module.passes) || child.module.passes < 1) protocol();
  return child.module.passes;
}
