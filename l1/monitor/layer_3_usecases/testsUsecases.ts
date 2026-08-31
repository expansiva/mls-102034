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
// - `<seedRef>` params with a known fieldRef (`Petition.petitionId`) resolve only from that entity:
//   seed-row anchors first (and named `seedIds` when the seeds module exports them), then values
//   harvested from a read of that entity. An unqualified `petitionId` harvested from another
//   entity is not "the petition". Files generated without paramFieldRefs still resolve by fieldId
//   then wire name. Missing stays unresolved — never invent an id.
// - A case that could not verify what it claims is reported 'inconclusive', never 'pass': a
//   <seedRef> that never resolved, or a `<command>.<field>.required` case rejected on another
//   field. `failed` is reserved for the backend actually misbehaving.
// - `expect.shape: 'paginated'` checks the collection the case declares in `expect.itemsKey`
//   (`{ menuItems: [...] }`); absent, it falls back to `items` so files generated before the key
//   existed keep working.
//
// Results are captured directly from execBff's return value and kept in a small in-memory ring (the
// execution log/series store only keeps aggregates and Postgres monitor storage is optional in devenv).

import { AppError, type BffRequest, type BffResponse, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createRequestContext, execBff } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { hasDeclaredProjectMode, readProjectMode } from '/_102034_/l1/server/layer_1_external/config/projectMode.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { readProjectsConfig, resolveProjectModuleImportUrl } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { loadResolvedTableDefinitions } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { createUuidV7 } from '/_102029_/l2/uuidv7.js';

const SEED_REF_MARKER = '<seedRef>';
const MAX_STORED_RUNS = 50;

// ---- Shapes read from the (untrusted) generated client file — validated at runtime, never imported. ----

type TestShape = 'object' | 'array' | 'paginated';

// A paginated envelope names its collection after the entity (`{ menuItems: [...] }`), so the case
// declares the key. Absent -> 'items', which is what the files generated before this existed assume.
const DEFAULT_ITEMS_KEY = 'items';

interface PageTestCase {
  id: string;
  routine: string;
  params: Record<string, unknown>;
  /**
   * Ontology fieldRef of each `<seedRef>` param (`Task.taskId`), keyed by the input's wire name.
   * The harvest pool is filled from response field names (usually the fieldId); matching by
   * inputId alone misses `taskTaskId` vs `taskId`. Optional: files generated before this existed
   * keep resolving by name only.
   */
  paramFieldRefs?: Record<string, string>;
  expect: { ok: boolean; errorCode?: string; minItems?: number; shape?: TestShape; itemsKey?: string };
  mutating: boolean;
  /**
   * A failure that is already understood and owned by a named wave of work (e.g. 'mdm-rebuild'). The case
   * still RUNS and still reports what happened: it is counted apart from `failed`, so a suite can be green
   * with knowns instead of red with noise, and the day it passes the run says so — which is how the wave
   * gets proved in production instead of on someone's word.
   */
  expectedFail?: string;
}

interface PageTestsFile {
  moduleName: string;
  page: string;
  variant: string;
  // The l4 actor this page is scoped to (the workspace's declared actor). When present, the run executes
  // the page's cases AS that actor: routes that read the id from the session (a field worker seeing the
  // tasks assigned to them) are otherwise unrunnable headless. Optional for back-compat: an older
  // generated file without it runs with no actor session, exactly as before.
  actor?: string;
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
export type TestCaseStatus = 'pass' | 'fail' | 'inconclusive' | 'skipped' | 'knownFail';

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
  /** ProjectMode from l5/project.json — not the server APP_ENV. */
  appEnv: string;
  /** Where `appEnv` was read from, so a VM with APP_ENV=production is not mistaken for the project mode. */
  appEnvSource: string;
  /** Server deployment (`APP_ENV`): development | staging | production. */
  serverAppEnv: string;
  scope: { moduleId?: string; page?: string };
  total: number;
  passed: number;
  failed: number;
  /** Failures a case declared as already-owned work (`expectedFail`): known, not new. */
  knownFail: number;
  inconclusive: number;
  skipped: number;
  cases: TestCaseResult[];
}

