/// <mls fileReference="_102034_/l1/workflow/assistantCatalogDefs.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssistantCatalogSource, parseAssistantCatalog, type AssistantCatalogItem } from '/_102034_/l1/workflow/assistantCatalog.js';
import { buildCatalogFromDefs, defsCatalogImporter, type DefsReader } from '/_102034_/l1/workflow/assistantCatalogDefs.js';

const APP = '999001';

type Files = Record<string, unknown>;

/** A release in memory: `definition` for L1/L2 files, `default` for L4, a string for a contract source; an `Error` value is a file that cannot be read. */
function reader(files: Files, json: Record<string, unknown>): DefsReader & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    list: (folder) => Object.keys(files).filter((file) => file.startsWith(`${folder}/`) && !file.slice(folder.length + 1).includes('/') && file.endsWith('.defs.js')).map((file) => file.slice(folder.length + 1)).sort(),
    async read(file) {
      reads.push(file);
      const value = files[file];
      if (value instanceof Error) throw value;
      return value;
    },
    json: (file) => json[file],
    text: (file) => (typeof files[file] === 'string' ? (files[file] as string) : undefined),
  };
}

const wrap = (data: unknown): { data: unknown } => ({ data });

function request(route: string, kind: 'cmd' | 'qry', uses: string[], purpose: string, output: unknown[] = []): unknown {
  return { route, kind, uses, output, doc: { purpose } };
}

const CONTRACT_ONE = `
export interface Row { id: string; name: string; }
export interface Option { id: string; label: string; }
export interface PageOneContracts {
  'modA.pageOne.qryItems': { kind: 'qry'; input: { page: number; pageSize: number; search?: string }; output: { items: Row[]; page: number } };
  'modA.pageOne.qryOptions': { kind: 'qry'; input: { search?: string }; output: { owners: Option[] } };
  'modA.pageOne.cmdStart': { kind: 'cmd'; writes: 'Thing.start'; input: { id: string; version: number; mode: 'fast' | 'slow' }; output: { ok: boolean } };
  'modA.pageOne.cmdRemove': { kind: 'cmd'; writes: 'Thing.delete'; input: { id: string; ownerId?: string }; output: { ok: boolean } };
  'modA.pageOne.cmdSend': { kind: 'cmd'; writes: 'Thing.send'; input: { id: string; version: number }; output: { ok: boolean } };
  'modA.pageOne.cmdBulk': { kind: 'cmd'; writes: 'Thing.update'; input: { items: Row[] }; output: { ok: boolean } };
}
`;

const L1 = 'l1/modA/layer_2_application';
const CTRL = 'l1/modA/layer_1_external/adapters/http/controllers';

