/// <mls fileReference="_102034_/l1/workflow/activitiesRebuild.ts" enhancement="_blank"/>
import { createServerMessagesClient, type ServerMessagesClient } from '/_102034_/l1/server/layer_1_external/collabMessages/client.js';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { ResponseListModuleTasks } from '/_102036_/l2/shared/interfaces.js';
import { createPostgresWorkflowActivityStore } from '/_102034_/l1/workflow/activitiesPostgres.js';
import type { WorkflowActivityStore } from '/_102034_/l1/workflow/activitiesStore.js';
import type { OccurrenceKey, TaskOccurrencePort } from '/_102034_/l1/workflow/contracts.js';
import { createMessagesWorkflowIdentities } from '/_102034_/l1/workflow/messagesIdentities.js';
import { createMessagesTaskOccurrencePort } from '/_102034_/l1/workflow/messagesOccurrence.js';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

type ListItem = ResponseListModuleTasks['items'][number];

export interface RebuildWorkflowActivityPageInput {
  projectId: string;
  moduleId: string;
  cursor?: string;
  pageSize?: number;
  /** Server test seam. Production uses the project-bound messages client. */
  client?: Pick<ServerMessagesClient, 'listModuleTasks'>;
  /** Server test seam. Production uses the Postgres projection. */
  store?: WorkflowActivityStore;
  /** Canonical task port without the projection decorator. */
  basePort?: TaskOccurrencePort;
}

export interface WorkflowActivityRebuildFailure {
  ref: OccurrenceKey | null;
  code: string;
}

export interface RebuildWorkflowActivityPageResult {
  cursor?: string;
  counts: {
    listed: number;
    refreshed: number;
    absent: number;
    failed: number;
  };
  failures: WorkflowActivityRebuildFailure[];
}

/**
 * Rebuild one page of the derived activity index from the canonical task list.
 * A missing local row is not a reason to skip a task. Confirmed absence removes
 * only that ref. A source error does not.
 */
export async function rebuildWorkflowActivityPage(
  ctx: RequestContext,
  input: RebuildWorkflowActivityPageInput,
): Promise<RebuildWorkflowActivityPageResult> {
  const projectId = requireScopeId(input.projectId, 'projectId');
  const moduleId = requireScopeId(input.moduleId, 'moduleId');
  assertSessionScope(projectId, ctx);
  if (input.cursor !== undefined && input.cursor.trim() === '') {
    throw new AppError('WORKFLOW_PROJECTION_QUERY_INVALID', 'Workflow activity list cursor is not valid.', 400);
  }
  const pageSize = pageSizeOf(input.pageSize);
  const wired = wireDefaults(projectId, moduleId, input.client, input.basePort);
  const store = input.store ?? createPostgresWorkflowActivityStore({ projectId, moduleId });
  if (store.projectId !== projectId || store.moduleId !== moduleId) {
    throw new AppError('MSG_APP_SCOPE_INVALID', 'Module operation is outside the configured application.', 400);
  }

  const listed = await wired.client.listModuleTasks(`app:${projectId}`, {
    project: projectId,
    module: moduleId,
    ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    pageSize,
  });
  const page = readPage(listed, pageSize, input.cursor);

  const seen = new Set<string>();
  const failures: WorkflowActivityRebuildFailure[] = [];
  let refreshed = 0;
  let absent = 0;
  let scheduled = 0;

  for (const item of page.items) {
    const parsed = parseItem(item, projectId, moduleId);
    if (!parsed.ok) {
      scheduled += 1;
      failures.push({ ref: parsed.ref, code: parsed.code });
      continue;
    }
    const token = refToken(parsed.key);
    if (seen.has(token)) continue;
    seen.add(token);
    scheduled += 1;
    try {
      const result = await store.refresh(ctx, parsed.key, async () => {
        const occurrence = await wired.basePort.find(ctx, parsed.key);
        if (occurrence !== null && occurrence.taskId !== parsed.taskId) {
          throw new AppError(
            'WORKFLOW_PROJECTION_INVALID',
            'Workflow projection source does not match the listed task.',
            502,
          );
        }
        return occurrence;
      });
      if (result.state === 'absent') absent += 1;
      else refreshed += 1;
    } catch (error) {
      failures.push({ ref: parsed.key, code: sanitizedCode(error) });
    }
  }

  return {
    ...(page.cursor !== undefined ? { cursor: page.cursor } : {}),
    counts: {
      listed: scheduled,
      refreshed,
      absent,
      failed: failures.length,
    },
    failures,
  };
}

