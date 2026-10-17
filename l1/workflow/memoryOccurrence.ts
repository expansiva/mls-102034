/// <mls fileReference="_102034_/l1/workflow/memoryOccurrence.ts" enhancement="_blank"/>
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type {
  AdvanceOccurrenceCommand,
  AdvanceOccurrenceResult,
  OccurrenceKey,
  OccurrencePort,
  OccurrenceRef,
  OccurrenceSnapshot,
  OpenOccurrenceResult,
} from '/_102034_/l1/workflow/contracts.js';

function occurrenceKey(key: OccurrenceKey): string {
  return JSON.stringify([key.project, key.module, key.processId, key.entity, key.recordId]);
}

function copySnapshot(snapshot: OccurrenceSnapshot): OccurrenceSnapshot {
  return {
    ref: { ...snapshot.ref },
    step: snapshot.step,
    actorNow: snapshot.actorNow,
    done: snapshot.done,
    history: snapshot.history.map(entry => ({ ...entry })),
  };
}

function samePassage(current: OccurrenceSnapshot, command: AdvanceOccurrenceCommand): boolean {
  return current.step === command.to
    && current.actorNow === command.actorNow
    && current.done === command.done;
}

/**
 * In-memory occurrence port. The map is private to this instance.
 * Read, decide and write run with no await between them, so one instance
 * is atomic on a single process. This is not a stand-in for the cm adapter.
 */
export function createMemoryOccurrencePort(): OccurrencePort {
  const records = new Map<string, OccurrenceSnapshot>();

  return {
    async open(ctx, ref, step, actorNow, by): Promise<OpenOccurrenceResult> {
      const id = occurrenceKey(ref);
      const existing = records.get(id);
      if (existing) return { outcome: 'existing', occurrence: copySnapshot(existing) };
      const occurrence: OccurrenceSnapshot = {
        ref: { ...ref },
        step,
        actorNow,
        done: false,
        history: [{
          at: ctx.clock.nowIso(),
          by,
          from: null,
          step,
          actorNow,
          done: false,
        }],
      };
      records.set(id, occurrence);
      return { outcome: 'created', occurrence: copySnapshot(occurrence) };
    },

    async find(_ctx, key): Promise<OccurrenceSnapshot | null> {
      const found = records.get(occurrenceKey(key));
      return found ? copySnapshot(found) : null;
    },

    async advance(ctx, key, command): Promise<AdvanceOccurrenceResult> {
      const current = records.get(occurrenceKey(key));
      if (!current) {
        throw new AppError('OCCURRENCE_NOT_FOUND', 'Occurrence was never opened.', 404);
      }
      if (samePassage(current, command)) {
        return { outcome: 'unchanged', occurrence: copySnapshot(current) };
      }
      if (current.step !== command.from) {
        return { outcome: 'conflict', occurrence: copySnapshot(current) };
      }
      if (current.done && command.done === false) {
        throw new AppError('OCCURRENCE_CLOSED', 'A closed occurrence cannot be reopened.', 409);
      }
      const entry = {
        at: ctx.clock.nowIso(),
        by: command.by,
        from: command.from,
        step: command.to,
        actorNow: command.actorNow,
        done: command.done,
        ...(command.note !== undefined ? { note: command.note } : {}),
      };
      current.step = command.to;
      current.actorNow = command.actorNow;
      current.done = command.done;
      current.history.push(entry);
      return { outcome: 'advanced', occurrence: copySnapshot(current) };
    },
  };
}

