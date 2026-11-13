/// <mls fileReference="_102034_/l1/workflow/assistantCatalog.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  ASSISTANT_CATALOG_SCHEMA,
  allowedActions,
  createAssistantCatalogSource,
  listAssistantCatalog,
  parseAssistantCatalog,
  type AssistantCatalogDeps,
  type AssistantCatalogItem,
} from '/_102034_/l1/workflow/assistantCatalog.js';

const ctx = {} as RequestContext;

function item(actionId: string, kind: 'cmd' | 'qry', actors: string[], assistant: 'included' | 'excluded' = 'included'): AssistantCatalogItem {
  return { route: `${actionId}.route`, routes: [`${actionId}.route`], kind, actionId, title: actionId, actors, assistant, risk: kind === 'qry' ? 'read' : 'write' };
}

function catalogOf(moduleId: string, commands: AssistantCatalogItem[], queries: AssistantCatalogItem[]): Record<string, unknown> {
  return { schemaVersion: ASSISTANT_CATALOG_SCHEMA, module: moduleId, commands, queries, lookups: [], entities: [], issues: [] };
}

function deps(files: Record<string, unknown>, extra: Partial<AssistantCatalogDeps> = {}): AssistantCatalogDeps & { imports: string[] } {
  const imports: string[] = [];
  return {
    imports,
    projectId: '102047',
    modules: Object.keys(files).map((moduleId) => ({ moduleId })),
    identities: { toMdmId: async (_c, cmUserId) => { if (cmUserId === 'cm-1') return 'person-1'; throw new AppError('WORKFLOW_IDENTITY_UNLINKED', 'u', 409); } },
    withAlpha: async (meta) => meta,
    catalogs: createAssistantCatalogSource({
      projectId: '102047',
      releaseId: () => 'rel-1',
      importCatalog: async (moduleId) => { imports.push(moduleId); return files[moduleId]; },
    }),
    release: () => 'rel-1',
    ...extra,
  };
}

const behalf = (authorities: string[], cmUserId = 'cm-1') => ({ cmUserId, authorities, snapshotAt: '2026-11-13T10:00:00.000Z', via: 'nora' });

const FILES = {
  modA: catalogOf('modA', [item('modA.accept', 'cmd', ['boss']), item('modA.hidden', 'cmd', ['boss'], 'excluded')], [item('modA.list', 'qry', ['boss', 'worker'])]),
  modB: undefined,
  modC: catalogOf('modC', [], [item('modC.panel', 'qry', ['clerk'])]),
};

test('two modules and one without a file: the catalogs come with a partial for the missing one', async () => {
  const d = deps(FILES);
  const result = await listAssistantCatalog(ctx, d, { onBehalfOf: behalf(['modA:boss', 'modC:clerk']) });
  assert.equal(result.outcome, 'done');
  assert.equal(result.release, 'rel-1');
  assert.deepEqual(result.catalogs?.map((entry) => entry.moduleId), ['modA', 'modC']);
  assert.deepEqual(result.partial, [{ moduleId: 'modB', code: 'ASSISTANT_CATALOG_MISSING' }]);
  assert.deepEqual(result.allowed, ['modA.accept', 'modA.list', 'modC.panel']);
});

test('knownRelease equal to the running one sends no catalogs, and allowed still comes', async () => {
  const result = await listAssistantCatalog(ctx, deps(FILES), { onBehalfOf: behalf(['modA:worker']), knownRelease: 'rel-1' });
  assert.equal('catalogs' in result, false);
  assert.deepEqual(result.allowed, ['modA.list']);
  const other = await listAssistantCatalog(ctx, deps(FILES), { onBehalfOf: behalf(['modA:worker']), knownRelease: 'rel-0' });
  assert.equal(other.catalogs?.length, 2);
});

test('without authority in the module and alpha off, nothing of that module is allowed; an excluded item never is', async () => {
  const none = await listAssistantCatalog(ctx, deps(FILES), { onBehalfOf: behalf(['modC:clerk']) });
  assert.deepEqual(none.allowed, ['modC.panel']);
  const alphaOn = deps(FILES, {
    withAlpha: async (meta, moduleId) => ({ ...meta, verifiedAuthorities: [...(meta?.verifiedAuthorities ?? []), `${moduleId}:boss`, `${moduleId}:worker`, `${moduleId}:clerk`] }),
  });
  const all = await listAssistantCatalog(ctx, alphaOn, { onBehalfOf: behalf([]) });
  assert.deepEqual(all.allowed, ['modA.accept', 'modA.list', 'modC.panel']);
  assert.equal(all.allowed.includes('modA.hidden'), false);
});

test('a catalog of another version, another module or with a bad item goes to partial, and the others answer', async () => {
  const files = {
    modA: FILES.modA,
    modB: { ...catalogOf('modB', [], []), schemaVersion: 'other' },
    modC: catalogOf('modOther', [], []),
    modD: catalogOf('modD', [{ route: 'x' } as never], []),
    modE: catalogOf('modE', [item('same', 'cmd', ['a'])], [item('same', 'qry', ['a'])]),
  };
  const result = await listAssistantCatalog(ctx, deps(files), { onBehalfOf: behalf(['modA:boss']) });
  assert.deepEqual(result.catalogs?.map((entry) => entry.moduleId), ['modA']);
  assert.deepEqual(result.partial.map((entry) => entry.code), Array(4).fill('ASSISTANT_CATALOG_INVALID'));
  assert.deepEqual(result.allowed, ['modA.accept', 'modA.list']);
});

test('a person without a link is no_person and nothing is read', async () => {
  const d = deps(FILES);
  const result = await listAssistantCatalog(ctx, d, { onBehalfOf: behalf(['modA:boss'], 'cm-unknown') });
  assert.deepEqual(result, { outcome: 'no_person', release: 'rel-1', allowed: [], partial: [] });
  assert.deepEqual(d.imports, []);
});

test('the catalogs are kept per release: one import per module, and a new release imports again; no release, no cache', async () => {
  const imports: string[] = [];
  let release: string | null = 'r1';
  const source = createAssistantCatalogSource({ projectId: '102047', releaseId: () => release, importCatalog: async (moduleId) => { imports.push(moduleId); return FILES.modA; } });
  await source.get('modA'); await source.get('modA');
  assert.deepEqual(imports, ['modA']);
  release = 'r2';
  await source.get('modA');
  assert.deepEqual(imports, ['modA', 'modA']);
  release = null;
  await source.get('modA'); await source.get('modA');
  assert.equal(imports.length, 4);
  const broken = createAssistantCatalogSource({ projectId: '102047', releaseId: () => 'r', importCatalog: async () => { throw new Error('syntax'); } });
  assert.deepEqual(await broken.get('modA'), { ok: false, code: 'ASSISTANT_CATALOG_INVALID' });
});

test('parse and allowed use only the fields the generator emits', () => {
  const parsed = parseAssistantCatalog(FILES.modA, 'modA');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(allowedActions(parsed.catalog, ['modA:worker']), ['modA.list']);
  assert.deepEqual(allowedActions(parsed.catalog, ['modB:boss']), []);
  assert.equal(parseAssistantCatalog(null, 'modA').ok, false);
});
