/**
 * TEST SUPPORT of module events. It lives OUTSIDE `l1`, `l2` and `l4`, so nothing here reaches a release.
 *
 *   import { exampleEventIndex, createFakeModuleEventPublisher, createFakeConsumesRoute } from '/_102034_/testing/events/eventFixtures.js';
 */
import type { ConnectionResult } from '/_102034_/l2/shared/contracts/connections/types.js';
import type {
  ModuleEventCallContext,
  ModuleEventPublishOpts,
  ModuleEventPublisher,
  PublishModuleEvent,
  PublishedModuleEvent,
} from '/_102034_/l1/server/layer_1_external/events/publishModuleEvent.js';
import type { ModuleEventRef, ModuleEventsIndex } from '/_102034_/l1/server/layer_1_external/events/types.js';

const PUBLISHED = 'sourceModule.happened';
const QUIET = 'sourceModule.quiet';

/** One event with one subscriber, and one event nobody receives. */
export function exampleEventIndex(): ModuleEventsIndex {
  return {
    publishes: new Map([
      [PUBLISHED, { to: 'any' }],
      [QUIET, { to: 'any' }],
    ]),
    consumers: new Map([[PUBLISHED, ['readerModule']]]),
  };
}

export interface RecordedModuleEvent {
  ref: ModuleEventRef;
  payload: unknown;
  context: ModuleEventCallContext;
  opts?: ModuleEventPublishOpts;
}

export interface FakeModuleEventPublisher {
  publish: ModuleEventPublisher;
  readonly published: RecordedModuleEvent[];
}

const recordedReady: RecordedModuleEvent[] = [];

/** Same signature as the real `publishModuleEvent`. Records the call and answers `ok`. */
export const publishModuleEvent: PublishModuleEvent = async (ref, payload, context, opts) => {
  recordedReady.push({ ref, payload, context, opts });
  return { ok: true, output: { eventId: 'recorded' } };
};

export function recordedModuleEvents(): readonly RecordedModuleEvent[] {
  return recordedReady;
}

/** Records each publication and answers `ok`. It does not read an index. */
export function createFakeModuleEventPublisher(): FakeModuleEventPublisher {
  const published: RecordedModuleEvent[] = [];
  const publish: ModuleEventPublisher = async (ref, payload, context, opts): Promise<ConnectionResult<PublishedModuleEvent>> => {
    published.push({ ref, payload, context, opts });
    return { ok: true, output: { eventId: 'recorded' } };
  };
  return { publish, published };
}

/** A request def row that carries the `consumes` mark, the same place a route carries `serves`. */
export function createFakeConsumesRoute(input: { moduleId: string; route: string; consumes: string }): {
  moduleId: string;
  request: { route: string; consumes: string };
} {
  return {
    moduleId: input.moduleId,
    request: { route: input.route, consumes: input.consumes },
  };
}