function releaseA(extra: Files = {}): { files: Files; json: Record<string, unknown> } {
  const files: Files = {
    [`${L1}/requests/pageOne.defs.js`]: wrap({
      requests: [
        request('modA.pageOne.qryItems', 'qry', ['listThing'], 'List the things', [{ kind: 'list', entity: 'Thing', page: 'items.page', pageSize: 'items.pageSize' }]),
        request('modA.pageOne.cmdStart', 'cmd', ['startThing'], 'Start a thing'),
        request('modA.pageOne.cmdRemove', 'cmd', ['removeThing'], 'Remove a thing'),
        request('modA.pageOne.cmdSend', 'cmd', ['sendThing'], 'Send a thing'),
        request('modA.pageOne.qryOptions', 'qry', ['listThing'], 'Owner options', [{ kind: 'list', entity: 'Owner' }]),
        request('modA.pageOne.cmdBulk', 'cmd', ['bulkThing'], 'Bulk update'),
        request('modA.pageOne.cmdHidden', 'cmd', ['startThing'], 'Not served by the backend'),
      ],
    }),
    [`${L1}/usecases/listThing.defs.js`]: wrap({ usecaseId: 'listThing', entityId: 'Thing', operation: 'list' }),
    [`${L1}/usecases/startThing.defs.js`]: wrap({ usecaseId: 'startThing', entityId: 'Thing', operation: 'transition', transitionRef: 'start', effects: [] }),
    [`${L1}/usecases/removeThing.defs.js`]: wrap({ usecaseId: 'removeThing', entityId: 'Thing', operation: 'delete', effects: [] }),
    [`${L1}/usecases/bulkThing.defs.js`]: wrap({ usecaseId: 'bulkThing', entityId: 'Thing', operation: 'update', effects: [] }),
    'l2/modA/web/contracts/pageOne.defs.ts': CONTRACT_ONE,
    [`${L1}/usecases/sendThing.defs.js`]: wrap({ usecaseId: 'sendThing', entityId: 'Thing', operation: 'transition', transitionRef: 'send', effects: [] }),
    [`${CTRL}/pageOne.defs.js`]: wrap({
      handlers: [
        { route: 'modA.pageOne.qryItems', grantIds: ['g1', 'g2'] },
        { route: 'modA.pageOne.cmdStart', grantIds: ['g1', 'g3'] },
        { route: 'modA.pageOne.cmdRemove', grantIds: ['g3'] },
        { route: 'modA.pageOne.cmdSend', grantIds: ['g1'] },
        { route: 'modA.pageOne.qryOptions', grantIds: ['g1'] },
        { route: 'modA.pageOne.cmdBulk', grantIds: ['g3'] },
      ],
    }),
    'l1/modA/layer_1_external/auth/authorityMap.defs.js': wrap({
      entries: [{ grantId: 'g1', actorRef: 'member' }, { grantId: 'g2', actorRef: 'member' }, { grantId: 'g3', actorRef: 'manager' }],
    }),
    'l1/modA/layer_1_external/adapters/integration/outbound.defs.js': wrap({ events: [{ on: 'Thing.send' }] }),
    ...extra,
  };
  const json: Record<string, unknown> = {
    'l5/project.json': {
      modules: [
        { moduleName: 'modA', backend: { routeKeys: ['modA.pageOne.qryItems', 'modA.pageOne.qryOptions', 'modA.pageOne.cmdStart', 'modA.pageOne.cmdRemove', 'modA.pageOne.cmdSend', 'modA.pageOne.cmdBulk'] } },
        { moduleName: 'modB', backend: { routeKeys: ['modB.page.qryRows', 'modB.page.cmdAdd'] } },
      ],
    },
    'l5/config.json': {
      projects: { [APP]: { modules: [{ moduleId: 'modA', frontend: { pages: [{ pageId: 'pageOne', route: '/modA/one' }] } }] } },
    },
  };
  return { files, json };
}

function itemsOf(catalog: Record<string, unknown>): AssistantCatalogItem[] {
  return [...(catalog.commands as AssistantCatalogItem[]), ...(catalog.queries as AssistantCatalogItem[])];
}

async function built(files: Files, json: Record<string, unknown>, moduleId = 'modA'): Promise<Record<string, unknown>> {
  const catalog = await buildCatalogFromDefs(reader(files, json), APP, moduleId);
  assert.ok(catalog);
  return catalog;
}

test('the catalog built from the defs passes the shape the assistant checks', async () => {
  const { files, json } = releaseA();
  const catalog = await built(files, json);
  const parsed = parseAssistantCatalog(catalog, 'modA');
  assert.equal(parsed.ok, true);
  assert.equal(catalog.schemaVersion, 'assistant-catalog-v1');
  assert.equal(itemsOf(catalog).length, 5);
});

test('only the routes the backend serves enter, with the kind of the request', async () => {
  const { files, json } = releaseA();
  const catalog = await built(files, json);
  assert.deepEqual((catalog.queries as AssistantCatalogItem[]).map((item) => item.route), ['modA.pageOne.qryItems', 'modA.pageOne.qryOptions']);
  assert.deepEqual((catalog.commands as AssistantCatalogItem[]).map((item) => item.route), ['modA.pageOne.cmdStart', 'modA.pageOne.cmdRemove', 'modA.pageOne.cmdSend']);
  assert.ok(!itemsOf(catalog).some((item) => item.route === 'modA.pageOne.cmdHidden'));
});

