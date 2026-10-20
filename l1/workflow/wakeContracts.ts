/// <mls fileReference="_102034_/l1/workflow/wakeContracts.ts" enhancement="_blank"/>
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { ModuleWakeEvent, ModuleWakeReceipt, TaskModuleRef } from '/_102036_/l2/shared/interfaces.js';
import type { TaskOccurrenceSnapshot } from '/_102034_/l1/workflow/contracts.js';

export type { ModuleWakeEvent, ModuleWakeReceipt, TaskModuleRef };

/** 32 KiB. The route checks the raw body as well. */
export const WORKFLOW_WAKE_BODY_LIMIT_BYTES = 32 * 1024;

export interface WorkflowWakeScope {
  projectId: string;
  moduleId: string;
  processId: string;
  routine: string;
}

export type WorkflowWakeHandler = (
  ctx: RequestContext,
  event: ModuleWakeEvent,
  occurrence: TaskOccurrenceSnapshot,
) => Promise<void>;

/** Command id of one firing. The next period uses another eventId, so another command. */
export function workflowWakeCommandId(eventId: string): string {
  return `wake:${eventId}`;
}

/**
 * Fields that stay the same across retries of one firing.
 * attempt and revision are observations and are not part of this identity.
 * workflowVersion travels inside ref; it is not an occurrence key.
 */
export interface WorkflowWakeStableIdentity {
  eventId: string;
  scheduledAt: string;
  ref: TaskModuleRef;
  taskId: string;
  stepKey: string;
  pass: number;
  seq: number;
  routine: string;
}

export type WorkflowWakeDispatchResult =
  | 'accepted'
  | 'stale'
  | { retry: { code: string } };

export type WorkflowWakeRunNextResult = 'empty' | 'busy' | 'accepted' | 'stale' | 'retry';

export interface WorkflowWakeEnqueueResult {
  receipt: ModuleWakeReceipt;
  statusCode: 200 | 202;
}

/**
 * Durable inbox. These methods take no human token or session.
 * A thrown dispatch error is a retry. Construction options, when a later
 * store adds them, are server test seams: production has no memory endpoint or flag.
 * enqueue returns only after commit.
 */
export interface WorkflowWakeInbox {
  enqueue(event: ModuleWakeEvent): Promise<WorkflowWakeEnqueueResult>;
  runNext(
    projectId: string,
    dispatch: (event: ModuleWakeEvent) => Promise<WorkflowWakeDispatchResult>,
  ): Promise<WorkflowWakeRunNextResult>;
}

const UTC_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
const CANONICAL_PROJECT = /^(0|[1-9][0-9]*)$/;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;

function invalid(message: string, statusCode = 400, code = 'WORKFLOW_WAKE_EVENT_INVALID'): never {
  throw new AppError(code, message, statusCode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.length === 0) {
    invalid(`${field} must be a non-empty string`);
  }
  return value;
}

function positiveInteger(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    invalid(`${field} must be a safe positive integer`);
  }
  return value;
}

