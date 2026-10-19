/// <mls fileReference="_102034_/l1/workflow/memoryOccurrence.ts" enhancement="_blank"/>
import cluster from 'node:cluster';
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
 * A launcher that announces COLLAB_WORKER_COUNT may use this port only for
 * a single worker. A managed worker with no announced total is refused.
 * Construction does not consult the topology. open, find and advance do,
 * on every call, before key, map, clock or any return.
 */
function assertSingleWorkerTopology(): void {
  const announced = process.env.COLLAB_WORKER_COUNT;
  if (announced !== undefined) {
    if (!/^[1-9]\d*$/.test(announced)) {
      throw new AppError(
        'WORKFLOW_RUNTIME_TOPOLOGY_INVALID',
        'COLLAB_WORKER_COUNT must be a positive decimal integer.',
        500,
        { workerCount: announced },
      );
    }
    if (announced !== '1') {
      throw new AppError(
        'WORKFLOW_MEMORY_REQUIRES_SINGLE_WORKER',
        `Memory occurrence port requires one worker; announced count is ${announced}.`,
        500,
        { workerCount: announced },
      );
    }
    return;
  }
  if (process.env.NODE_APP_INSTANCE !== undefined || cluster.isWorker) {
    throw new AppError(
      'WORKFLOW_RUNTIME_TOPOLOGY_INVALID',
      'A managed worker started without COLLAB_WORKER_COUNT.',
      500,
      { nodeAppInstance: process.env.NODE_APP_INSTANCE ?? null },
    );
  }
}

export function createMemoryOccurrencePort(): OccurrencePort {
  const records = new Map<string, OccurrenceSnapshot>();

  return {
    async open(ctx, ref, step, actorNow, by): Promise<OpenOccurrenceResult> {
      assertSingleWorkerTopology();
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
      assertSingleWorkerTopology();
      const found = records.get(occurrenceKey(key));
      return found ? copySnapshot(found) : null;
    },

    async advance(ctx, key, command): Promise<AdvanceOccurrenceResult> {
      assertSingleWorkerTopology();
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

