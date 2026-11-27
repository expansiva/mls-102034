/// <mls fileReference="_102034_/l1/workflow/assistantCatalogDefs.ts" enhancement="_blank"/>
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolveProjectsPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { ASSISTANT_CATALOG_SCHEMA, type AssistantCatalogItem } from '/_102034_/l1/workflow/assistantCatalog.js';
import { inputsOfRoute, readOntologyEntity, returnsOnlyOptions, type CatalogInput, type OntologyEntity } from '/_102034_/l1/workflow/assistantCatalogInputs.js';
import { parseContractSource, type AsContractRoute, type AsTypeNode } from '/_102034_/l1/workflow/assistantContractSource.js';

/**
 * The assistant catalog of one module, assembled from the defs the release carries (`dist/local/_<app>_/`): requests,
 * use cases, controllers, authority map, outbound events, L1 workflows, the L4 of the module (when the release has it),
 * `l5/project.json` (live routes), `l5/config.json` (page addresses), the shared pages (record param, journey steps) and
 * the L2 contract sources (inputs, options-only queries).
 * It is a function of the release: no emitted file, no module name, nothing derived that can be stale.
 */
export interface DefsReader {
  /** Sorted `*.defs.js` names of a folder of the app's dist (relative to `_<app>_/`); `[]` when the folder is absent. */
  list(folder: string): string[];
  /** One export (`definition`, or `default` for L4) of a dist file; `undefined` when the file is absent; throws when it cannot be read. */
  read(file: string, exportName: 'definition' | 'default'): Promise<unknown | undefined>;
  /** A JSON file of the dist; `undefined` when absent. */
  json(file: string): unknown | undefined;
  /** A text file of the dist (the L2 contract sources); `undefined` when absent. */
  text(file: string): string | undefined;
}

type Rec = Record<string, unknown>;
type Risk = 'read' | 'write' | 'sensitive';

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function rec(value: unknown): Rec {
  return isRec(value) ? value : {};
}
function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function strs(value: unknown): string[] {
  return arr(value).map(str).filter((item) => item !== '');
}
function dataOf(definition: unknown): Rec {
  return rec(rec(definition).data);
}

/** The reader of the running release: dist files only, never the source fallback. */
let defsSourceFallback = false;

/** Test only (the cm bench with `projectRoot`): a release folder that is missing is read from the source of the project instead. Off by default. */
export function setDefsSourceFallbackForTests(enabled: boolean): void {
  defsSourceFallback = enabled;
}

export function distDefsReader(projectId: string): DefsReader {
  const distPath = (file: string): string => {
    const dist = resolveProjectsPath(`dist/local/_${projectId}_/${file}`);
    if (!defsSourceFallback || existsSync(dist)) return dist;
    const source = resolveProjectsPath(`mls-${projectId}/${file}`);
    return [source, source.replace(/\.js$/u, '.ts')].find((candidate) => existsSync(candidate)) ?? dist;
  };
  return {
    list(folder) {
      const dir = distPath(folder);
      return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.defs.js') || (defsSourceFallback && name.endsWith('.defs.ts'))).sort() : [];
    },
    async read(file, exportName) {
      const path = distPath(file);
      if (!existsSync(path)) return undefined;
      const loaded = (await import(pathToFileURL(path).href)) as Rec;
      return loaded[exportName];
    },
    json(file) {
      const path = distPath(file);
      return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as unknown) : undefined;
    },
    text(file) {
      const path = distPath(file);
      return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
    },
  };
}

interface UsecaseFacts {
  entityId: string;
  operation: string;
  transitionRef: string;
  hasEffects: boolean;
}

interface JourneyStep {
  key: string;
  kind: string;
  entity: string;
  effect: string;
  transitionRef: string;
  title: string;
}

interface TaskNode {
  kind: string;
  next: string[];
}

interface Facts {
  usecases: Map<string, UsecaseFacts>;
  actorsOfRoute: Map<string, string[]>;
  ontology: Map<string, OntologyEntity>;
  contracts: Map<string, { route: AsContractRoute; types: Record<string, AsTypeNode> }>;
  outbound: Set<string>;
  operationSteps: Map<string, string[]>;
  tasks: Map<string, TaskNode>;
  tasksOfJourney: Map<string, string[]>;
  steps: JourneyStep[];
  finals: Map<string, { transitions: Map<string, { to: string; final: boolean }> }>;
  hasL4: boolean;
  config: unknown;
  shared: Map<string, Rec>;
}

