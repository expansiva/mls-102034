/// <mls fileReference="_102034_/l1/workflow/activitiesSync.ts" enhancement="_blank"/>
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { WorkflowActivityStore } from '/_102034_/l1/workflow/activitiesStore.js';
import type {
  OccurrenceKey,
  TaskOccurrenceAdvanceResult,
  TaskOccurrenceOpenResult,
  TaskOccurrencePort,
  TaskOccurrenceSnapshot,
} from '/_102034_/l1/workflow/contracts.js';

const SOURCE_TIMEOUT = 'WORKFLOW_PROJECTION_SOURCE_TIMEOUT';
const SCOPE = 'MSG_APP_SCOPE_INVALID';

/**
 * Decorates the canonical task port. The projection is refreshed from a fresh read.
 * A projection failure never rewrites a confirmed open or advance.
 */
export function withWorkflowActivityProjection(
  basePort: TaskOccurrencePort,
  store: WorkflowActivityStore,
): TaskOccurrencePort {
  async function refresh(ctx: RequestContext, key: OccurrenceKey): Promise<void> {
    try {
      await store.refresh(ctx, key, () => basePort.find(ctx, key));
    } catch (error) {
      if (isScope(error)) throw error;
      logLag(key, error);
    }
  }

  return {
    kind: 'task',
    async open(ctx, command): Promise<TaskOccurrenceOpenResult> {
      const opened = await basePort.open(ctx, command);
      await refresh(ctx, command.ref);
      return opened;
    },
    async find(ctx, key): Promise<TaskOccurrenceSnapshot | null> {
      const trace: {
        phase: 'before' | 'read' | 'failed';
        read?: TaskOccurrenceSnapshot | null;
        loaderError?: unknown;
      } = { phase: 'before' };
      try {
        const refreshed = await store.refresh(ctx, key, async () => {
          try {
            const occurrence = await basePort.find(ctx, key);
            trace.read = occurrence;
            trace.phase = 'read';
            return occurrence;
          } catch (error) {
            trace.phase = 'failed';
            trace.loaderError = error;
            throw error;
          }
        });
        return refreshed.occurrence;
      } catch (error) {
        if (isScope(error) || isSourceTimeout(error)) throw error;
        if (trace.phase === 'failed') throw trace.loaderError;
        if (trace.phase === 'read' && trace.read !== undefined) {
          logLag(key, error);
          return trace.read;
        }
        return basePort.find(ctx, key);
      }
    },
    async advance(ctx, key, command): Promise<TaskOccurrenceAdvanceResult> {
      const advanced = await basePort.advance(ctx, key, command);
      await refresh(ctx, key);
      return advanced;
    },
  };
}

function isScope(error: unknown): boolean {
  return error instanceof AppError && error.code === SCOPE;
}

function isSourceTimeout(error: unknown): boolean {
  return error instanceof AppError && error.code === SOURCE_TIMEOUT;
}

function errorCode(error: unknown): string {
  if (error instanceof AppError && /^[A-Z0-9_]+$/.test(error.code)) return error.code;
  return 'WORKFLOW_PROJECTION_UNAVAILABLE';
}

function logLag(key: OccurrenceKey, error: unknown): void {
  console.warn(
    `[WORKFLOW_PROJECTION_LAG] ${errorCode(error)} ${key.project}/${key.module}/${key.processId}/${key.entity}/${key.recordId}`,
  );
}
