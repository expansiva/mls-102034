/// <mls fileReference="_102034_/l1/workflow/wakeRegistry.test.ts" enhancement="_blank"/>
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import {
  loadConfiguredModuleCompositionRoot,
  resetConfiguredModuleCompositionCache,
} from '/_102034_/l1/server/layer_2_controllers/moduleRegistry.js';
import type { WorkflowWakeHandler, WorkflowWakeScope } from '/_102034_/l1/workflow/wakeContracts.js';
import {
  createWorkflowWakeRegistry,
  registerWorkflowWakeHandler,
  resetWorkflowWakeRegistryForTests,
  resolveWorkflowWakeHandler,
} from '/_102034_/l1/workflow/wakeRegistry.js';

function scope(overrides: Partial<WorkflowWakeScope> = {}): WorkflowWakeScope {
  return {
    projectId: '900001',
    moduleId: 'modA',
    processId: 'procA',
    routine: 'onWait',
    ...overrides,
  };
}

function handler(): WorkflowWakeHandler {
  return async () => {
    throw new Error('handler must not run during register or resolve');
  };
}

test('a mesma função repete sem efeito e outra função na mesma chave falha', () => {
  const registry = createWorkflowWakeRegistry({ loadCompositionRoot: async () => {} });
  const fn = handler();
  registry.register(scope(), fn);
  registry.register({ ...scope() }, fn);
  assert.throws(
    () => registry.register(scope(), handler()),
    (error: unknown) => error instanceof AppError && error.code === 'WORKFLOW_WAKE_HANDLER_CONFLICT',
  );
});

test('project, module, process e routine não colidem quando só a routine coincide', async () => {
  const registry = createWorkflowWakeRegistry({ loadCompositionRoot: async () => {} });
  const cases = [
    scope(),
    scope({ processId: 'procB' }),
    scope({ moduleId: 'modB' }),
    scope({ projectId: '900002' }),
  ];
  const fns = cases.map(() => handler());
  cases.forEach((item, index) => registry.register(item, fns[index]!));
  for (let index = 0; index < cases.length; index += 1) {
    assert.equal(await registry.resolve(cases[index]!), fns[index]);
  }
});

test('resolve não dispara o handler', async () => {
  let calls = 0;
  const registry = createWorkflowWakeRegistry({ loadCompositionRoot: async () => {} });
  const fn: WorkflowWakeHandler = async () => {
    calls += 1;
  };
  registry.register(scope(), fn);
  assert.equal(await registry.resolve(scope()), fn);
  assert.equal(calls, 0);
});

function writeRoot(dir: string, source: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'registerRepositories.ts'), source);
}

function workspaceConfig(): string {
  return JSON.stringify({
    defaultProjectId: '900001',
    projects: {
      '900001': {
        type: 'client',
        role: 'client_project',
        modules: [{ moduleId: 'modA' }, { moduleId: 'modB' }, { moduleId: 'modBad' }],
        persistenceModules: [
          { moduleId: 'modA', tableDefsDir: '_900001_/l1/modA/tables' },
          { moduleId: 'modB', tableDefsDir: '_900001_/l1/modB/tables' },
          { moduleId: 'modBad', tableDefsDir: '_900001_/l1/modBad/tables' },
        ],
      },
      '900002': {
        type: 'lib',
        modules: [{ moduleId: 'modA' }],
        persistenceModules: [{ moduleId: 'modA', tableDefsDir: '_900002_/l1/modA/tables' }],
      },
      '102029': { type: 'master frontend', role: 'frontend_base', modules: [] },
      '102034': { type: 'master backend', role: 'server_core', modules: [] },
    },
  });
}

const rootSource = (body: string) => `import { registerWorkflowWakeHandler } from '/_102034_/l1/workflow/wakeRegistry.js';
${body}
`;