test('actors come from the grants of the controller through the authority map, without the module prefix and without repeats', async () => {
  const { files, json } = releaseA();
  const byRoute = new Map(itemsOf(await built(files, json)).map((item) => [item.route, item]));
  assert.deepEqual(byRoute.get('modA.pageOne.qryItems')?.actors, ['member']);
  assert.deepEqual(byRoute.get('modA.pageOne.cmdStart')?.actors, ['member', 'manager']);
  assert.deepEqual(byRoute.get('modA.pageOne.cmdRemove')?.actors, ['manager']);
});

test('risk: query read; command write; sensitive when it deletes or publishes outside', async () => {
  const { files, json } = releaseA();
  const byRoute = new Map(itemsOf(await built(files, json)).map((item) => [item.route, item]));
  assert.equal(byRoute.get('modA.pageOne.qryItems')?.risk, 'read');
  assert.equal(byRoute.get('modA.pageOne.cmdStart')?.risk, 'write');
  assert.equal(byRoute.get('modA.pageOne.cmdRemove')?.risk, 'sensitive');
  assert.equal(byRoute.get('modA.pageOne.cmdSend')?.risk, 'sensitive');
});

test('the page comes from the config; the action id is the route; only the query that returns just options is excluded', async () => {
  const { files, json } = releaseA();
  const items = itemsOf(await built(files, json));
  assert.ok(items.every((item) => item.actionId === item.route));
  assert.deepEqual(items.filter((item) => item.assistant === 'excluded').map((item) => item.route), ['modA.pageOne.qryOptions']);
  assert.deepEqual(items.find((item) => item.route === 'modA.pageOne.cmdStart')?.page, { address: '/modA/one' });
  assert.equal(items.find((item) => item.route === 'modA.pageOne.cmdStart')?.title, 'Start a thing');
});

test('inputs come from the type of the route in the contract: path, required, literals, version and reference; queries skip paging', async () => {
  const { files, json } = releaseA({
    'l4/modA/ontology/thing.defs.js': {
      entityId: 'Thing',
      title: 'The thing',
      record: { fields: { ownerId: { title: 'Owner', description: 'Who owns it', type: 'record', to: ['Owner'] }, mode: { title: 'Mode', type: 'enum', values: [{ value: 'fast', title: 'Fast one' }] } } },
    },
  });
  const catalog = await built(files, json);
  const byRoute = new Map(itemsOf(catalog).map((item) => [item.route, item]));
  const brief = (route: string) => (byRoute.get(route)?.inputs ?? []).map((input) => `${input.path}|${input.required}|${input.role}|${input.ref}|${input.wireType}`);
  assert.deepEqual(brief('modA.pageOne.cmdStart'), ['id|true|ref|Thing|string', 'version|true|version||number', 'mode|true|value||string']);
  assert.deepEqual(brief('modA.pageOne.cmdRemove'), ['id|true|ref|Thing|string', 'ownerId|false|ref|Owner|string']);
  assert.deepEqual(brief('modA.pageOne.qryItems'), ['search|false|value||string']);
  const start = byRoute.get('modA.pageOne.cmdStart')?.inputs as Array<{ label: string; enumValues: unknown[] }>;
  assert.equal(start[0].label, 'The thing');
  assert.deepEqual(start[2].enumValues, [{ value: 'fast', label: 'Fast one' }, { value: 'slow', label: 'slow' }]);
  const remove = byRoute.get('modA.pageOne.cmdRemove')?.inputs as Array<{ label: string; description: string }>;
  assert.deepEqual([remove[1].label, remove[1].description], ['Owner', 'Who owns it']);
});

test('a route with a required input the assistant cannot fill (an array of objects) is out, with the warning', async () => {
  const { files, json } = releaseA();
  const catalog = await built(files, json);
  assert.ok(!itemsOf(catalog).some((item) => item.route === 'modA.pageOne.cmdBulk'));
  assert.ok((catalog.issues as string[]).includes('modA.pageOne.cmdBulk: input has shapes the assistant cannot fill'));
});

