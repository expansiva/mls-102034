/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/testsUsecases.ts" enhancement="_blank" />
// Item 2c — devenv BFF test runner.
// Discovers the generated page11 `<page>.test.ts` files from config.json (modules[].frontend.pageTests),
// then runs each declarative case through the SAME real pipeline the HTTP transport uses (execBff:
// resolve routine -> controller -> usecase -> adapter), with source='test'. Nothing is faked, so the
// composition root, tables and seeds are all exercised together.
//
// Isolation & environment:
// - `runPageTests` only executes when TESTS_ENABLED is on (default: appEnv === 'development'), else
//   403 TESTS_DISABLED. `list`/`results` run everywhere (history/inspection).
// - EVERY run gets its OWN disposable in-memory runtime — never the process singleton. Tables and
//   mdm are rebuilt from the seed rows on first access and thrown away with the run, so the run is
//   deterministic and cannot touch data anyone else is using: production Postgres on a VM, or the
//   store behind a developer's live preview in devenv. That is also why the mutating cases need no
//   transaction/rollback (the memory runtime has no real rollback anyway). `skipMutating` still
//   reports them as 'skipped' when the caller does not want them executed at all.
// - `<seedRef>` params are resolved from a pool harvested by first running the page's read queries
//   (phase A) — every scalar of every response, including the rows of any array it carries — so a
//   validation case's only wrong input is the omitted required field.
// - A case that could not verify what it claims is reported 'inconclusive', never 'pass': a
//   <seedRef> that never resolved, or a `<command>.<field>.required` case rejected on another
//   field. `failed` is reserved for the backend actually misbehaving.
//
// Results are captured directly from execBff's return value and kept in a small in-memory ring (the
// execution log/series store only keeps aggregates and Postgres monitor storage is optional in devenv).

import { AppError, type BffRequest, type BffResponse } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createRequestContext, execBff } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
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

// 'inconclusive' = the case could not verify what it claims (a <seedRef> param never resolved, or a
// `<command>.<field>.required` case was rejected on a different field). It is NOT an app defect —
// keeping it out of `failed` is what makes the failed count mean "the backend misbehaved".
export type TestCaseStatus = 'pass' | 'fail' | 'inconclusive' | 'skipped';

export interface TestCaseResult {
  module: string;
  page: string;
  id: string;
  routine: string;
  status: TestCaseStatus;
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
  inconclusive: number;
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
    executionEnabled: env.testsEnabled,
    modules: [...byModule.values()],
    recentRuns: getRecentRuns({}, 10),
  };
}

// ---- run ----

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

// Only scalars are usable as a <seedRef> value; nested arrays/objects are containers to descend into.
function harvestRecord(pool: Record<string, unknown>, row: unknown): void {
  if (!isRecord(row)) return;
  for (const [key, value] of Object.entries(row)) {
    if (pool[key] !== undefined || value === null || value === undefined) continue;
    if (Array.isArray(value) || isRecord(value)) continue;
    pool[key] = value;
  }
}

// Harvest every scalar the response exposes: the envelope itself plus the rows of ANY array it
// carries. Collections are named after the entity on this wire (`{ menuItems: [...] }`,
// `{ orders: [...] }`), not `items`, so descending only into `data.items` harvested the envelope
// counters and never the ids the <seedRef> params need.
function harvestRows(pool: Record<string, unknown>, data: unknown): void {
  if (Array.isArray(data)) {
    for (const row of data) harvestRecord(pool, row);
    return;
  }
  if (!isRecord(data)) return;
  harvestRecord(pool, data);
  for (const value of Object.values(data)) {
    if (!Array.isArray(value)) continue;
    for (const row of value) harvestRecord(pool, row);
  }
}

interface ResolvedParams {
  params: Record<string, unknown>;
  unresolved: string[];
}

function resolveParams(params: Record<string, unknown>, pool: Record<string, unknown>): ResolvedParams {
  const resolved: Record<string, unknown> = {};
  const unresolved: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === SEED_REF_MARKER) {
      // unresolved seedRef -> omit the key (the runner cannot invent a valid id) and remember it:
      // the request no longer matches the case, so the verdict cannot be trusted.
      if (pool[key] === undefined) unresolved.push(key);
      else resolved[key] = pool[key];
    } else {
      resolved[key] = value;
    }
  }
  return { params: resolved, unresolved };
}

// A non-mutating success case is a read query — run first so its output feeds the seed pool that
// resolves <seedRef> for the remaining cases.
function isReadCase(testCase: PageTestCase): boolean {
  return testCase.expect.ok && !testCase.mutating;
}

// Negative cases are generated as `<command>.<field>.required`. The case only proves what it claims
// when the rejection names that field; rejected on another field it never reached the field at all.
function fieldUnderTest(testCase: PageTestCase): string | null {
  const parts = testCase.id.split('.');
  return parts.length >= 3 && parts[parts.length - 1] === 'required' ? parts[parts.length - 2] : null;
}