test('o link configurado registra e resolve sem chamada BFF', async () => {
  const previous = process.cwd();
  const workspace = mkdtempSync(join(tmpdir(), 'rt106-s2-'));
  const projects = join(workspace, 'projects');
  mkdirSync(projects);
  writeFileSync(join(projects, 'config.json'), workspaceConfig());
  const register = (projectId: string, moduleId: string, processId: string, mark: string) => rootSource(
    `registerWorkflowWakeHandler(${JSON.stringify({ projectId, moduleId, processId, routine: 'onWait' })}, async () => { globalThis.${mark} = (globalThis.${mark} ?? 0) + 1; });`,
  );
  writeRoot(join(projects, 'mls-900001/l1/modA/tables'), register('900001', 'modA', 'procA', '__wakeA'));
  writeRoot(join(projects, 'mls-900001/l1/modB/tables'), register('900001', 'modB', 'procA', '__wakeB'));
  writeRoot(join(projects, 'mls-900002/l1/modA/tables'), register('900002', 'modA', 'procA', '__wakeC'));
  process.chdir(workspace);
  resetProjectsConfigCache();
  resetConfiguredModuleCompositionCache();
  resetWorkflowWakeRegistryForTests();
  try {
    const first = await resolveWorkflowWakeHandler(scope());
    const second = await resolveWorkflowWakeHandler(scope({ moduleId: 'modB' }));
    const third = await resolveWorkflowWakeHandler(scope({ projectId: '900002' }));
    assert.notEqual(first, second);
    assert.notEqual(first, third);
    assert.equal(await resolveWorkflowWakeHandler(scope()), first);
    const marks = globalThis as { __wakeA?: number; __wakeB?: number; __wakeC?: number };
    assert.equal(marks.__wakeA ?? 0, 0);
    assert.equal(marks.__wakeB ?? 0, 0);
    assert.equal(marks.__wakeC ?? 0, 0);
    await assert.rejects(
      () => resolveWorkflowWakeHandler(scope({ processId: 'other', routine: 'secretRoutineName' })),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 503);
        assert.equal(error.code, 'WORKFLOW_WAKE_HANDLER_UNAVAILABLE');
        assert.equal(JSON.stringify(error).includes('secretRoutineName'), false);
        return true;
      },
    );
  } finally {
    process.chdir(previous);
    resetProjectsConfigCache();
    resetConfiguredModuleCompositionCache();
    resetWorkflowWakeRegistryForTests();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('import falho remove a promise e a próxima resolução tenta de novo', async () => {
  const previous = process.cwd();
  const workspace = mkdtempSync(join(tmpdir(), 'rt106-s2-retry-'));
  const projects = join(workspace, 'projects');
  const rootDir = join(projects, 'mls-900001/l1/modBad/tables');
  mkdirSync(projects);
  writeFileSync(join(projects, 'config.json'), workspaceConfig());
  writeRoot(rootDir, 'throw new Error("composition-root-failed");\n');
  process.chdir(workspace);
  resetProjectsConfigCache();
  resetConfiguredModuleCompositionCache();
  resetWorkflowWakeRegistryForTests();
  try {
    await assert.rejects(
      () => loadConfiguredModuleCompositionRoot('900001', 'modBad'),
      (error: unknown) => error instanceof AppError
        && error.statusCode === 503
        && error.code === 'WORKFLOW_WAKE_COMPOSITION_ROOT_FAILED'
        && !String(error.message).includes('composition-root-failed'),
    );
    const config = JSON.parse(workspaceConfig()) as {
      projects: Record<string, { persistenceModules: Array<{ moduleId: string; tableDefsDir?: string }> }>;
    };
    const persistence = config.projects['900001']!.persistenceModules.find((entry) => entry.moduleId === 'modBad');
    persistence!.tableDefsDir = '_900001_/l1/modBad/retry/tables';
    writeFileSync(join(projects, 'config.json'), JSON.stringify(config));
    resetProjectsConfigCache();
    writeRoot(join(projects, 'mls-900001/l1/modBad/retry/tables'), rootSource(
      'registerWorkflowWakeHandler({ projectId: "900001", moduleId: "modBad", processId: "procA", routine: "onWait" }, async () => {});',
    ));
    const resolved = await resolveWorkflowWakeHandler(scope({ moduleId: 'modBad' }));
    assert.equal(typeof resolved, 'function');
  } finally {
    process.chdir(previous);
    resetProjectsConfigCache();
    resetConfiguredModuleCompositionCache();
    resetWorkflowWakeRegistryForTests();
    rmSync(workspace, { recursive: true, force: true });
  }
});
