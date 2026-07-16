/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/testsUsecases.ts" enhancement="_blank" />
// Item 2c — devenv BFF test runner.
// Discovers the generated page11 `<page>.test.ts` files from config.json (modules[].frontend.pageTests),
// then runs each declarative case through the SAME real pipeline the HTTP transport uses (execBff:
// resolve routine -> controller -> usecase -> adapter), with source='test'. Nothing is faked, so the
// composition root, tables and seeds are all exercised together.
//
// Isolation & environment:
// - `runPageTests` only executes when appEnv === 'development' (else 403 TESTS_DISABLED). `list`/`results`
//   run everywhere (history/inspection).
// - Mutating cases (command "ok" cases) run inside `ctx.data.runInTransaction` and are rolled back so a
//   run never dirties the data a developer is using. When `skipMutating` is set they are reported as
//   'skipped' instead.
// - `<seedRef>` params are resolved from a pool harvested by first running the page's parameterless
//   read queries, so a validation case's only wrong input is the omitted required field.
//
// Results are captured directly from execBff's return value and kept in a small in-memory ring (the
// execution log/series store only keeps aggregates and Postgres monitor storage is optional in devenv).

import { AppError, fail, type BffRequest, type BffResponse, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createDefaultRequestContext, createRequestContext, execBff } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { readProjectsConfig, resolveProjectModuleImportUrl } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { createUuidV7 } from '/_102029_/l2/uuidv7.js';

const SEED_REF_MARKER = '<seedRef>';
const MAX_STORED_RUNS = 50;

// ---- Shapes read from the (untrusted) generated client file — validated at runtime, never imported. ----

type TestShape = 'object' | 'array' | 'paginated';

interface PageTestCase {
  id: string;
  routine: string;
  params: Record<string, unknown>;
  expect: { ok: boolean; errorCode?: string; minItems?: number; shape?: TestShape };
  mutating: boolean;
}

interface PageTestsFile {
  moduleName: string;
  page: string;
  variant: string;
  cases: PageTestCase[];
}

interface DiscoveredTestFile {
  projectId: string;
  moduleId: string;
  path: string;
  tests: PageTestsFile | null;
  loadError?: string;
}

export interface TestCaseResult {
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

export interface TestRunSummary {
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
  cases: TestCaseResult[];
}

export interface TestListResult {
  appEnv: string;
  executionEnabled: boolean;
  modules: Array<{
    moduleId: string;
    projectId: string;
    pages: Array<{
      page: string;
      variant: string;
      path: string;
      loadError?: string;
      cases: Array<{ id: string; routine: string; mutating: boolean; expect: PageTestCase['expect'] }>;
    }>;
  }>;
  recentRuns: TestRunSummary[];
}

// ---- In-memory history (net-new state; everything else reuses existing runtime infra). ----

const recentRuns: TestRunSummary[] = [];

function storeRun(run: TestRunSummary): void {
  recentRuns.unshift(run);
  if (recentRuns.length > MAX_STORED_RUNS) recentRuns.length = MAX_STORED_RUNS;
}

export function getRecentRuns(filter: { moduleId?: string; page?: string; runId?: string } = {}, limit = 20): TestRunSummary[] {
  return recentRuns
    .filter(run => (!filter.runId || run.runId === filter.runId))
    .filter(run => (!filter.moduleId || run.scope.moduleId === filter.moduleId || run.cases.some(c => c.module === filter.moduleId)))
    .filter(run => (!filter.page || run.scope.page === filter.page || run.cases.some(c => c.page === filter.page)))
    .slice(0, limit);
}

// ---- Discovery ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function coercePageTestsFile(raw: unknown): PageTestsFile | null {
  if (!isRecord(raw)) return null;
  const moduleName = typeof raw.moduleName === 'string' ? raw.moduleName : '';
  const page = typeof raw.page === 'string' ? raw.page : '';
  const variant = typeof raw.variant === 'string' ? raw.variant : 'page11';
  if (!moduleName || !page || !Array.isArray(raw.cases)) return null;
  const cases: PageTestCase[] = [];
  for (const item of raw.cases) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === 'string' ? item.id : '';
    const routine = typeof item.routine === 'string' ? item.routine : '';
    if (!id || !routine) continue;
    const expectRaw = isRecord(item.expect) ? item.expect : {};
    cases.push({
      id,
      routine,
      params: isRecord(item.params) ? { ...item.params } : {},
      expect: {
        ok: expectRaw.ok === true,
        errorCode: typeof expectRaw.errorCode === 'string' ? expectRaw.errorCode : undefined,
        minItems: typeof expectRaw.minItems === 'number' ? expectRaw.minItems : undefined,
        shape: expectRaw.shape === 'object' || expectRaw.shape === 'array' || expectRaw.shape === 'paginated' ? expectRaw.shape : undefined,
      },
      mutating: item.mutating === true,
    });
  }
  return { moduleName, page, variant, cases };
}

