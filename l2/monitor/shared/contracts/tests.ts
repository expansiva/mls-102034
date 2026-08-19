/// <mls fileReference="_102034_/l2/monitor/shared/contracts/tests.ts" enhancement="_blank" />
// Frontend view of the monitor Tests API (l1/monitor/layer_3_usecases/testsUsecases.ts). Kept as a
// standalone contract so the render layer does not import backend code.

// 'inconclusive' = the case could not verify what it claims (unresolved <seedRef>, or a
// `<field>.required` case rejected on another field) — not an app defect.
// 'knownFail' = the case declared `expectedFail: '<wave>'` and failed as expected: work already owned
// elsewhere, kept out of `failed` so that count keeps meaning "something new broke".
export type MonitorTestCaseStatus = 'pass' | 'fail' | 'inconclusive' | 'skipped' | 'knownFail';

export interface MonitorTestCaseResult {
  module: string;
  page: string;
  id: string;
  routine: string;
  status: MonitorTestCaseStatus;
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
  knownFail: number;
  inconclusive: number;
  skipped: number;
  cases: MonitorTestCaseResult[];
}

export interface MonitorTestPageCase {
  id: string;
  routine: string;
  mutating: boolean;
  // itemsKey names the collection of a `paginated` envelope (`{ menuItems: [...] }`); absent -> `items`.
  expect: { ok: boolean; errorCode?: string; minItems?: number; shape?: 'object' | 'array' | 'paginated'; itemsKey?: string };
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