/** The subject of an action that is not about any entity; the screens label it by the i18n. */
const GENERAL_SUBJECT = 'general';

interface RequestFacts {
  route: string;
  kind: 'cmd' | 'qry';
  pageId: string;
  requestId: string;
  uses: string[];
  purpose: string;
  /** Entity the request acts on or returns, `''` when unknown. */
  entity: string;
  writeUsecases: string[];
  /** Paging params of a query: the caller sends the first page, they are not inputs. */
  pagingParams: string[];
}

async function readEach(
  reader: DefsReader,
  folder: string,
  exportName: 'definition' | 'default',
  issues: string[],
): Promise<{ ok: unknown[]; failed: number }> {
  const names = reader.list(folder);
  const settled = await Promise.all(names.map(async (name) => {
    try {
      return { value: await reader.read(`${folder}/${name}`, exportName) };
    } catch (error) {
      issues.push(`DEF_UNREADABLE: ${folder}/${name}: ${error instanceof Error ? error.message : String(error)}`);
      return { value: undefined, failed: true };
    }
  }));
  return {
    ok: settled.filter((item) => item.value !== undefined).map((item) => item.value),
    failed: settled.filter((item) => 'failed' in item).length,
  };
}

function liveRoutes(project: unknown, moduleId: string): string[] {
  const entry = arr(rec(project).modules).map(rec).find((item) => str(item.moduleName) === moduleId);
  return strs(rec(entry?.backend).routeKeys);
}

function pageAddress(config: unknown, projectId: string, moduleId: string, pageId: string): string {
  const moduleNode = arr(rec(rec(rec(config).projects)[projectId]).modules).map(rec).find((item) => str(item.moduleId) === moduleId);
  if (!moduleNode) return '';
  const page = arr(rec(moduleNode.frontend).pages).map(rec).find((item) => str(item.pageId) === pageId);
  const fromPage = str(page?.route);
  if (fromPage) return fromPage;
  return str(arr(moduleNode.navigation).map(rec).find((item) => str(item.id) === pageId)?.href);
}

/** The one param that comes only from the url is the record the page opens. */
function recordParam(shared: Rec | undefined): string | undefined {
  const params = rec(rec(shared?.entry).params);
  const names = Object.keys(params).filter((name) => {
    const sources = strs(rec(params[name]).sources);
    return sources.length === 1 && sources[0] === 'url';
  });
  return names.length === 1 ? names[0] : undefined;
}

function finalStatesOf(ontology: Rec): Set<string> {
  const from = new Set<string>();
  const transitions = arr(ontology.transitions).map(rec);
  for (const transition of transitions) for (const state of strs(transition.from)) from.add(state);
  const finals = new Set<string>();
  for (const state of arr(ontology.lifecycleStates).map((item) => str(rec(item).state))) if (state && !from.has(state)) finals.add(state);
  for (const transition of transitions) {
    const to = str(transition.to);
    if (to && !from.has(to)) finals.add(to);
  }
  return finals;
}

function writeUsecaseIds(uses: string[], usecases: Map<string, UsecaseFacts>): string[] {
  return uses.filter((id) => {
    const facts = usecases.get(id);
    return !facts || (facts.operation !== 'list' && facts.operation !== 'get');
  });
}

function actionKey(facts: UsecaseFacts): string {
  if (facts.operation === 'transition') return facts.transitionRef ? `${facts.entityId}.${facts.transitionRef}` : '';
  return `${facts.entityId}.${facts.operation}`;
}

function reachesLlm(key: string, facts: Facts): boolean {
  const queue: string[] = [];
  for (const step of facts.operationSteps.get(key) ?? []) {
    if (step.startsWith('task:')) queue.push(step.slice('task:'.length));
    else if (step.startsWith('journey:')) {
      const ref = step.slice('journey:'.length);
      queue.push(...(facts.tasksOfJourney.get(ref.split('/')[0]) ?? []));
    }
  }
  const seen = new Set<string>();
  while (queue.length > 0) {
    const taskId = queue.shift();
    if (taskId === undefined || seen.has(taskId)) continue;
    seen.add(taskId);
    const task = facts.tasks.get(taskId);
    if (!task) continue;
    if (task.kind === 'llm') return true;
    queue.push(...task.next);
  }
  return false;
}

