/// <mls fileReference="_102034_/l1/workflow/wakeRegistry.ts" enhancement="_blank"/>
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { loadConfiguredModuleCompositionRoot } from '/_102034_/l1/server/layer_2_controllers/moduleRegistry.js';
import type { WorkflowWakeHandler, WorkflowWakeScope } from '/_102034_/l1/workflow/wakeContracts.js';

export interface WorkflowWakeRegistryDeps {
  loadCompositionRoot?: (projectId: string, moduleId: string) => Promise<void>;
}

export interface WorkflowWakeRegistry {
  register(scope: WorkflowWakeScope, handler: WorkflowWakeHandler): void;
  resolve(scope: WorkflowWakeScope): Promise<WorkflowWakeHandler>;
  clear(): void;
}

function scopeKey(scope: WorkflowWakeScope): string {
  return JSON.stringify([scope.projectId, scope.moduleId, scope.processId, scope.routine]);
}

export function createWorkflowWakeRegistry(deps: WorkflowWakeRegistryDeps = {}): WorkflowWakeRegistry {
  const handlers = new Map<string, WorkflowWakeHandler>();
  const loadCompositionRoot = deps.loadCompositionRoot ?? loadConfiguredModuleCompositionRoot;

  return {
    register(scope, handler) {
      const key = scopeKey(scope);
      const current = handlers.get(key);
      if (current === handler) {
        return;
      }
      if (current) {
        throw new AppError(
          'WORKFLOW_WAKE_HANDLER_CONFLICT',
          'Workflow wake handler is already registered for this scope',
          500,
        );
      }
      handlers.set(key, handler);
    },
    async resolve(scope) {
      await loadCompositionRoot(scope.projectId, scope.moduleId);
      const handler = handlers.get(scopeKey(scope));
      if (!handler) {
        throw new AppError(
          'WORKFLOW_WAKE_HANDLER_UNAVAILABLE',
          'Workflow wake handler is not registered',
          503,
        );
      }
      return handler;
    },
    clear() {
      handlers.clear();
    },
  };
}

const defaultRegistry = createWorkflowWakeRegistry();

export function registerWorkflowWakeHandler(scope: WorkflowWakeScope, handler: WorkflowWakeHandler): void {
  defaultRegistry.register(scope, handler);
}

export function resolveWorkflowWakeHandler(scope: WorkflowWakeScope): Promise<WorkflowWakeHandler> {
  return defaultRegistry.resolve(scope);
}

export function resetWorkflowWakeRegistryForTests(): void {
  defaultRegistry.clear();
}