function rejectedField(response: BffResponse): string | null {
  const details = response.error?.details;
  if (isRecord(details) && typeof details.field === 'string') return details.field;
  const match = /^([A-Za-z0-9_]+) is required/u.exec(response.error?.message ?? '');
  return match ? match[1] : null;
}

function evaluate(
  testCase: PageTestCase,
  module: string,
  page: string,
  exec: { response: BffResponse; statusCode: number },
  durationMs: number,
  unresolved: string[],
): TestCaseResult {
  const { response, statusCode } = exec;
  let status: TestCaseStatus = 'pass';
  let reason = '';
  const unresolvedReason = `unverifiable: <seedRef> not resolved for ${unresolved.join(', ')} (param omitted from the request)`;
  if (testCase.expect.ok) {
    if (!response.ok) {
      // The omitted params are the likely cause of the rejection — the case never ran as written.
      status = unresolved.length > 0 ? 'inconclusive' : 'fail';
      reason = unresolved.length > 0 ? unresolvedReason : `expected ok, got error ${response.error?.code ?? 'unknown'}`;
    } else {
      // The output shape does not depend on the inputs, so a mismatch is real drift either way.
      const shapeReason = testCase.expect.shape ? checkShape(response.data, testCase.expect.shape) : '';
      if (shapeReason) {
        status = 'fail';
        reason = shapeReason;
      } else if (unresolved.length > 0) {
        status = 'inconclusive';
        reason = unresolvedReason;
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
  } else {
    const expectedField = fieldUnderTest(testCase);
    const actualField = expectedField ? rejectedField(response) : null;
    if (expectedField && actualField !== expectedField) {
      status = 'inconclusive';
      reason = actualField
        ? `unverifiable: rejected on '${actualField}', not on the field under test '${expectedField}'`
        : `unverifiable: rejection does not name the field under test '${expectedField}'`;
    } else if (unresolved.length > 0) {
      status = 'inconclusive';
      reason = unresolvedReason;
    }
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
  if (!env.testsEnabled) {
    throw new AppError('TESTS_DISABLED', 'BFF test execution is disabled (set TESTS_ENABLED=true to allow it).', 403, { appEnv: env.appEnv });
  }

  const runId = createUuidV7();
  const traceId = createUuidV7();
  const startedAt = new Date().toISOString();
  const files = (await discoverTestFiles({ moduleId: input.moduleId, page: input.page })).filter(file => file.tests);
  // Sandbox: a runtime built for this run only (tables + mdm seeded from the definitions on first
  // access) — never the process singleton, so nobody else's data is in reach and the mutating cases
  // need no transaction/rollback because the whole store is discarded with the run.
  const baseCtx = createRequestContext(createMemoryDataRuntime(), { sandbox: true });
  const cases: TestCaseResult[] = [];

  for (const file of files) {
    const tests = file.tests!;
    const pool: Record<string, unknown> = {};

    // Every successful response feeds the pool, whatever the case's own verdict was — a read that
    // fails its shape assertion still carries the ids the later cases need.
    const runOne = async (testCase: PageTestCase): Promise<TestCaseResult> => {
      const { params, unresolved } = resolveParams(testCase.params, pool);
      const request: BffRequest = { routine: testCase.routine, params, meta: { source: 'test', traceId, requestId: createUuidV7() } };
      const startedMs = Date.now();
      const exec = await execBff(request, baseCtx);
      if (exec.response.ok) harvestRows(pool, exec.response.data);
      return evaluate(testCase, file.moduleId, tests.page, exec, Math.max(0, Date.now() - startedMs), unresolved);
    };

    // Phase A: the read queries — they build the seed pool for everything else.
    for (const testCase of tests.cases) {
      if (!isReadCase(testCase)) continue;
      cases.push(await runOne(testCase));
    }

    // Phase B: negative cases and commands — <seedRef> now resolves from the pool.
    for (const testCase of tests.cases) {
      if (isReadCase(testCase)) continue;
      if (testCase.mutating && input.skipMutating) {
        cases.push({ module: file.moduleId, page: tests.page, id: testCase.id, routine: testCase.routine, status: 'skipped', ok: false, statusCode: 0, durationMs: 0, errorCode: null, errorMessage: null, reason: 'mutating case skipped (skipMutating)' });
        continue;
      }
      cases.push(await runOne(testCase));
    }
  }

  const summary: TestRunSummary = {
    runId,
    traceId,
    startedAt,
    finishedAt: new Date().toISOString(),
    appEnv: env.appEnv,
    scope:{ moduleId: input.moduleId, page: input.page },
    total: cases.length,
    passed: cases.filter(c => c.status === 'pass').length,
    failed: cases.filter(c => c.status === 'fail').length,
    inconclusive: cases.filter(c => c.status === 'inconclusive').length,
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
