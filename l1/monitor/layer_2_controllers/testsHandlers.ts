/// <mls fileReference="_102034_/l1/monitor/layer_2_controllers/testsHandlers.ts" enhancement="_blank" />
// Item 2c — monitor Tests control API. `list`/`results` are always available (history/inspection);
// `run` is gated to devenv inside the usecase (throws 403 TESTS_DISABLED otherwise).
import { ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { listPageTests, loadTestResults, runPageTests } from '/_102034_/l1/monitor/layer_3_usecases/testsUsecases.js';

export const monitorTestsListHandler: BffHandler = async () => ok(await listPageTests());

export const monitorTestsRunHandler: BffHandler = async ({ request }) => {
  const params = (request.params ?? {}) as Record<string, unknown>;
  const moduleId = typeof params.moduleId === 'string' ? params.moduleId : undefined;
  const page = typeof params.page === 'string' ? params.page : undefined;
  const skipMutating = params.skipMutating === true;
  return ok(await runPageTests({ moduleId, page, skipMutating }));
};

export const monitorTestsResultsHandler: BffHandler = async ({ request }) => {
  const params = (request.params ?? {}) as Record<string, unknown>;
  const moduleId = typeof params.moduleId === 'string' ? params.moduleId : undefined;
  const page = typeof params.page === 'string' ? params.page : undefined;
  const runId = typeof params.runId === 'string' ? params.runId : undefined;
  const limit = typeof params.limit === 'number' ? params.limit : undefined;
  return ok(loadTestResults({ moduleId, page, runId, limit }));
};
