/// <mls fileReference="_102034_/l2/monitor/shared/contracts/tests.ts" enhancement="_blank" />
// Frontend view of the monitor Tests API (l1/monitor/layer_3_usecases/testsUsecases.ts). Kept as a
// standalone contract so the render layer does not import backend code.

export interface MonitorTestCaseResult {
  module: string;
  page: string;
  id: string;
  routine: string;
  status: 'pass' | 'fail' | 'skipped';
  ok: boolean;
  statusCode: number;
  durationMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  reason: string;
}

export interface MonitorTestRunSummary {
  runId: string;
  traceId: string;
  startedAt: string;
  finishedAt: string;
  appEnv: string;
  scope: { moduleId?: string; page?: string };
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  cases: MonitorTestCaseResult[];
}

export interface MonitorTestPageCase {
  id: string;
  routine: string;
  mutating: boolean;
  expect: { ok: boolean; errorCode?: string; minItems?: number; shape?: 'object' | 'array' | 'paginated' };
}

export interface MonitorTestModule {
  moduleId: string;
  projectId: string;
  pages: Array<{
    page: string;
    variant: string;
    path: string;
    loadError?: string;
    cases: MonitorTestPageCase[];
  }>;
}

export interface MonitorTestsListResponse {
  appEnv: string;
  executionEnabled: boolean;
  modules: MonitorTestModule[];
  recentRuns: MonitorTestRunSummary[];
}

export interface MonitorTestsResultsResponse {
  recentRuns: MonitorTestRunSummary[];
}