/** Sensitive when the use case deletes, ends a lifecycle, has effects, publishes outside, reaches an LLM, or cannot be classified. */
function riskOfCommand(request: RequestFacts, facts: Facts): Risk {
  if (request.writeUsecases.length !== 1) return 'sensitive';
  const usecase = facts.usecases.get(request.writeUsecases[0]);
  if (!usecase || !usecase.entityId || !['create', 'update', 'transition', 'delete'].includes(usecase.operation)) return 'sensitive';
  if (usecase.operation === 'delete' || usecase.hasEffects) return 'sensitive';
  if (usecase.operation === 'transition') {
    const target = facts.finals.get(usecase.entityId)?.transitions.get(usecase.transitionRef);
    if (facts.hasL4 && (!target || target.final)) return 'sensitive';
  }
  const key = actionKey(usecase);
  return key && (facts.outbound.has(key) || reachesLlm(key, facts)) ? 'sensitive' : 'write';
}

function stepsOnPage(shared: Rec | undefined): string[] {
  return arr(shared?.journeys).map((item) => str(rec(item).step)).filter((step) => step.includes('/'));
}

/** The title of the journey step the route fulfils; the purpose of the request when no step says it. */
function titleOf(request: RequestFacts, facts: Facts): string {
  const onPage = stepsOnPage(facts.shared.get(request.pageId));
  const rank = (step: JourneyStep): number => {
    const at = onPage.indexOf(step.key);
    return at < 0 ? Number.MAX_SAFE_INTEGER : at;
  };
  let candidates: JourneyStep[];
  if (request.kind === 'cmd') {
    const usecase = request.writeUsecases.length === 1 ? facts.usecases.get(request.writeUsecases[0]) : undefined;
    candidates = usecase
      ? facts.steps.filter((step) => step.kind === 'act' && step.entity === usecase.entityId
        && (usecase.operation === 'transition' ? step.transitionRef !== '' && step.transitionRef === usecase.transitionRef : step.effect === usecase.operation))
      : [];
    const listed = candidates.filter((step) => rank(step) !== Number.MAX_SAFE_INTEGER);
    const chosen = listed.length > 0 ? listed.reduce((best, step) => (rank(step) < rank(best) ? step : best)) : candidates[0];
    return chosen?.title || request.purpose;
  }
  candidates = facts.steps.filter((step) => (step.kind === 'locate' || step.kind === 'inspect') && step.entity === request.entity && step.title !== '' && rank(step) !== Number.MAX_SAFE_INTEGER);
  const first = candidates.reduce<JourneyStep | undefined>((best, step) => (!best || rank(step) < rank(best) ? step : best), undefined);
  return first?.title || request.purpose;
}

function signatureOf(inputs: CatalogInput[]): string {
  return inputs.map((input) => `${input.path}\u0000${input.wireType}\u0000${input.required ? '1' : '0'}`).sort().join('\n');
}

function union(lists: string[][]): string[] {
  return [...new Set(lists.flat())];
}

