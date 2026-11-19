/// <mls fileReference="_102034_/l1/server/layer_1_external/events/publishModuleEvent.ts" enhancement="_blank"/>
/**
 * Publishes one module event. The caller module comes from the server context
 * (`moduleId`, the same way a route carries `projectId`), never from a free argument.
 * The durable queue is a port (`enqueue`); this file only checks the index and builds the envelope.
 */
import { randomUUID } from 'node:crypto';
import type { ConnectionResult } from '/_102034_/l1/server/layer_1_external/connections/catalogs/types.js';
import {
  moduleEventRefText,
  type ModuleEventActor,
  type ModuleEventEnvelope,
  type ModuleEventRef,
  type ModuleEventsIndex,
} from '/_102034_/l1/server/layer_1_external/events/types.js';

export interface ModuleEventCallContext {
  moduleId?: string;
  project?: { projectId?: string };
  sessionContext?: { actorId?: string };
  requestMeta?: { actorType?: 'user' | 'agent' | 'system'; requestId?: string };
}

export interface ModuleEventPublishOpts {
  requestId?: string;
}

export interface PublishedModuleEvent {
  eventId: string;
}

export type ModuleEventPublisher = (
  ref: ModuleEventRef,
  payload: unknown,
  context: ModuleEventCallContext,
  opts?: ModuleEventPublishOpts,
) => Promise<ConnectionResult<PublishedModuleEvent>>;

export interface ModuleEventPublisherDeps {
  index(projectId: string): Promise<ModuleEventsIndex>;
  enqueue(envelope: ModuleEventEnvelope, consumers: readonly string[]): Promise<void>;
  now?: () => Date;
  newId?: () => string;
  log?: (line: string) => void;
}

function fail(code: 'forbidden' | 'invalid' | 'unavailable', message: string): ConnectionResult<PublishedModuleEvent> {
  return { ok: false, code, message };
}

function actorOf(context: ModuleEventCallContext): ModuleEventActor | undefined {
  const id = context.sessionContext?.actorId;
  if (typeof id !== 'string' || id === '') return undefined;
  if (context.requestMeta?.actorType === 'system') return undefined;
  return { kind: context.requestMeta?.actorType === 'agent' ? 'agent' : 'person', id };
}

/** A payload is an entity record: it must serialize, and it must stay small enough to live in a queue row. */
export const MODULE_EVENT_MAX_PAYLOAD_BYTES = 1024 * 1024;

function payloadProblem(payload: unknown): string | null {
  let text: string | undefined;
  try {
    text = JSON.stringify(payload);
  } catch {
    return 'the payload cannot be serialized';
  }
  if (text === undefined) return 'the payload cannot be serialized';
  if (Buffer.byteLength(text, 'utf8') > MODULE_EVENT_MAX_PAYLOAD_BYTES) return 'the payload is above the size ceiling';
  return null;
}

export function createModuleEventPublisher(deps: ModuleEventPublisherDeps): ModuleEventPublisher {
  const now = deps.now ?? ((): Date => new Date());
  const newId = deps.newId ?? randomUUID;
  const log = deps.log ?? ((line: string): void => console.info(line));

  return async (ref, payload, context, opts) => {
    if (typeof ref?.module !== 'string' || ref.module === '' || typeof ref?.eventId !== 'string' || ref.eventId === '') {
      return fail('invalid', 'module and eventId are required');
    }
    const projectId = context?.project?.projectId;
    if (typeof projectId !== 'string' || projectId === '') {
      return fail('invalid', 'projectId is required');
    }
    const caller = context.moduleId;
    if (typeof caller !== 'string' || caller === '' || caller !== ref.module) {
      return fail('forbidden', 'the caller does not publish this event');
    }

    const text = moduleEventRefText(ref);
    let index: ModuleEventsIndex;
    try {
      index = await deps.index(projectId);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'error';
      log(`[events] index unreadable ref=${text} cause=${name}`);
      return fail('unavailable', 'the event index cannot be read');
    }
    if (!index.publishes.has(text)) {
      return fail('forbidden', 'the caller does not publish this event');
    }

    const problem = payloadProblem(payload);
    if (problem !== null) return fail('invalid', problem);

    const consumers = index.consumers.get(text) ?? [];
    const requestId = opts?.requestId ?? context.requestMeta?.requestId;
    const actor = actorOf(context);
    const envelope: ModuleEventEnvelope = {
      eventId: newId(),
      ref,
      publishedAt: now().toISOString(),
      payload,
      ...(actor !== undefined ? { actor } : {}),
      ...(typeof requestId === 'string' && requestId !== '' ? { requestId } : {}),
    };

    if (consumers.length === 0) {
      log(`[events] published ref=${text} eventId=${envelope.eventId} consumers=0`);
      return { ok: true, output: { eventId: envelope.eventId } };
    }

    try {
      await deps.enqueue(envelope, consumers);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'error';
      log(`[events] enqueue failed ref=${text} eventId=${envelope.eventId} cause=${name}`);
      return fail('unavailable', 'the event could not be queued');
    }
    return { ok: true, output: { eventId: envelope.eventId } };
  };
}