async function discoverTestFiles(filter: { moduleId?: string; page?: string } = {}): Promise<DiscoveredTestFile[]> {
  const config = readProjectsConfig();
  const files: DiscoveredTestFile[] = [];
  for (const [projectId, project] of Object.entries(config.projects)) {
    for (const moduleConfig of project.modules ?? []) {
      if (filter.moduleId && moduleConfig.moduleId !== filter.moduleId) continue;
      for (const path of moduleConfig.frontend?.pageTests ?? []) {
        let tests: PageTestsFile | null = null;
        let loadError: string | undefined;
        try {
          const imported = await import(resolveProjectModuleImportUrl(path)) as { pageTests?: unknown };
          tests = coercePageTestsFile(imported.pageTests);
          if (!tests) loadError = 'file did not export a valid pageTests object';
        } catch (error) {
          loadError = error instanceof Error ? error.message : String(error);
        }
        if (filter.page && tests && tests.page !== filter.page) continue;
        files.push({ projectId, moduleId: moduleConfig.moduleId, path, tests, loadError });
      }
    }
  }
  return files;
}

// ---- list ----

export async function listPageTests(): Promise<TestListResult> {
  const env = readAppEnv();
  const files = await discoverTestFiles();
  const byModule = new Map<string, TestListResult['modules'][number]>();
  for (const file of files) {
    let entry = byModule.get(file.moduleId);
    if (!entry) {
      entry = { moduleId: file.moduleId, projectId: file.projectId, pages: [] };
      byModule.set(file.moduleId, entry);
    }
    entry.pages.push({
      page: file.tests?.page ?? file.path,
      variant: file.tests?.variant ?? 'page11',
      path: file.path,
      loadError: file.loadError,
      cases: (file.tests?.cases ?? []).map(c => ({ id: c.id, routine: c.routine, mutating: c.mutating, expect: c.expect })),
    });
  }
  return {
    appEnv: env.appEnv,
    executionEnabled: env.appEnv === 'development',
    modules: [...byModule.values()],
    recentRuns: getRecentRuns({}, 10),
  };
}

// ---- run ----

class RollbackSignal extends Error {}

function describeShape(data: unknown): string {
  if (Array.isArray(data)) return 'array';
  if (data === null || data === undefined) return String(data);
  return typeof data === 'object' ? 'object' : typeof data;
}

// Item 5 drift guard: the actual response shape must match the shape the FE contract declares.
// Returns '' when compatible, else a failure reason (object×array, or paginated missing items[]).
function checkShape(data: unknown, shape: TestShape): string {
  if (shape === 'array') {
    return Array.isArray(data) ? '' : `expected array output, got ${describeShape(data)}`;
  }
  if (shape === 'paginated') {
    return isRecord(data) && Array.isArray(data.items) ? '' : `expected paginated { items: [] }, got ${describeShape(data)}`;
  }
  return isRecord(data) && !Array.isArray(data) ? '' : `expected object output, got ${describeShape(data)}`;
}

function countItems(data: unknown): number {
  if (Array.isArray(data)) return data.length;
  if (isRecord(data) && Array.isArray(data.items)) return data.items.length;
  if (data !== null && data !== undefined) return 1;
  return 0;
}

function harvestRows(pool: Record<string, unknown>, data: unknown): void {
  const rows: unknown[] = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.items)
      ? data.items
      : isRecord(data)
        ? [data]
        : [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    for (const [key, value] of Object.entries(row)) {
      if (pool[key] === undefined && value !== null && value !== undefined) pool[key] = value;
    }
  }
}