async function collectFacts(reader: DefsReader, moduleId: string, issues: string[]): Promise<Facts> {
  const l1 = `l1/${moduleId}`;
  const l4 = `l4/${moduleId}`;
  const [usecases, controllers, authority, outbound, operations, journeys, ontologies, l4Workflows, config] = await Promise.all([
    readEach(reader, `${l1}/layer_2_application/usecases`, 'definition', issues),
    readEach(reader, `${l1}/layer_1_external/adapters/http/controllers`, 'definition', issues),
    reader.read(`${l1}/layer_1_external/auth/authorityMap.defs.js`, 'definition').catch((error: unknown) => {
      issues.push(`DEF_UNREADABLE: authorityMap: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }),
    reader.read(`${l1}/layer_1_external/adapters/integration/outbound.defs.js`, 'definition').catch((error: unknown) => {
      issues.push(`DEF_UNREADABLE: outbound: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }),
    readEach(reader, `${l1}/layer_2_application/workflows`, 'definition', issues),
    readEach(reader, `${l4}/journeys`, 'default', issues),
    readEach(reader, `${l4}/ontology`, 'default', issues),
    reader.read(`${l4}/workflows.defs.js`, 'default').catch((error: unknown) => {
      issues.push(`DEF_UNREADABLE: l4 workflows: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }),
    Promise.resolve(reader.json('l5/config.json')),
  ]);

  const facts: Facts = {
    usecases: new Map(),
    actorsOfRoute: new Map(),
    ontology: new Map(),
    contracts: new Map(),
    outbound: new Set(),
    operationSteps: new Map(),
    tasks: new Map(),
    tasksOfJourney: new Map(),
    steps: [],
    finals: new Map(),
    hasL4: journeys.ok.length + ontologies.ok.length > 0 || l4Workflows !== undefined,
    config,
    shared: new Map(),
  };

  for (const definition of usecases.ok) {
    const data = dataOf(definition);
    const id = str(data.usecaseId);
    if (id) facts.usecases.set(id, { entityId: str(data.entityId), operation: str(data.operation), transitionRef: str(data.transitionRef), hasEffects: arr(data.effects).length > 0 });
  }

  const actorOfGrant = new Map<string, string>();
  for (const entry of arr(dataOf(authority).entries).map(rec)) {
    if (str(entry.grantId) && str(entry.actorRef)) actorOfGrant.set(str(entry.grantId), str(entry.actorRef));
  }
  for (const definition of controllers.ok) {
    for (const handler of arr(dataOf(definition).handlers).map(rec)) {
      const route = str(handler.route);
      if (!route) continue;
      facts.actorsOfRoute.set(route, union([[...(facts.actorsOfRoute.get(route) ?? [])], strs(handler.grantIds).map((grant) => actorOfGrant.get(grant) ?? '').filter(Boolean)]));
    }
  }

  for (const event of arr(dataOf(outbound).events).map(rec)) if (str(event.on)) facts.outbound.add(str(event.on));
  for (const definition of operations.ok) {
    for (const operation of arr(dataOf(definition).operations).map(rec)) {
      const name = str(operation.operation);
      if (name) facts.operationSteps.set(name, union([facts.operationSteps.get(name) ?? [], strs(operation.steps)]));
    }
  }

  for (const process of arr(rec(l4Workflows).processes).map(rec)) {
    for (const task of arr(process.tasks).map(rec)) {
      const taskId = str(task.taskId);
      if (!taskId || facts.tasks.has(taskId)) continue;
      facts.tasks.set(taskId, { kind: str(task.kind), next: strs(task.next) });
      if (str(task.journeyRef)) facts.tasksOfJourney.set(str(task.journeyRef), [...(facts.tasksOfJourney.get(str(task.journeyRef)) ?? []), taskId]);
    }
  }

  for (const journey of journeys.ok.map(rec)) {
    const journeyId = str(journey.journeyId);
    for (const step of arr(rec(journey.business).steps).map(rec)) {
      facts.steps.push({
        key: `${journeyId}/${str(step.stepId)}`,
        kind: str(step.kind),
        entity: str(step.entity),
        effect: str(step.effect),
        transitionRef: str(step.transitionRef),
        title: str(step.title),
      });
    }
  }

  for (const ontology of ontologies.ok.map(rec)) {
    const entityId = str(ontology.entityId);
    if (!entityId) continue;
    const entity = readOntologyEntity(ontology);
    if (entity) facts.ontology.set(entityId, entity);
    const finals = finalStatesOf(ontology);
    facts.finals.set(entityId, {
      transitions: new Map(arr(ontology.transitions).map(rec).filter((item) => str(item.transitionId) !== '').map((item) => [str(item.transitionId), { to: str(item.to), final: finals.has(str(item.to)) }])),
    });
  }
  return facts;
}

/**
 * The catalog object of a module (`assistant-catalog-v1`), or `undefined` when the release has no request defs for it.
 * Throws only when request defs exist and none can be read; a problem in one item goes to `issues` and the item is
 * left out or lacks the field.
 */
export async function buildCatalogFromDefs(reader: DefsReader, projectId: string, moduleId: string): Promise<Rec | undefined> {
  const requestsFolder = `l1/${moduleId}/layer_2_application/requests`;
  if (reader.list(requestsFolder).length === 0) return undefined;
  const issues: string[] = [];
  const requestDefs = await readEach(reader, requestsFolder, 'definition', issues);
  if (requestDefs.ok.length === 0) throw new Error(`No request def of the module can be read: ${issues.join('; ')}`);

  const live = liveRoutes(reader.json('l5/project.json'), moduleId);
  const facts = await collectFacts(reader, moduleId, issues);
  const order = new Map(live.map((route, index) => [route, index]));

  const requests: RequestFacts[] = [];
  const seen = new Set<string>();
  for (const definition of requestDefs.ok) {
    for (const raw of arr(dataOf(definition).requests).map(rec)) {
      const route = str(raw.route);
      const kind = str(raw.kind);
      if (!route || !order.has(route) || seen.has(route)) continue;
      if (kind !== 'cmd' && kind !== 'qry') {
        issues.push(`REQUEST_KIND_UNKNOWN: ${route}`);
        continue;
      }
      seen.add(route);
      const uses = strs(raw.uses);
      const writeUsecases = writeUsecaseIds(uses, facts.usecases);
      const main = arr(raw.output).map(rec).find((output) => ['entity', 'list'].includes(str(output.kind)));
      const [, pageId = '', requestId = ''] = route.split('.');
      requests.push({
        route,
        kind,
        pageId,
        requestId,
        uses,
        purpose: str(rec(raw.doc).purpose),
        entity: kind === 'cmd' ? (facts.usecases.get(writeUsecases[0] ?? '')?.entityId ?? '') : str(main?.entity),
        writeUsecases,
        pagingParams: [
          ...arr(raw.params).map(rec).filter((param) => str(param.pages) !== '').map((param) => str(param.name)),
          str(main?.page).split('.').pop() ?? '',
          str(main?.pageSize).split('.').pop() ?? '',
        ].filter(Boolean),
      });
    }
  }
  requests.sort((a, b) => (order.get(a.route) ?? 0) - (order.get(b.route) ?? 0));

  for (const pageId of new Set(requests.map((request) => request.pageId))) {
    try {
      const shared = await reader.read(`l2/${moduleId}/web/shared/${pageId}.defs.js`, 'definition');
      if (isRec(shared)) facts.shared.set(pageId, shared);
    } catch (error) {
      issues.push(`DEF_UNREADABLE: shared ${pageId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const pageId of new Set(requests.map((request) => request.pageId))) {
    const text = reader.text(`l2/${moduleId}/web/contracts/${pageId}.defs.ts`);
    if (text === undefined) continue;
    try {
      const parsed = parseContractSource(text);
      for (const route of parsed.routes) facts.contracts.set(route.route, { route, types: parsed.types });
    } catch (error) {
      issues.push(`CONTRACT_UNREADABLE: ${pageId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  type Built = { item: AssistantCatalogItem; inputs: CatalogInput[] | undefined };
  const built: Array<Built | undefined> = requests.map((request): Built | undefined => {
    const contract = facts.contracts.get(request.route);
    let inputs: CatalogInput[] | undefined;
    let optionsOnly = false;
    if (!contract) issues.push(`CONTRACT_MISSING: ${request.route}`);
    else {
      const writes = contract.route.writes.split('.')[0];
      inputs = inputsOfRoute(contract.route, contract.types, facts.ontology.get(request.kind === 'cmd' ? writes : request.entity), {
        query: request.kind === 'qry',
        skip: new Set(request.kind === 'qry' ? request.pagingParams : []),
      });
      if (inputs === undefined) {
        issues.push(`${request.route}: input has shapes the assistant cannot fill`);
        return undefined;
      }
      optionsOnly = request.kind === 'qry' && returnsOnlyOptions(contract.route, contract.types);
    }
    const actors = facts.actorsOfRoute.get(request.route) ?? [];
    if (actors.length === 0) issues.push(`ACTORS_UNRESOLVED: ${request.route}`);
    const address = pageAddress(facts.config, projectId, moduleId, request.pageId);
    if (!address) issues.push(`PAGE_UNRESOLVED: ${request.route}`);
    if (!request.purpose) issues.push(`PURPOSE_MISSING: ${request.route}`);
    if (!request.entity) issues.push(`SUBJECT_MISSING: ${request.route}`);
    const param = recordParam(facts.shared.get(request.pageId));
    return { inputs, item: {
      route: request.route,
      routes: [request.route],
      module: moduleId,
      kind: request.kind,
      actionId: request.route,
      title: titleOf(request, facts),
      ...(request.purpose ? { purpose: request.purpose } : {}),
      subject: request.entity || GENERAL_SUBJECT,
      actors,
      assistant: optionsOnly ? 'excluded' : 'included',
      risk: request.kind === 'qry' ? 'read' : riskOfCommand(request, facts),
      inputs: (inputs ?? []).map((input) => ({ ...input })),
      ...(address ? { page: param ? { address, recordParam: param } : { address } } : {}),
    } };
  });

  // Commands that share their single write use case and have the same inputs are one action (`<module>.<useCase>`).
  // Without a contract there are no inputs to compare, so those commands stay apart.
  const survivors = built.map((entry, index) => ({ entry, index })).filter((x): x is { entry: Built; index: number } => x.entry !== undefined);
  const byUsecase = new Map<string, Array<{ entry: Built; index: number }>>();
  for (const x of survivors) {
    const request = requests[x.index];
    if (request.kind !== 'cmd' || request.writeUsecases.length !== 1) continue;
    byUsecase.set(request.writeUsecases[0], [...(byUsecase.get(request.writeUsecases[0]) ?? []), x]);
  }
  const used = new Set(survivors.map((x) => x.entry.item.actionId));
  const merged = new Map<number, AssistantCatalogItem>();
  const dropped = new Set<number>();
  for (const [usecaseId, group] of byUsecase) {
    if (group.length < 2) continue;
    const partitions = new Map<string, Array<{ entry: Built; index: number }>>();
    for (const x of group.filter((member) => member.entry.inputs !== undefined)) {
      const key = signatureOf(x.entry.inputs ?? []);
      partitions.set(key, [...(partitions.get(key) ?? []), x]);
    }
    for (const part of partitions.values()) {
      const actionId = `${moduleId}.${usecaseId}`;
      if (part.length < 2 || used.has(actionId)) {
        issues.push(`ACTION_NOT_MERGED: ${part.map((x) => x.entry.item.route).join(', ')} share the write use case ${usecaseId} but the inputs differ or the action id is taken`);
        continue;
      }
      used.add(actionId);
      const items = part.map((x) => x.entry.item);
      // The sentences of the merged routes, in the order of the routes, the same sentence once.
      const purposes = [...new Set(items
        .slice()
        .sort((a, b) => (order.get(a.route) ?? 0) - (order.get(b.route) ?? 0))
        .map((item) => str(item.purpose))
        .filter((text) => text !== ''))];
      const { purpose: _first, ...first } = items[0];
      merged.set(part[0].index, {
        ...first,
        ...(purposes.length > 0 ? { purpose: purposes.join(' ') } : {}),
        actionId,
        routes: items.map((item) => item.route),
        actors: union(items.map((item) => item.actors)),
        risk: items.some((item) => item.risk === 'sensitive') ? 'sensitive' : 'write',
      });
      for (const x of part.slice(1)) dropped.add(x.index);
    }
    if (group.some((member) => member.entry.inputs === undefined)) issues.push(`ACTION_NOT_MERGED: ${group.filter((member) => member.entry.inputs === undefined).map((x) => x.entry.item.route).join(', ')} have no contract`);
  }
  const keptItems = survivors.filter((x) => !dropped.has(x.index)).map((x) => merged.get(x.index) ?? x.entry.item);

  const moduleDef = rec(await reader.read(`l4/${moduleId}/module.defs.js`, 'default').catch((error: unknown) => {
    issues.push(`DEF_UNREADABLE: module.defs: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }));
  const title = str(moduleDef.title);
  const description = str(moduleDef.sourcePrompt);
  if (Object.keys(moduleDef).length === 0) issues.push('MODULE_DEF_MISSING');
  else {
    if (!title) issues.push('MODULE_TITLE_MISSING');
    if (!description) issues.push('MODULE_DESCRIPTION_MISSING');
  }

  // The readable names of the tree: the module's title, and the title of the entity the action is about (the subject).
  const missingTitles = new Set<string>();
  const kept = keptItems.map((item) => {
    const subject = str(item.subject);
    const subjectTitle = subject === GENERAL_SUBJECT ? '' : facts.ontology.get(subject)?.title ?? '';
    if (subject !== GENERAL_SUBJECT && !subjectTitle && !missingTitles.has(subject)) {
      missingTitles.add(subject);
      issues.push(`SUBJECT_TITLE_MISSING: ${subject}`);
    }
    return { ...item, ...(title ? { moduleTitle: title } : {}), ...(subjectTitle ? { subjectTitle } : {}) };
  });

  return {
    schemaVersion: ASSISTANT_CATALOG_SCHEMA,
    module: moduleId,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    commands: kept.filter((item) => item.kind === 'cmd'),
    queries: kept.filter((item) => item.kind === 'qry'),
    lookups: [],
    entities: [],
    issues,
  };
}

/** The source of `createAssistantCatalogSource`: one catalog per module, assembled from the release's defs. */
export function defsCatalogImporter(reader: DefsReader, projectId: string): (moduleId: string) => Promise<unknown | undefined> {
  return (moduleId) => buildCatalogFromDefs(reader, projectId, moduleId);
}