function wireDefaults(
  projectId: string,
  moduleId: string,
  client: Pick<ServerMessagesClient, 'listModuleTasks'> | undefined,
  basePort: TaskOccurrencePort | undefined,
): { client: Pick<ServerMessagesClient, 'listModuleTasks'>; basePort: TaskOccurrencePort } {
  if (basePort && client) return { client, basePort };
  const messages = createServerMessagesClient({ projectId });
  return {
    client: client ?? messages,
    basePort: basePort ?? createMessagesTaskOccurrencePort({
      projectId,
      moduleId,
      asUserId: `app:${projectId}`,
      identities: createMessagesWorkflowIdentities({ projectId, client: messages }),
      client: messages,
    }),
  };
}

function pageSizeOf(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(value) || value < 1) {
    throw new AppError('WORKFLOW_PROJECTION_QUERY_INVALID', 'Page size is not valid.', 400);
  }
  return Math.min(value, MAX_PAGE_SIZE);
}

function readPage(
  listed: Awaited<ReturnType<ServerMessagesClient['listModuleTasks']>>,
  pageSize: number,
  inputCursor: string | undefined,
): { items: ListItem[]; cursor?: string } {
  const body = listed.body;
  const items = body.items;
  if (listed.httpStatus !== 200 || body.statusCode !== 200 || !Array.isArray(items) || items.length > pageSize) {
    throw new AppError('WORKFLOW_CM_PROTOCOL_ERROR', 'Workflow activity list is not valid.', 502);
  }
  const cursor = body.cursor;
  if (cursor === undefined) return { items };
  if (typeof cursor !== 'string' || cursor.trim() === '' || cursor === inputCursor) {
    throw new AppError('WORKFLOW_CM_PROTOCOL_ERROR', 'Workflow activity list cursor is not valid.', 502);
  }
  return { items, cursor };
}

function parseItem(
  item: ListItem,
  projectId: string,
  moduleId: string,
): { ok: true; key: OccurrenceKey; taskId: string } | { ok: false; ref: OccurrenceKey | null; code: string } {
  const ref = item?.ref;
  const key = ref && typeof ref === 'object' ? readKey(ref) : null;
  const taskId = typeof item?.taskId === 'string' ? item.taskId.trim() : '';
  const version = ref && typeof ref === 'object' ? ref.workflowVersion : undefined;
  const versionOk = version === null || (typeof version === 'string' && version.trim() !== '' && version === version.trim());
  if (!key || !versionOk || taskId === '') {
    return { ok: false, ref: key, code: 'WORKFLOW_PROJECTION_INVALID' };
  }
  if (key.project !== projectId || key.module !== moduleId) {
    return { ok: false, ref: key, code: 'MSG_APP_SCOPE_INVALID' };
  }
  return { ok: true, key, taskId };
}

function readKey(ref: ListItem['ref']): OccurrenceKey | null {
  const project = text(ref.project);
  const module = text(ref.module);
  const processId = text(ref.processId);
  const entity = text(ref.entity);
  const recordId = text(ref.recordId);
  if (!project || !module || !processId || !entity || !recordId) return null;
  return { project, module, processId, entity, recordId };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' && value === value.trim() ? value : null;
}

function refToken(key: OccurrenceKey): string {
  return JSON.stringify([key.project, key.module, key.processId, key.entity, key.recordId]);
}

function requireScopeId(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) {
    throw new AppError('MSG_APP_SCOPE_INVALID', `Workflow projection ${field} is empty.`, 400);
  }
  return value;
}

function assertSessionScope(projectId: string, ctx: RequestContext): void {
  const sessionProject = ctx.sessionContext?.project?.projectId;
  if (sessionProject !== undefined && sessionProject !== projectId) {
    throw new AppError('MSG_APP_SCOPE_INVALID', 'Module operation is outside the configured application.', 400);
  }
}

function sanitizedCode(error: unknown): string {
  if (error instanceof AppError && /^[A-Z0-9_]+$/u.test(error.code)) return error.code;
  return 'WORKFLOW_PROJECTION_UNAVAILABLE';
}
