/// <mls fileReference="_102034_/l1/server/layer_1_external/events/publishModuleEvent.ts" enhancement="_blank"/>
/**
 * Publishes one module event. The caller module comes from the server context
 * (`moduleId`, the same way a route carries `projectId`), never from a free argument.
 * The durable queue is a port (`enqueue`); this file only checks the index and builds the envelope.
 */
import { randomUUID } from 'node:crypto';
import type { ConnectionResult } from '/_102034_/l2/shared/contracts/connections/types.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { IModuleDataRuntime } from '/_102034_/l1/server/layer_1_external/data/moduleDataRuntime.js';
import {
  MODULE_EVENT_DELIVERY_TABLE,
  MODULE_EVENT_TABLE,
} from '/_102034_/l1/server/layer_1_external/events/moduleEventQueue.js';
import { moduleEventsIndex } from '/_102034_/l1/server/layer_1_external/events/moduleEventsIndex.js';
import {
  moduleEventRefText,
  type ModuleEventActor,
  type ModuleEventEnvelope,
  type ModuleEventRef,
  type ModuleEventsIndex,
} from '/_102034_/l1/server/layer_1_external/events/types.js';

/**
 * What the publisher reads from the request context, and only paths the real `RequestContext` has: the project is in
 * `sessionContext.project` (not at the top), the caller module in `moduleId`, the actor in `sessionContext.actorId` and
 * `requestMeta`. Typed as a `Pick` so a hand-made context with another shape does not compile.
 */
export type ModuleEventCallContext = Pick<RequestContext, 'sessionContext' | 'moduleId' | 'requestMeta'>;

/** The use-case context. `data.moduleData` is the runtime the use case is already using. */
export type ModuleEventPublishContext = ModuleEventCallContext & Pick<RequestContext, 'data'>;

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

export type PublishModuleEvent = (
  ref: ModuleEventRef,
  payload: unknown,
  ctx: ModuleEventPublishContext,
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
    const projectId = context?.sessionContext?.project?.projectId;
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

interface ModuleEventRow {
  eventId: string;
  projectId: string;
  moduleId: string;
  event: string;
  payload: unknown;
  actorKind: 'person' | 'agent' | null;
  actorId: string | null;
  requestId: string | null;
  publishedAt: string;
}

interface ModuleEventDeliveryRow {
  eventId: string;
  consumerModule: string;
  attempts: number;
  nextAttemptAt: string;
  leaseUntil: string | null;
  result: 'pending';
  reason: string | null;
  deliveredAt: string | null;
}

/**
 * Event and delivery rows go through the repositories of the queue tables, on `runtime`.
 * Inside a use-case `runInTransaction`, that runtime is already bound to the transaction client
 * (`moduleDataRuntime.ts`), and a nested `runInTransaction` keeps the same client, so both inserts
 * commit or roll back with the use case. Outside a transaction, this opens its own
 * `runInTransaction` for these two inserts only.
 */
async function enqueueOnModuleData(
  runtime: IModuleDataRuntime,
  projectId: string,
  envelope: ModuleEventEnvelope,
  consumers: readonly string[],
): Promise<void> {
  await runtime.runInTransaction(async (tx) => {
    const events = await tx.getTable<ModuleEventRow>(MODULE_EVENT_TABLE);
    await events.insert({
      record: {
        eventId: envelope.eventId,
        projectId,
        moduleId: envelope.ref.module,
        event: moduleEventRefText(envelope.ref),
        payload: envelope.payload ?? null,
        actorKind: envelope.actor?.kind ?? null,
        actorId: envelope.actor?.id ?? null,
        requestId: envelope.requestId ?? null,
        publishedAt: envelope.publishedAt,
      },
    });
    const deliveries = await tx.getTable<ModuleEventDeliveryRow>(MODULE_EVENT_DELIVERY_TABLE);
    for (const consumerModule of consumers) {
      await deliveries.insert({
        record: {
          eventId: envelope.eventId,
          consumerModule,
          attempts: 0,
          nextAttemptAt: envelope.publishedAt,
          leaseUntil: null,
          result: 'pending',
          reason: null,
          deliveredAt: null,
        },
      });
    }
  });
}

/**
 * The publisher bound to an index. The release index is the default; a test passes its own here, never through the
 * context, because the context is what generated code hands in and must not be able to replace the index.
 */
export function createPublishModuleEvent(
  index: (projectId: string) => Promise<ModuleEventsIndex> = moduleEventsIndex,
): PublishModuleEvent {
  return (ref, payload, ctx, opts) => {
    const publish = createModuleEventPublisher({
      index,
      enqueue: (envelope, consumers) => {
        const projectId = ctx.sessionContext?.project?.projectId ?? '';
        return enqueueOnModuleData(ctx.data.moduleData, projectId, envelope, consumers);
      },
    });
    return publish(ref, payload, ctx, opts);
  };
}

/**
 * `publishModuleEvent(ref, payload, ctx, opts?)`: the name a generated use case imports.
 * The index is the release index. The queue is the module data the use case is using.
 */
export const publishModuleEvent: PublishModuleEvent = createPublishModuleEvent();
