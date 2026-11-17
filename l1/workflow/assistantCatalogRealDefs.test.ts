/// <mls fileReference="_102034_/l1/workflow/assistantCatalogRealDefs.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { buildCatalogFromDefs, type DefsReader } from '/_102034_/l1/workflow/assistantCatalogDefs.js';

/**
 * The real defs of two modules of the 102047 source (`tarefas` and `compras`), transpiled the way the release build does
 * (`.defs.ts` -> `.defs.js`, contracts as text): what the assistant catalog says about them must be what the defs say.
 */
const APP = '102047';
const MODULES = ['tarefas', 'compras'];
const BASE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SOURCE = path.join(BASE, `mls-${APP}`);

function emit(from: string, to: string): void {
  for (const entry of readdirSync(from)) {
    const source = path.join(from, entry);
    if (statSync(source).isDirectory()) {
      emit(source, path.join(to, entry));
    } else if (entry.endsWith('.defs.ts')) {
      mkdirSync(to, { recursive: true });
      const out = ts.transpileModule(readFileSync(source, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
      writeFileSync(path.join(to, entry.replace(/\.defs\.ts$/, '.defs.js')), out.outputText);
    }
  }
}

function releaseOf(root: string): void {
  writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  mkdirSync(path.join(root, 'l5'), { recursive: true });
  for (const file of ['project.json', 'config.json']) cpSync(path.join(SOURCE, 'l5', file), path.join(root, 'l5', file));
  for (const moduleId of MODULES) {
    emit(path.join(SOURCE, 'l1', moduleId), path.join(root, 'l1', moduleId));
    emit(path.join(SOURCE, 'l4', moduleId), path.join(root, 'l4', moduleId));
    const contracts = path.join(SOURCE, 'l2', moduleId, 'web', 'contracts');
    if (existsSync(contracts)) cpSync(contracts, path.join(root, 'l2', moduleId, 'web', 'contracts'), { recursive: true });
  }
}

function readerOf(root: string): DefsReader {
  const at = (file: string): string => path.join(root, file);
  return {
    list: (folder) => (existsSync(at(folder)) ? readdirSync(at(folder)).filter((name) => name.endsWith('.defs.js')).sort() : []),
    async read(file, exportName) {
      if (!existsSync(at(file))) return undefined;
      return ((await import(pathToFileURL(at(file)).href)) as Record<string, unknown>)[exportName];
    },
    json: (file) => (existsSync(at(file)) ? (JSON.parse(readFileSync(at(file), 'utf8')) as unknown) : undefined),
    text: (file) => (existsSync(at(file)) ? readFileSync(at(file), 'utf8') : undefined),
  };
}

type Item = { route: string; routes?: string[]; actionId: string; purpose?: string; subject?: string; subjectTitle?: string; moduleTitle?: string };

test('real defs of the 102047: every action says its purpose and every module its title and description, as the defs say', { skip: !existsSync(SOURCE) }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'catalog-real-'));
  try {
    releaseOf(root);
    const reader = readerOf(root);
    for (const moduleId of MODULES) {
      const catalog = (await buildCatalogFromDefs(reader, APP, moduleId)) as { title?: string; description?: string; commands: Item[]; queries: Item[]; issues: string[] };
      const items = [...catalog.commands, ...catalog.queries];
      assert.ok(items.length > 0, `${moduleId} has actions`);

      // What each route of the request defs says, in the order of the routes of the project.
      const purposeOf = new Map<string, string>();
      for (const name of reader.list(`l1/${moduleId}/layer_2_application/requests`)) {
        const definition = (await reader.read(`l1/${moduleId}/layer_2_application/requests/${name}`, 'definition')) as { data: { requests: Array<{ route: string; doc?: { purpose?: string } }> } };
        for (const request of definition.data.requests) purposeOf.set(request.route, request.doc?.purpose ?? '');
      }
      const routeOrder = ((reader.json('l5/project.json') as { modules: Array<{ moduleName: string; backend: { routeKeys: string[] } }> }).modules.find((m) => m.moduleName === moduleId)?.backend.routeKeys) ?? [];
      for (const item of items) {
        const routes = [...(item.routes ?? [item.route])].sort((a, b) => routeOrder.indexOf(a) - routeOrder.indexOf(b));
        const expected = [...new Set(routes.map((route) => purposeOf.get(route) ?? '').filter((text) => text !== ''))].join(' ');
        assert.ok(expected !== '', `${item.actionId} has a purpose in its defs`);
        assert.equal(item.purpose, expected, `${item.actionId}: purpose`);
        assert.ok(item.subject, `${item.actionId} has a subject`);
        if (item.subject !== 'general') assert.ok(item.subjectTitle, `${item.actionId}: the title of the entity ${item.subject}`);
      }
      assert.equal(catalog.issues.some((issue) => issue.startsWith('PURPOSE_MISSING') || issue.startsWith('MODULE_')), false, catalog.issues.join('; '));

      const moduleDef = (await reader.read(`l4/${moduleId}/module.defs.js`, 'default')) as { title: string; sourcePrompt: string };
      assert.ok(moduleDef.title && moduleDef.sourcePrompt);
      assert.equal(catalog.title, moduleDef.title);
      assert.ok(items.every((item) => item.moduleTitle === moduleDef.title), 'every action carries the title of its module');
      assert.equal(catalog.description, moduleDef.sourcePrompt);
    }

    const tarefas = (await buildCatalogFromDefs(reader, APP, 'tarefas')) as { queries: Item[] };
    const participantes = tarefas.queries.find((item) => item.actionId === 'tarefas.participantes.listarParticipantes');
    assert.ok(participantes?.purpose?.startsWith('Lista os participantes do módulo de tarefas da organização'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