function scheduledAt(value: unknown): string {
  if (typeof value !== 'string' || !UTC_ISO.test(value)) {
    invalid('scheduledAt must be a UTC ISO timestamp');
  }
  const match = UTC_ISO.exec(value);
  if (!match) {
    invalid('scheduledAt must be a UTC ISO timestamp');
  }
  const [, year, month, day, hour, minute, second, fraction] = match;
  const millis = fraction ? fraction.padEnd(3, '0') : '000';
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${millis}Z`);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() + 1 !== Number(month)
    || parsed.getUTCDate() !== Number(day)
    || parsed.getUTCHours() !== Number(hour)
    || parsed.getUTCMinutes() !== Number(minute)
    || parsed.getUTCSeconds() !== Number(second)
  ) {
    invalid('scheduledAt must be a UTC ISO timestamp');
  }
  return value;
}

function wakeRef(value: unknown): TaskModuleRef {
  if (!isRecord(value)) {
    invalid('ref must be an object');
  }
  const project = requiredString(value, 'project');
  if (!CANONICAL_PROJECT.test(project)) {
    invalid('project must be a canonical decimal');
  }
  const workflowVersion = value.workflowVersion;
  if (workflowVersion !== null && (typeof workflowVersion !== 'string' || workflowVersion.length === 0)) {
    invalid('workflowVersion must be a non-empty string or null');
  }
  return {
    project,
    module: requiredString(value, 'module'),
    entity: requiredString(value, 'entity'),
    recordId: requiredString(value, 'recordId'),
    processId: requiredString(value, 'processId'),
    workflowVersion,
  };
}

export function workflowWakeBodyBytes(body: unknown): number {
  if (typeof body === 'string') {
    return Buffer.byteLength(body, 'utf8');
  }
  return Buffer.byteLength(JSON.stringify(body), 'utf8');
}

export function assertWorkflowWakeBodyLimit(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    invalid('body size is not a byte length');
  }
  if (byteLength > WORKFLOW_WAKE_BODY_LIMIT_BYTES) {
    invalid('wake body exceeds 32 KiB', 413, 'WORKFLOW_WAKE_BODY_TOO_LARGE');
  }
}

/** Wire copy only. Arbitrary body fields are dropped. */
export function parseWorkflowWakeEvent(body: unknown, byteLength?: number): ModuleWakeEvent {
  assertWorkflowWakeBodyLimit(byteLength ?? workflowWakeBodyBytes(body));
  if (!isRecord(body)) {
    invalid('wake body must be an object');
  }
  const taskId = requiredString(body, 'taskId');
  const stepKey = requiredString(body, 'stepKey');
  const seq = positiveInteger(body, 'seq');
  const eventId = requiredString(body, 'eventId');
  const prefix = `${taskId}:${stepKey}:${seq}:`;
  if (!eventId.startsWith(prefix)) {
    invalid('eventId must start with taskId:stepKey:seq:');
  }
  const suffix = eventId.slice(prefix.length);
  if (!POSITIVE_DECIMAL.test(suffix)) {
    invalid('eventId suffix must be a positive integer');
  }
  const suffixNumber = Number(suffix);
  if (!Number.isSafeInteger(suffixNumber)) {
    invalid('eventId suffix must be a safe positive integer');
  }
  const event: ModuleWakeEvent = {
    eventId,
    scheduledAt: scheduledAt(body.scheduledAt),
    attempt: positiveInteger(body, 'attempt'),
    ref: wakeRef(body.ref),
    taskId,
    stepKey,
    pass: positiveInteger(body, 'pass'),
    seq,
    revision: positiveInteger(body, 'revision'),
    routine: requiredString(body, 'routine'),
  };
  return event;
}

export function workflowWakeStableIdentity(event: ModuleWakeEvent): WorkflowWakeStableIdentity {
  return {
    eventId: event.eventId,
    scheduledAt: event.scheduledAt,
    ref: {
      project: event.ref.project,
      module: event.ref.module,
      entity: event.ref.entity,
      recordId: event.ref.recordId,
      processId: event.ref.processId,
      workflowVersion: event.ref.workflowVersion,
    },
    taskId: event.taskId,
    stepKey: event.stepKey,
    pass: event.pass,
    seq: event.seq,
    routine: event.routine,
  };
}

export function sameWorkflowWakeIdentity(left: ModuleWakeEvent, right: ModuleWakeEvent): boolean {
  const a = workflowWakeStableIdentity(left);
  const b = workflowWakeStableIdentity(right);
  return a.eventId === b.eventId
    && a.scheduledAt === b.scheduledAt
    && a.taskId === b.taskId
    && a.stepKey === b.stepKey
    && a.pass === b.pass
    && a.seq === b.seq
    && a.routine === b.routine
    && a.ref.project === b.ref.project
    && a.ref.module === b.ref.module
    && a.ref.entity === b.ref.entity
    && a.ref.recordId === b.ref.recordId
    && a.ref.processId === b.ref.processId
    && a.ref.workflowVersion === b.ref.workflowVersion;
}