test('commands with the same write use case and the same inputs merge into one action; different inputs stay apart', async () => {
  const { files, json } = releaseA({
    [`${L1}/requests/pageTwo.defs.js`]: wrap({
      requests: [
        request('modA.pageTwo.cmdStartAgain', 'cmd', ['startThing'], 'Start from the second page'),
        request('modA.pageTwo.cmdStartOther', 'cmd', ['startThing'], 'Start with other inputs'),
      ],
    }),
    'l2/modA/web/contracts/pageTwo.defs.ts': `export interface PageTwoContracts {
      'modA.pageTwo.cmdStartAgain': { kind: 'cmd'; writes: 'Thing.start'; input: { id: string; version: number; mode: 'fast' | 'slow' } };
      'modA.pageTwo.cmdStartOther': { kind: 'cmd'; writes: 'Thing.start'; input: { id: string; note: string } };
    }`,
  });
  (json['l5/project.json'] as { modules: Array<{ backend: { routeKeys: string[] } }> }).modules[0].backend.routeKeys.push('modA.pageTwo.cmdStartAgain', 'modA.pageTwo.cmdStartOther');
  const catalog = await built(files, json);
  const items = itemsOf(catalog);
  const merged = items.find((item) => item.actionId === 'modA.startThing');
  assert.ok(merged);
  assert.deepEqual(merged.routes, ['modA.pageOne.cmdStart', 'modA.pageTwo.cmdStartAgain']);
  assert.equal(items.filter((item) => item.route === 'modA.pageTwo.cmdStartAgain').length, 0);
  assert.equal(items.find((item) => item.route === 'modA.pageTwo.cmdStartOther')?.actionId, 'modA.pageTwo.cmdStartOther');
  assert.ok((catalog.issues as string[]).some((issue) => issue.startsWith('ACTION_NOT_MERGED: modA.pageTwo.cmdStartOther')));
  assert.equal(parseAssistantCatalog(catalog, 'modA').ok, true);
});

test('without the contract source the items stay, with no inputs, nothing merges and the warning is in issues', async () => {
  const { files, json } = releaseA();
  delete files['l2/modA/web/contracts/pageOne.defs.ts'];
  const catalog = await built(files, json);
  const items = itemsOf(catalog);
  assert.equal(items.length, 6);
  assert.ok(items.every((item) => (item.inputs ?? []).length === 0 && item.assistant === 'included'));
  assert.ok((catalog.issues as string[]).includes('CONTRACT_MISSING: modA.pageOne.cmdStart'));
});

test('the L4 of the release gives the title of the journey step and the final state makes the command sensitive', async () => {
  const { files, json } = releaseA({
    'l4/modA/journeys/flow.defs.js': {
      journeyId: 'flow',
      business: { steps: [
        { stepId: 'begin', kind: 'act', entity: 'Thing', effect: 'transition', transitionRef: 'start', title: 'Begin the thing' },
        { stepId: 'look', kind: 'locate', entity: 'Thing', title: 'Find things' },
      ] },
    },
    'l4/modA/ontology/thing.defs.js': {
      entityId: 'Thing',
      lifecycleStates: [{ state: 'open' }, { state: 'done' }],
      transitions: [{ transitionId: 'start', from: ['open'], to: 'done' }, { transitionId: 'send', from: ['running'], to: 'done' }, { transitionId: 'finish', from: ['running'], to: 'done' }],
    },
    'l2/modA/web/shared/pageOne.defs.js': { journeys: [{ step: 'flow/begin' }, { step: 'flow/look' }] },
  });
  const byRoute = new Map(itemsOf(await built(files, json)).map((item) => [item.route, item]));
  assert.equal(byRoute.get('modA.pageOne.cmdStart')?.title, 'Begin the thing');
  assert.equal(byRoute.get('modA.pageOne.qryItems')?.title, 'Find things');
  assert.equal(byRoute.get('modA.pageOne.cmdStart')?.risk, 'sensitive');
});

