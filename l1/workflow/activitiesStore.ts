/// <mls fileReference="_102034_/l1/workflow/activitiesStore.ts" enhancement="_blank"/>
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type {
  OccurrenceKey,
  OccurrenceRef,
  TaskOccurrenceSnapshot,
} from '/_102034_/l1/workflow/contracts.js';
import type { WorkflowActivity } from '/_102034_/l1/workflow/activities.js';

/**
 * Server-side activity index bound to one project and module.
 * Subject and actorRefs are resolved by the server consumer. This contract has no HTTP principal.
 * There is no production in-memory store and no apply of a previously captured snapshot.
 */
export interface WorkflowActivityStore {
  readonly projectId: string;
  readonly moduleId: string;
  refresh(
    ctx: RequestContext,
    key: OccurrenceKey,
    loadOccurrence: () => Promise<TaskOccurrenceSnapshot | null>,
  ): Promise<WorkflowActivityRefreshResult>;
  list(ctx: RequestContext, query: WorkflowActivityListQuery): Promise<WorkflowActivityListResult>;
}

export interface WorkflowActivityRefreshResult {
  state: 'synced' | 'absent';
  occurrence: TaskOccurrenceSnapshot | null;
}

/** Person is an MDM id. actorRefs are role references already authorized for that person. */
export interface WorkflowActivitySubject {
  personMdmId: string;
  actorRefs?: string[];
}

export interface WorkflowActivityListQuery {
  subject: WorkflowActivitySubject;
  cursor?: string;
  pageSize?: number;
  includeNonActionable?: boolean;
}

/** Identity, titles, status, ref, revision and sync time, plus one activity. */
export interface WorkflowActivityListItem {
  projectId: string;
  moduleId: string;
  taskId: string;
  ref: OccurrenceRef;
  revision: number;
  syncedAt: string;
  status: TaskOccurrenceSnapshot['status'];
  taskTitle: string;
  processTitle: string;
  moduleTitle: string;
  activity: WorkflowActivity;
}

export interface WorkflowActivityListResult {
  items: WorkflowActivityListItem[];
  cursor?: string;
}
