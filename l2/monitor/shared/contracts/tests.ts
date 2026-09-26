/// <mls fileReference="_102034_/l2/monitor/shared/contracts/tests.ts" enhancement="_blank" />
// Frontend view of the monitor Tests API (l1/monitor/layer_3_usecases/testsUsecases.ts). Kept as a
// standalone contract so the render layer does not import backend code.

// 'inconclusive' = the case could not verify what it claims (unresolved <seedRef>, or a
// `<field>.required` case rejected on another field) — not an app defect.
// 'knownFail' = the case declared `expectedFail: '<wave>'` and failed as expected: work already owned
// elsewhere, kept out of `failed` so that count keeps meaning "something new broke".
// 'moduleOnly' = catalog v1.1 `runner: 'module'`: the case belongs to the L1 node adapter, not to
// execBff. The monitor reports it and does not run it — neither a pass nor a failure.
export type MonitorTestCaseStatus = 'pass' | 'fail' | 'inconclusive' | 'skipped' | 'knownFail' | 'expectedRed' | 'blocked' | 'moduleOnly';

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
  /** Handler stage the producer classified. Present on catalog cases. */
  stage?: string;
  /** Catalog `source` — who wrote the expectation. */
  expectationSource?: string;
  /** Catalog `expectation` text. */
  expectation?: string;
}

export interface MonitorTestRunSummary {
  runId: string;
  traceId: string;
  startedAt: string;
  finishedAt: string;
  /** ProjectMode from l5/project.json. */
  appEnv: string;
  appEnvSource?: string;
  serverAppEnv?: string;
  scope: { moduleId?: string; page?: string };
  total: number;
  passed: number;
  failed: number;
  knownFail: number;
  expectedRed?: number;
  /** Catalog cases reported but not executed (`runner: 'module'`). Absent on a run from an older server. */
  moduleOnly?: number;
  blocked?: number;
  inconclusive: number;
  skipped: number;
  /** True when the scope had no registered suite. A zero-case run is not a pass. */
  untested?: boolean;
  untestedReason?: string;
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
  variantPolicy?: string;
  untestedPages?: Array<{ page: string; reason: string }>;
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
  appEnvSource?: string;
  serverAppEnv?: string;
  executionEnabled: boolean;
  modules: MonitorTestModule[];
  recentRuns: MonitorTestRunSummary[];
}

export interface MonitorTestsResultsResponse {
  recentRuns: MonitorTestRunSummary[];
}