test('a command whose workflow reaches an LLM step is sensitive', async () => {
  const { files, json } = releaseA({
    'l1/modA/layer_2_application/workflows/proc.defs.js': wrap({ operations: [{ operation: 'Thing.start', steps: ['journey:flow/begin'] }] }),
    'l4/modA/workflows.defs.js': { processes: [{ tasks: [{ taskId: 'human', kind: 'human', journeyRef: 'flow', next: ['ask'] }, { taskId: 'ask', kind: 'llm', next: [] }] }] },
  });
  const byRoute = new Map(itemsOf(await built(files, json)).map((item) => [item.route, item]));
  assert.equal(byRoute.get('modA.pageOne.cmdStart')?.risk, 'sensitive');
});

test('a def of an old shape does not take the module down: the item loses the field and the problem goes to issues', async () => {
  const files: Files = {
    'l1/modB/layer_2_application/requests/page.defs.js': wrap({
      requests: [{ route: 'modB.page.qryRows', kind: 'qry' }, { route: 'modB.page.cmdAdd', kind: 'cmd', uses: ['addRow'] }, { route: 'modB.page.cmdOdd', kind: 'weird' }],
    }),
    'l1/modB/layer_2_application/usecases/addRow.defs.js': new Error('def of an old shape'),
  };
  const { json } = releaseA();
  (json['l5/project.json'] as { modules: Array<{ backend: { routeKeys: string[] } }> }).modules[1].backend.routeKeys.push('modB.page.cmdOdd');
  const catalog = await built(files, json, 'modB');
  const items = itemsOf(catalog);
  assert.deepEqual(items.map((item) => item.route).sort(), ['modB.page.cmdAdd', 'modB.page.qryRows']);
  assert.equal(items.find((item) => item.route === 'modB.page.cmdAdd')?.risk, 'sensitive');
  assert.deepEqual(items.find((item) => item.route === 'modB.page.qryRows')?.actors, []);
  const issues = catalog.issues as string[];
  assert.ok(issues.some((issue) => issue.startsWith('DEF_UNREADABLE:')));
  assert.ok(issues.some((issue) => issue.startsWith('REQUEST_KIND_UNKNOWN: modB.page.cmdOdd')));
  assert.ok(issues.some((issue) => issue.startsWith('ACTORS_UNRESOLVED: modB.page.qryRows')));
  assert.equal(parseAssistantCatalog(catalog, 'modB').ok, true);
});

test('a module with no readable request def fails; one with no request defs at all has no catalog', async () => {
  const unreadable = reader({ 'l1/modC/layer_2_application/requests/page.defs.js': new Error('broken') }, {});
  await assert.rejects(() => buildCatalogFromDefs(unreadable, APP, 'modC'), /No request def/);
  assert.equal(await buildCatalogFromDefs(reader({}, {}), APP, 'modD'), undefined);
});

test('a module the backend does not serve has an empty catalog', async () => {
  const { files, json } = releaseA();
  (json['l5/project.json'] as { modules: unknown[] }).modules = [];
  const catalog = await built(files, json);
  assert.deepEqual(itemsOf(catalog), []);
  assert.equal(parseAssistantCatalog(catalog, 'modA').ok, true);
});

test('the source reads the defs once per release and again on a new release', async () => {
  const { files, json } = releaseA();
  const source = reader(files, json);
  let release = 'rel-1';
  const catalogs = createAssistantCatalogSource({ projectId: APP, releaseId: () => release, importCatalog: defsCatalogImporter(source, APP) });
  const first = await catalogs.get('modA');
  assert.equal(first.ok, true);
  const reads = source.reads.length;
  assert.ok(reads > 0);
  await catalogs.get('modA');
  assert.equal(source.reads.length, reads);
  release = 'rel-2';
  await catalogs.get('modA');
  assert.equal(source.reads.length, reads * 2);
  const missing = await catalogs.get('modZ');
  assert.deepEqual(missing, { ok: false, code: 'ASSISTANT_CATALOG_MISSING' });
});