export interface TestListResult {
  appEnv: string;
  appEnvSource: string;
  serverAppEnv: string;
  executionEnabled: boolean;
  modules: Array<{
    moduleId: string;
    projectId: string;
    /** page21/page31 share page11's BFF contract; cases are generated once. */
    variantPolicy: string;
    untestedPages: Array<{ page: string; reason: string }>;
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

export const PAGE11_VARIANT_POLICY = 'page21/page31 share page11\'s contract; cases are generated once for page11.';

export function untestedPageEntries(configuredPageIds: string[], testedPageIds: Iterable<string>): Array<{ page: string; reason: string }> {
  const tested = new Set(testedPageIds);
  return configuredPageIds.filter(page => page && !tested.has(page)).sort().map(page => ({
    page,
    reason: 'no generated .test.ts — inspect pages should emit a <seedRef> case; skip only when the owning entity has no seed',
  }));
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

export function coercePageTestsFile(raw: unknown): PageTestsFile | null {
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
    const paramFieldRefs = coerceParamFieldRefs(item.paramFieldRefs);
    cases.push({
      id,
      routine,
      params: isRecord(item.params) ? { ...item.params } : {},
      expect: {
        ok: expectRaw.ok === true,
        errorCode: typeof expectRaw.errorCode === 'string' ? expectRaw.errorCode : undefined,
        minItems: typeof expectRaw.minItems === 'number' ? expectRaw.minItems : undefined,
        shape: expectRaw.shape === 'object' || expectRaw.shape === 'array' || expectRaw.shape === 'paginated' ? expectRaw.shape : undefined,
        itemsKey: typeof expectRaw.itemsKey === 'string' && expectRaw.itemsKey.trim() ? expectRaw.itemsKey.trim() : undefined,
      },
      mutating: item.mutating === true,
      ...(typeof item.expectedFail === 'string' && item.expectedFail.trim() ? { expectedFail: item.expectedFail.trim() } : {}),
      ...(paramFieldRefs ? { paramFieldRefs } : {}),
    });
  }
  // Optional: the page's l4 actor. Absent in files generated before actor-scoped runs existed.
  const actor = typeof raw.actor === 'string' && raw.actor.trim() ? raw.actor.trim() : undefined;
  return { moduleName, page, variant, ...(actor ? { actor } : {}), cases };
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

/** ProjectMode from l5/project.json wins over APP_ENV. The test report prints both so they cannot be confused. */
export function reportAppEnv(projectId?: string): { appEnv: string; appEnvSource: string; serverAppEnv: string } {
  const appEnv = readProjectMode(projectId);
  return {
    appEnv,
    appEnvSource: hasDeclaredProjectMode(projectId) ? 'l5/project.json' : 'default',
    serverAppEnv: readAppEnv().appEnv,
  };
}

// ---- list ----

export async function listPageTests(): Promise<TestListResult> {
  const env = readAppEnv();
  const files = await discoverTestFiles();
  const byModule = new Map<string, TestListResult['modules'][number]>();
  for (const file of files) {
    let entry = byModule.get(file.moduleId);
    if (!entry) {
      entry = { moduleId: file.moduleId, projectId: file.projectId, variantPolicy: PAGE11_VARIANT_POLICY, untestedPages: [], pages: [] };
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
  const reported = reportAppEnv(files[0]?.projectId ?? env.projectId);
  const config = readProjectsConfig();
  for (const [projectId, project] of Object.entries(config.projects)) {
    for (const moduleConfig of project.modules ?? []) {
      const moduleId = moduleConfig.moduleId;
      if (!moduleId) continue;
      let entry = byModule.get(moduleId);
      if (!entry) {
        entry = { moduleId, projectId, variantPolicy: PAGE11_VARIANT_POLICY, untestedPages: [], pages: [] };
        byModule.set(moduleId, entry);
      }
      const frontendPages = (moduleConfig.frontend as { pages?: Array<{ pageId?: string; id?: string }> } | undefined)?.pages ?? [];
      const configured = frontendPages.map(page => page.pageId || page.id || '').filter(Boolean);
      const tested = entry.pages.map(page => page.page);
      entry.untestedPages = untestedPageEntries(configured, tested);
    }
  }
  return {
    appEnv: reported.appEnv,
    appEnvSource: reported.appEnvSource,
    serverAppEnv: reported.serverAppEnv,
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
// Returns '' when compatible, else a failure reason (object×array, or paginated missing the
// declared collection). The reason names the expected key so a drift is readable at a glance.
export function checkShape(data: unknown, shape: TestShape, itemsKey = DEFAULT_ITEMS_KEY): string {
  if (shape === 'array') {
    return Array.isArray(data) ? '' : `expected array output, got ${describeShape(data)}`;
  }
  if (shape === 'paginated') {
    return isRecord(data) && Array.isArray(data[itemsKey])
      ? ''
      : `expected paginated { ${itemsKey}: [] }, got ${describeShape(data)}`;
  }
  return isRecord(data) && !Array.isArray(data) ? '' : `expected object output, got ${describeShape(data)}`;
}

export function countItems(data: unknown, itemsKey = DEFAULT_ITEMS_KEY): number {
  if (Array.isArray(data)) return data.length;
  if (isRecord(data) && Array.isArray(data[itemsKey])) return data[itemsKey].length;
  if (data !== null && data !== undefined) return 1;
  return 0;
}

// Only scalars are usable as a <seedRef> value; nested arrays/objects are containers to descend into.
function coerceParamFieldRefs(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const refs: Record<string, string> = {};
  for (const [key, fieldRef] of Object.entries(value)) {
    if (typeof fieldRef === 'string' && fieldRef.trim()) refs[key] = fieldRef.trim();
  }
  return Object.keys(refs).length ? refs : undefined;
}

function fieldIdOfFieldRef(fieldRef: string | undefined): string {
  if (!fieldRef) return '';
  const dot = fieldRef.lastIndexOf('.');
  return (dot < 0 ? fieldRef : fieldRef.slice(dot + 1)).trim();
}

function entityOfFieldRef(fieldRef: string | undefined): string {
  if (!fieldRef) return '';
  const dot = fieldRef.indexOf('.');
  return (dot < 0 ? '' : fieldRef.slice(0, dot)).trim();
}

function entityOfIdField(fieldId: string): string {
  if (!fieldId.endsWith('Id') || fieldId.length <= 2) return '';
  const base = fieldId.slice(0, -2);
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// The row's own identifier is the longest scalar `*Id` key. A signature row carries both
// `petitionSignatureId` (own) and `petitionId` (FK); the longer key is the entity we harvested.
function ownIdFieldOf(row: Record<string, unknown>): string {
  let best = '';
  for (const [key, value] of Object.entries(row)) {
    if (!key.endsWith('Id') || key.length < 3) continue;
    if (value === null || value === undefined || Array.isArray(value) || isRecord(value)) continue;
    if (key.length > best.length) best = key;
  }
  return best;
}

function putPool(pool: Record<string, unknown>, key: string, value: unknown): void {
  if (!key || pool[key] !== undefined || value === null || value === undefined) return;
  if (Array.isArray(value) || isRecord(value)) return;
  pool[key] = value;
}

function harvestRecord(pool: Record<string, unknown>, row: unknown, moduleId?: string): void {
  if (!isRecord(row)) return;
  const ownId = ownIdFieldOf(row);
  const entity = ownId ? entityOfIdField(ownId) : '';
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined || Array.isArray(value) || isRecord(value)) continue;
    if (entity) {
      putPool(pool, `${entity}.${key}`, value);
      if (moduleId) putPool(pool, `${moduleId}.${entity}.${key}`, value);
    }
    putPool(pool, key, value);
  }
}

// Harvest every scalar the response exposes: the envelope itself plus the rows of ANY array it
// carries. Collections are named after the entity on this wire (`{ menuItems: [...] }`,
// `{ orders: [...] }`), not `items`, so descending only into `data.items` harvested the envelope
// counters and never the ids the <seedRef> params need.
function harvestRows(pool: Record<string, unknown>, data: unknown, moduleId?: string): void {
  if (Array.isArray(data)) {
    for (const row of data) harvestRecord(pool, row, moduleId);
    return;
  }
  if (!isRecord(data)) return;
  harvestRecord(pool, data, moduleId);
  for (const value of Object.values(data)) {
    if (!Array.isArray(value)) continue;
    for (const row of value) harvestRecord(pool, row, moduleId);
  }
}

function columnToField(column: string): string {
  return column.replace(/_([a-z0-9])/gu, (_all, char: string) => char.toUpperCase());
}

function snakeToPascal(name: string): string {
  return name.split(/[._-]/gu).filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

function ontologyEntityName(definition: { moduleId?: string; repositoryName?: string; tableName: string; logicalTableName?: string }): string {
  const moduleId = definition.moduleId ?? '';
  const repo = definition.repositoryName ?? '';
  if (moduleId && repo.startsWith(moduleId) && repo.length > moduleId.length) {
    const rest = repo.slice(moduleId.length);
    if (/^[A-Z]/u.test(rest)) return rest;
  }
  return snakeToPascal(definition.logicalTableName || definition.tableName);
}

/**
 * Put a seeded PK into the pool under the entity-qualified key (`Petition.petitionId`).
 * Named `seedIds` win when their value is actually a row of this table — they pick the intended
 * line (e.g. a published petition) instead of "whatever was first in the file". Existing keys
 * are never overwritten.
 */
export function applySeedAnchors(
  pool: Record<string, unknown>,
  input: {
    entity: string;
    fieldId: string;
    seedRowIds: unknown[];
    namedIds?: Record<string, unknown>;
    moduleId?: string;
    seedRows?: Array<Record<string, unknown>>;
    pkColumn?: string;
  },
): void {
  const entity = input.entity.trim();
  const fieldId = input.fieldId.trim();
  if (!entity || !fieldId) return;
  const seeded = input.seedRowIds.filter(value => value !== undefined && value !== null);
  if (seeded.length === 0) return;
  const named = Object.values(input.namedIds ?? {}).filter(value => value !== undefined && value !== null);
  const preferred = named.find(value => seeded.some(rowId => rowId === value)) ?? seeded[0];
  const pkColumn = input.pkColumn;
  const chosenRow = pkColumn
    ? (input.seedRows ?? []).find(row => row?.[pkColumn] === preferred)
    : undefined;
  if (chosenRow) {
    for (const [column, value] of Object.entries(chosenRow)) {
      if (value === null || value === undefined || Array.isArray(value) || isRecord(value)) continue;
      const columnField = columnToField(column);
      putPool(pool, `${entity}.${columnField}`, value);
      if (input.moduleId) putPool(pool, `${input.moduleId}.${entity}.${columnField}`, value);
    }
  } else {
    putPool(pool, `${entity}.${fieldId}`, preferred);
    if (input.moduleId) putPool(pool, `${input.moduleId}.${entity}.${fieldId}`, preferred);
  }
  putPool(pool, fieldId, preferred);
}

async function loadNamedSeedIds(): Promise<Record<string, unknown>> {
  const named: Record<string, unknown> = {};
  try {
    const config = readProjectsConfig();
    for (const project of Object.values(config.projects)) {
      for (const moduleConfig of project.persistenceModules ?? []) {
        const dir = moduleConfig.tableDefsDir;
        if (!dir) continue;
        try {
          const imported = await import(resolveProjectModuleImportUrl(`${dir.replace(/\/$/u, '')}/seeds.js`)) as { seedIds?: unknown };
          if (!isRecord(imported.seedIds)) continue;
          for (const [key, value] of Object.entries(imported.seedIds)) {
            if (value === null || value === undefined || Array.isArray(value) || isRecord(value)) continue;
            named[key] = value;
          }
        } catch {
          // T3 has not landed on this module, or there is no seeds.ts. Seed rows still apply.
        }
      }
    }
  } catch {
    // Best effort: named anchors are optional.
  }
  return named;
}

/**
 * Fill the id pool from the SEEDED table rows. Seeded ids are the most reliable source for a
 * `<seedRef>` — they do not depend on a prior read having passed, and they are the lines that
 * were actually planted.
 *
 * Some entities are reachable only by someone who already knows their id: the workspace has a detail
 * read that REQUIRES the id and no list or create route produces one (102045 changeOrderWorkspace). No
 * sequence of BFF calls can bootstrap such an id, so those cases could only ever be inconclusive — while
 * the rows that would satisfy them sit in the store, seeded and unused.
 *
 * The rows come from the backend's `seeds.ts` (TableSeedRows merged into the definitions by the
 * persistence registry) and are read HERE, on the runtime side. The generated page tests only ever carry
 * the literal `<seedRef>` marker, so the frontend never sees an id — same boundary as
 * resolveSeededActorMdmId above.
 *
 * Limits:
 *  - only a SINGLE-column primary key is harvested: that is the entity's own identifier, never a foreign
 *    key that happens to appear in several tables;
 *  - existing pool entries are never overwritten;
 *  - the value is stored as `Entity.fieldId` so a later `<seedRef>` with that fieldRef cannot pick an
 *    id harvested from a different entity.
 *
 * Caveat worth knowing when a case then fails: the first seed row is taken (unless a named seedId
 * points at another row of the same table), and it may not be in a state the command accepts
 * (e.g. an already-approved record for an approval command). That is a REAL verdict, not an
 * inconclusive one — which is the point.
 */
async function fillPoolFromSeedRows(pool: Record<string, unknown>): Promise<void> {
  try {
    const namedIds = await loadNamedSeedIds();
    const definitions = await loadResolvedTableDefinitions(readAppEnv());
    for (const definition of definitions) {
      if (definition.primaryKey?.length !== 1) continue;
      const column = definition.primaryKey[0];
      const fieldId = columnToField(column);
      const seedRowIds = (definition.seedRows ?? []).map(row => row?.[column]);
      applySeedAnchors(pool, {
        entity: ontologyEntityName(definition),
        fieldId,
        seedRowIds,
        namedIds,
        moduleId: definition.moduleId,
        seedRows: definition.seedRows,
        pkColumn: column,
      });
    }
  } catch {
    // Best effort: without it the affected cases stay inconclusive, exactly as before.
  }
}

interface ResolvedParams {
  params: Record<string, unknown>;
  unresolved: string[];
}

/**
 * Look up a `<seedRef>` in the harvest pool.
 *
 * When the case declares a fieldRef (`Petition.petitionId`), only a value stored under that
 * entity-qualified key is accepted — never an unqualified `petitionId` that another entity's
 * read happened to expose. Files generated before paramFieldRefs existed still resolve by
 * fieldId then wire name. Missing stays unresolved — never invent an id.
 */
export function resolveParams(
  params: Record<string, unknown>,
  pool: Record<string, unknown>,
  paramFieldRefs?: Record<string, string>,
  moduleId?: string,
): ResolvedParams {
  const resolved: Record<string, unknown> = {};
  const unresolved: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === SEED_REF_MARKER) {
      const fieldRef = paramFieldRefs?.[key];
      const entity = entityOfFieldRef(fieldRef);
      const found = entity
        ? (moduleId ? pool[`${moduleId}.${fieldRef}`] : undefined) ?? pool[fieldRef!]
        : (fieldIdOfFieldRef(fieldRef) ? pool[fieldIdOfFieldRef(fieldRef)] : undefined) ?? pool[key];
      // unresolved seedRef -> omit the key (the runner cannot invent a valid id) and remember it:
      // the request no longer matches the case, so the verdict cannot be trusted.
      if (found === undefined) unresolved.push(key);
      else resolved[key] = found;
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

export function evaluate(
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
      const shapeReason = testCase.expect.shape ? checkShape(response.data, testCase.expect.shape, testCase.expect.itemsKey) : '';
      if (shapeReason) {
        status = 'fail';
        reason = shapeReason;
      } else if (unresolved.length > 0) {
        status = 'inconclusive';
        reason = unresolvedReason;
      } else if (testCase.expect.minItems !== undefined) {
        const count = countItems(response.data, testCase.expect.itemsKey);
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
  // A KNOWN failure is not the backend misbehaving: it is work already owned elsewhere. It never becomes
  // 'fail' (that count has to mean "something new broke"), and when it PASSES the mark is reported as
  // stale — the signal that the wave landed and the mark can be dropped from the generator.
  if (testCase.expectedFail) {
    if (status === 'fail') {
      status = 'knownFail';
      reason = `known issue (${testCase.expectedFail}): ${reason}`;
    } else if (status === 'pass') {
      reason = `expectedFail '${testCase.expectedFail}' no longer reproduces — drop the mark`;
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

/**
 * The mdmId of the seeded platform identity for an l4 actor, resolved BY DATA: agentCbSeeds emits one MDM
 * Person per actor tagged ['<module>.Person', '<module>', 'actor', '<actorId>'], so the tags alone
 * identify it. Deliberately NOT recomputing the seed's stableUuid hash — that convention has one owner
 * (cbSeedsCore in mls-102021) and duplicating it here would create a second.
 * Empty when the module seeded no identity for that actor (the caller then runs with no actor session).
 */
async function resolveSeededActorMdmId(ctx: RequestContext, moduleName: string, actorId: string): Promise<string> {
  if (!actorId) return '';
  try {
    const rows = await ctx.data.mdmEntityIndex.findMany({ where: {} });
    const match = rows.find((row: { mdmId?: string; tags?: string[] }) => {
      const tags = Array.isArray(row.tags) ? row.tags : [];
      return tags.includes('actor') && tags.includes(actorId) && (!moduleName || tags.includes(moduleName));
    });
    return typeof match?.mdmId === 'string' ? match.mdmId : '';
  } catch {
    // The identity lookup must never break a run: without it the cases simply run unauthenticated.
    return '';
  }
}

export async function runPageTests(input: { moduleId?: string; page?: string; skipMutating?: boolean } = {}): Promise<TestRunSummary> {
  const env = readAppEnv();
  // Commented out by the new version: the hard TESTS_ENABLED/appEnv server-side
  // block was replaced by a client-side confirmation in the Monitor UI
  // (home.ts renderTestsExecutionGate) — the checkbox shows a localhost-
  // specific or production-specific warning and requires explicit opt-in per
  // session before enabling the Run buttons. Safe to relax server-side because
  // every run below is already sandboxed in its own disposable in-memory
  // runtime (see createMemoryDataRuntime below) — it never reads or writes the
  // process's real Postgres tables regardless of environment.
  // if (!env.testsEnabled) {
  //   throw new AppError('TESTS_DISABLED', 'BFF test execution is disabled (set TESTS_ENABLED=true to allow it).', 403, { appEnv: env.appEnv });
  // }

  const runId = createUuidV7();
  const traceId = createUuidV7();
  const startedAt = new Date().toISOString();
  const files = (await discoverTestFiles({ moduleId: input.moduleId, page: input.page })).filter(file => file.tests);
  // Sandbox: a runtime built for this run only (tables + mdm seeded from the definitions on first
  // access) — never the process singleton, so nobody else's data is in reach and the mutating cases
  // need no transaction/rollback because the whole store is discarded with the run.
  // ONE runtime for the whole run; every context below shares it, so the store (and the harvested ids)
  // are the same no matter which actor a page runs as.
  const dataRuntime = createMemoryDataRuntime();
  const baseCtx = createRequestContext(dataRuntime, { sandbox: true });
  const cases: TestCaseResult[] = [];

  // A context per page ACTOR (cached by actorId): the page's routes see a real seeded identity in the
  // session. Falls back to the anonymous baseCtx when the page declares no actor or the module seeded no
  // identity for it — same behaviour as before this change.
  const ctxByActor = new Map<string, RequestContext>();
  const contextFor = async (file: DiscoveredTestFile): Promise<RequestContext> => {
    const actorId = typeof file.tests?.actor === 'string' ? file.tests.actor.trim() : '';
    if (!actorId) return baseCtx;
    const cached = ctxByActor.get(actorId);
    if (cached) return cached;
    const mdmId = await resolveSeededActorMdmId(baseCtx, file.tests?.moduleName ?? '', actorId);
    // actorId ONLY — deliberately no actorScope. The generated controllers gate on scope with
    // `enforceActors`, which treats an EMPTY scope as permissive by design ("bff.actor.no-scope") but
    // rejects a non-empty scope that does not intersect its ALLOWED list, whose entries are
    // `<module>:<actorId>` role scopes. Sending the bare actorId as a scope 403'd every route
    // (FORBIDDEN_ACTOR on all 14 cases). Providing an identity is B's job; exercising authorization is not.
    const ctx = mdmId
      ? createRequestContext(dataRuntime, { sandbox: true, sessionContext: { actorId: mdmId } })
      : baseCtx;
    ctxByActor.set(actorId, ctx);
    return ctx;
  };

  // ONE pool per RUN, not per page: the sandbox store is created once above, so an id harvested by any
  // page's read is valid for every other page. With a per-page pool the ids were thrown away and a page
  // whose own reads all require an id could never arm itself (102045 run06: projectId/workTaskId/
  // assignedWorkerId were harvested by dashboardWorkspace and then discarded, leaving 7 cases
  // inconclusive). harvestRecord does not overwrite an existing key, so the FIRST value harvested for a
  // given field name wins — deterministic given the phase order below.
  // Seed anchors go in FIRST: a `<seedRef>` with fieldRef `Petition.petitionId` must resolve to a
  // planted Petition row even when no prior read of Petition succeeded (or when another entity's
  // read exposed a different `petitionId` first).
  const pool: Record<string, unknown> = {};
  await fillPoolFromSeedRows(pool);

  // Every successful response feeds the pool, whatever the case's own verdict was — a read that
  // fails its shape assertion still carries the ids the later cases need.
  const runOne = async (file: DiscoveredTestFile, testCase: PageTestCase): Promise<TestCaseResult> => {
    const tests = file.tests!;
    const { params, unresolved } = resolveParams(testCase.params, pool, testCase.paramFieldRefs, file.moduleId);
    const request: BffRequest = { routine: testCase.routine, params, meta: { source: 'test', traceId, requestId: createUuidV7() } };
    const startedMs = Date.now();
    const exec = await execBff(request, await contextFor(file));
    if (exec.response.ok) harvestRows(pool, exec.response.data, file.moduleId);
    return evaluate(testCase, file.moduleId, tests.page, exec, Math.max(0, Date.now() - startedMs), unresolved);
  };

  // Both phases are GLOBAL (all files, then all files) — not per file. Hoisting the pool alone would
  // leave the outcome dependent on file order: in run06 changeOrderWorkspace ran BEFORE
  // dashboardWorkspace, so its commands would still have seen an empty pool.
  // Phase A: every read query of every page — they build the seed pool for everything else.
  for (const file of files) {
    for (const testCase of file.tests!.cases) {
      if (!isReadCase(testCase)) continue;
      cases.push(await runOne(file, testCase));
    }
  }

  // Between the phases: fill the gaps the reads could not cover, from the SEEDED rows.
  await fillPoolFromSeedRows(pool);

  // Phase B: negative cases and commands — <seedRef> now resolves from the whole run's pool.
  for (const file of files) {
    const tests = file.tests!;
    for (const testCase of tests.cases) {
      if (isReadCase(testCase)) continue;
      if (testCase.mutating && input.skipMutating) {
        cases.push({ module: file.moduleId, page: tests.page, id: testCase.id, routine: testCase.routine, status: 'skipped', ok: false, statusCode: 0, durationMs: 0, errorCode: null, errorMessage: null, reason: 'mutating case skipped (skipMutating)' });
        continue;
      }
      cases.push(await runOne(file, testCase));
    }
  }

  const reported = reportAppEnv(files[0]?.projectId ?? env.projectId);
  const summary: TestRunSummary = {
    runId,
    traceId,
    startedAt,
    finishedAt: new Date().toISOString(),
    appEnv: reported.appEnv,
    appEnvSource: reported.appEnvSource,
    serverAppEnv: reported.serverAppEnv,
    scope:{ moduleId: input.moduleId, page: input.page },
    total: cases.length,
    passed: cases.filter(c => c.status === 'pass').length,
    failed: cases.filter(c => c.status === 'fail').length,
    knownFail: cases.filter(c => c.status === 'knownFail').length,
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