function resolveParams(params: Record<string, unknown>, pool: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === SEED_REF_MARKER) {
      if (pool[key] !== undefined) resolved[key] = pool[key];
      // unresolved seedRef -> omit the key (best-effort; runner cannot invent a valid id)
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

// A parameterless, non-mutating success case is a read query — used both as its own case and to
// harvest the seed pool that resolves <seedRef> params for the remaining cases.
function isHarvestCase(testCase: PageTestCase): boolean {
  return testCase.expect.ok && !testCase.mutating && Object.keys(testCase.params).length === 0;
}

async function runIsolated(baseCtx: RequestContext, request: BffRequest): Promise<{ response: BffResponse; statusCode: number }> {
  let captured: { response: BffResponse; statusCode: number } | null = null;
  try {
    await baseCtx.data.runInTransaction(async (txRuntime) => {
      const txCtx = createRequestContext(txRuntime);
      captured = await execBff(request, txCtx);
      throw new RollbackSignal(); // discard the write; keep the captured result
    });
  } catch (error) {
    if (!(error instanceof RollbackSignal) && !captured) {
      const appError = error instanceof AppError ? error : new AppError('TEST_ISOLATION_ERROR', error instanceof Error ? error.message : String(error), 500);
      return { response: fail(appError), statusCode: appError.statusCode };
    }
  }
  return captured ?? { response: fail(new AppError('TEST_ISOLATION_ERROR', 'isolated run produced no result', 500)), statusCode: 500 };
}

function evaluate(testCase: PageTestCase, module: string, page: string, exec: { response: BffResponse; statusCode: number }, durationMs: number): TestCaseResult {
  const { response, statusCode } = exec;
  let status: 'pass' | 'fail' = 'pass';
  let reason = '';
  if (testCase.expect.ok) {
    if (!response.ok) {
      status = 'fail';
      reason = `expected ok, got error ${response.error?.code ?? 'unknown'}`;
    } else {
      const shapeReason = testCase.expect.shape ? checkShape(response.data, testCase.expect.shape) : '';
      if (shapeReason) {
        status = 'fail';
        reason = shapeReason;
      } else if (testCase.expect.minItems !== undefined) {
        const count = countItems(response.data);
        if (count < testCase.expect.minItems) {
          status = 'fail';
          reason = `expected >= ${testCase.expect.minItems} item(s), got ${count}`;
        }
      }
    }
  } else if (response.ok) {
    status = 'fail';
    reason = 'expected failure, got ok';
  } else if (testCase.expect.errorCode && response.error?.code !== testCase.expect.errorCode) {
    status = 'fail';
    reason = `expected errorCode ${testCase.expect.errorCode}, got ${response.error?.code ?? 'unknown'}`;
  }
  return {
    module,
    page,
    id: testCase.id,
    routine: testCase.routine,
    status,
    ok: response.ok,
    statusCode,
    durationMs,
    errorCode: response.error?.code ?? null,
    errorMessage: response.error?.message ?? null,
    reason,
  };
}

export async function runPageTests(input: { moduleId?: string; page?: string; skipMutating?: boolean } = {}): Promise<TestRunSummary> {
  const env = readAppEnv();
  if (env.appEnv !== 'development') {
    throw new AppError('TESTS_DISABLED', 'BFF test execution is only available in development (devenv).', 403, { appEnv: env.appEnv });
  }

  const runId = createUuidV7();
  const traceId = createUuidV7();
  const startedAt = new Date().toISOString();
  const files = (await discoverTestFiles({ moduleId: input.moduleId, page: input.page })).filter(file => file.tests);
  const baseCtx = createDefaultRequestContext();
  const cases: TestCaseResult[] = [];

  for (const file of files) {
    const tests = file.tests!;
    const pool: Record<string, unknown> = {};

    const runOne = async (testCase: PageTestCase, params: Record<string, unknown>, mutating: boolean): Promise<{ result: TestCaseResult; response: BffResponse }> => {
      const request: BffRequest = { routine: testCase.routine, params, meta: { source: 'test', traceId, requestId: createUuidV7() } };
      const startedMs = Date.now();
      const exec = mutating ? await runIsolated(baseCtx, request) : await execBff(request, baseCtx);
      return { result: evaluate(testCase, file.moduleId, tests.page, exec, Math.max(0, Date.now() - startedMs)), response: exec.response };
    };

    // Phase A: parameterless read queries — record and harvest the seed pool.
    for (const testCase of tests.cases) {
      if (!isHarvestCase(testCase)) continue;
      const { result, response } = await runOne(testCase, {}, false);
      cases.push(result);
      if (response.ok) harvestRows(pool, response.data);
    }

    // Phase B: everything else — resolve <seedRef> from the pool; isolate mutating cases.
    for (const testCase of tests.cases) {
      if (isHarvestCase(testCase)) continue;
      if (testCase.mutating && input.skipMutating) {
        cases.push({ module: file.moduleId, page: tests.page, id: testCase.id, routine: testCase.routine, status: 'skipped', ok: false, statusCode: 0, durationMs: 0, errorCode: null, errorMessage: null, reason: 'mutating case skipped (skipMutating)' });
        continue;
      }
      const { result } = await runOne(testCase, resolveParams(testCase.params, pool), testCase.mutating);
      cases.push(result);
    }
  }

  const summary: TestRunSummary = {
    runId,
    traceId,
    startedAt,
    finishedAt: new Date().toISOString(),
    appEnv: env.appEnv,
    scope: { moduleId: input.moduleId, page: input.page },
    total: cases.length,
    passed: cases.filter(c => c.status === 'pass').length,
    failed: cases.filter(c => c.status === 'fail').length,
    skipped: cases.filter(c => c.status === 'skipped').length,
    cases,
  };
  storeRun(summary);
  return summary;
}

// ---- results ----

export function loadTestResults(input: { moduleId?: string; page?: string; runId?: string; limit?: number } = {}): { recentRuns: TestRunSummary[] } {
  return { recentRuns: getRecentRuns({ moduleId: input.moduleId, page: input.page, runId: input.runId }, input.limit ?? 20) };
}
