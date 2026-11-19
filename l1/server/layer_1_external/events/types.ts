/// <mls fileReference="_102034_/l1/server/layer_1_external/events/types.ts" enhancement="_blank"/>

/** Who published an event: `'<module>.<eventId>'`. */
export interface ModuleEventRef {
  module: string;
  eventId: string;
}

export function moduleEventRefText(ref: ModuleEventRef): string {
  return `${ref.module}.${ref.eventId}`;
}

export interface ModuleEventActor {
  kind: 'person' | 'agent';
  id: string;
}

export interface ModuleEventEnvelope {
  eventId: string;
  ref: ModuleEventRef;
  publishedAt: string;
  payload: unknown;
  actor?: ModuleEventActor;
  requestId?: string;
}

export interface ModuleEventPublish {
  to: string;
}

export interface ModuleEventsIndex {
  publishes: Map<string, ModuleEventPublish>;
  consumers: Map<string, string[]>;
}
