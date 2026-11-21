/// <mls fileReference="_102034_/l1/scripts/resetLocalDb.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import type { ProjectMode } from '/_102034_/l1/server/layer_1_external/config/projectMode.js';
import type { SchemaBootstrapResult } from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';
import { RESET_LOCAL_DB_MARK, parseResetLocalDbArgs, resetLocalDb } from '/_102034_/l1/scripts/resetLocalDb.js';

const LOCAL_TEST = 'postgresql://tester@127.0.0.1:5432/collab_app_test';
const OTHER_DB = 'postgresql://tester@127.0.0.1:5432/collab_prod';

function env(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    runtimeMode: 'postgres',
    projectId: '102047',
    ...overrides,
  } as AppEnv;
}

function report(mode: SchemaBootstrapResult['report']['mode']): SchemaBootstrapResult {
  return {
    snapshotId: 'snap-same',
    postgresTableCount: 2,
    dynamoTableCount: 0,
    report: {
      mode,
      rebuilt: [{ moduleId: 'tarefas', tables: 1, tableNames: ['mls102047_tarefas_tarefa'], seedRows: 0 }],
      untouched: [],
      removed: [],
      orphans: [],
    },
  };
}

async function run(input: {
  app?: AppEnv;
  databaseUrlTest?: string;
  databaseUrl?: string;
  collabProjectId?: string;
  projectIdEnv?: string;
  mode?: ProjectMode;
  declared?: boolean;
  module?: string;
  bootstrap?: (env: AppEnv, options?: { forceRebuild?: boolean; forceModules?: string[] }) => Promise<SchemaBootstrapResult>;
  initializeOrganization?: () => Promise<void>;
}) {
  const calls: Array<{ forceRebuild?: boolean }> = [];
  let org = 0;
  const bootstrap = input.bootstrap ?? (async (_env, options) => {
    calls.push({ forceRebuild: options?.forceRebuild });
    return report('full');
  });
  const result = await resetLocalDb({
    env: input.app ?? env(),
    databaseUrlTest: input.databaseUrlTest,
    databaseUrl: input.databaseUrl,
    collabProjectId: input.collabProjectId ?? '102047',
    projectIdEnv: input.projectIdEnv,
    module: input.module,
    readMode: () => input.mode ?? 'development',
    hasDeclared: () => input.declared ?? true,
    bootstrap: async (appEnv, options) => bootstrap(appEnv, options),
    initializeOrganization: input.initializeOrganization ?? (async () => { org += 1; }),
  });
  return { result, calls, org };
}

test('refuses each invalid target before bootstrap', async () => {
  const cases: Array<{ name: string; input: Parameters<typeof run>[0]; pattern: RegExp }> = [
    { name: 'memory', input: { app: env({ runtimeMode: 'memory' }), databaseUrlTest: LOCAL_TEST }, pattern: /RUNTIME_MODE=memory/u },
    { name: 'missing project', input: { app: env({ projectId: undefined }), databaseUrlTest: LOCAL_TEST, collabProjectId: undefined }, pattern: /project id is missing/u },
    { name: 'divergent project', input: { databaseUrlTest: LOCAL_TEST, collabProjectId: '102034' }, pattern: /diverges from config/u },
    { name: 'divergent PROJECT_ID', input: { databaseUrlTest: LOCAL_TEST, projectIdEnv: '102034' }, pattern: /diverges from config/u },
    { name: 'undeclared', input: { databaseUrlTest: LOCAL_TEST, declared: false, mode: 'presentation' }, pattern: /not a declared test mode/u },
    { name: 'production', input: { databaseUrlTest: LOCAL_TEST, mode: 'production' }, pattern: /not a declared test mode/u },
    { name: 'homologation', input: { databaseUrlTest: LOCAL_TEST, mode: 'homologation' }, pattern: /not a declared test mode/u },
    { name: 'missing test url', input: { databaseUrl: OTHER_DB }, pattern: /DATABASE_URL_TEST is not set/u },
    { name: 'other database', input: { databaseUrlTest: 'postgresql://tester@127.0.0.1:5432/mdm' }, pattern: /expected collab_app_test/u },
    { name: 'remote host', input: { databaseUrlTest: 'postgresql://tester@10.1.1.8:5432/collab_app_test' }, pattern: /not a local host/u },
    { name: 'same productive url', input: { databaseUrlTest: LOCAL_TEST, databaseUrl: LOCAL_TEST }, pattern: /productive database/u },
    { name: 'same productive database', input: { databaseUrlTest: LOCAL_TEST, databaseUrl: 'postgresql://prod@db.internal:5432/collab_app_test' }, pattern: /productive database/u },
  ];
  for (const item of cases) {
    let called = false;
    await assert.rejects(
      () => run({
        ...item.input,
        bootstrap: async () => {
          called = true;
          return report('full');
        },
      }),
      item.pattern,
      item.name,
    );
    assert.equal(called, false, item.name);
  }
});

test('force-rebuilds an identical snapshot once, then initializes the organization', async () => {
  const lines: string[] = [];
  const previous = console.info;
  console.info = (...args: unknown[]) => {
    lines.push(args.map((part) => String(part)).join(' '));
  };
  try {
    const seen: Array<{ forceRebuild?: boolean }> = [];
    const { result, org } = await run({
      databaseUrlTest: LOCAL_TEST,
      databaseUrl: OTHER_DB,
      bootstrap: async (_env, options) => {
        seen.push({ forceRebuild: options?.forceRebuild });
        console.info('[bootstrapSchema] seeding "mdm_company" (project appEnv=\'development\')');
        console.info('[bootstrapSchema] seeding platform table "mdm_org" (server appEnv=\'development\')');
        return report('full');
      },
    });
    const calls = seen;
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.forceRebuild, true);
    assert.equal(org, 1);
    assert.equal(result.report.mode, 'full');
    assert.equal(result.snapshotId, 'snap-same');
    assert.deepEqual(result.report.rebuilt.map((module) => module.moduleId), ['tarefas']);
    const marked = lines.filter((line) => line.startsWith(RESET_LOCAL_DB_MARK));
    assert.equal(marked.length, 1);
    const summary = JSON.parse(marked[0]!.slice(RESET_LOCAL_DB_MARK.length)) as {
      modules: Array<{ moduleId: string; tables: number; seedRows: number }>;
      seededTables: string[];
      database: string;
    };
    assert.deepEqual(summary.modules, [{ moduleId: 'tarefas', tables: 1, seedRows: 0 }]);
    assert.deepEqual(summary.seededTables, ['mdm_company', 'mdm_org']);
    assert.equal(summary.database, 'collab_app_test');
    assert.equal(marked[0]!.includes('postgresql://'), false);
    assert.equal(marked[0]!.includes('tester@'), false);
  } finally {
    console.info = previous;
  }
});

test('a partial bootstrap or organization error propagates and is not rebuilt twice', async () => {
  await assert.rejects(
    () => run({
      databaseUrlTest: LOCAL_TEST,
      bootstrap: async () => { throw new Error('ddl stopped'); },
    }),
    /ddl stopped/u,
  );
  let boots = 0;
  await assert.rejects(
    () => run({
      databaseUrlTest: LOCAL_TEST,
      bootstrap: async () => {
        boots += 1;
        return report('full');
      },
      initializeOrganization: async () => { throw new Error('org stopped'); },
    }),
    /org stopped/u,
  );
  assert.equal(boots, 1);
});

function captureInfo(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const previous = console.info;
  console.info = (...args: unknown[]) => {
    lines.push(args.map((part) => String(part)).join(' '));
  };
  return { lines, restore: () => { console.info = previous; } };
}

test('--module passes forceModules to the bootstrap and writes the module summary', async () => {
  const seen: Array<{ forceRebuild?: boolean; forceModules?: string[] }> = [];
  const capture = captureInfo();
  try {
    const { org } = await run({
      databaseUrlTest: LOCAL_TEST,
      databaseUrl: OTHER_DB,
      module: 'tarefas',
      bootstrap: async (_env, options) => {
        seen.push({ forceRebuild: options?.forceRebuild, forceModules: options?.forceModules });
        return { ...report('modules') };
      },
    });
    assert.equal(org, 1);
  } finally {
    capture.restore();
  }
  assert.deepEqual(seen, [{ forceRebuild: undefined, forceModules: ['tarefas'] }]);
  const marked = capture.lines.filter((line) => line.startsWith(RESET_LOCAL_DB_MARK));
  assert.equal(marked.length, 1);
  assert.deepEqual(JSON.parse(marked[0]!.slice(RESET_LOCAL_DB_MARK.length)), {
    scope: 'module',
    modules: [{ moduleId: 'tarefas', tables: 1, tableNames: ['mls102047_tarefas_tarefa'], seedRows: 0 }],
    viewsRecreated: true,
    seededTables: [],
    database: 'collab_app_test',
  });
});

test('--module keeps the same target guards: a production app is refused before the bootstrap', async () => {
  let called = false;
  await assert.rejects(
    () => run({
      databaseUrlTest: LOCAL_TEST,
      mode: 'production',
      module: 'tarefas',
      bootstrap: async () => { called = true; return report('modules'); },
    }),
    /not a declared test mode/u,
  );
  assert.equal(called, false);
});

test('--module without id, repeated or misspelled is refused before the bootstrap', async () => {
  assert.deepEqual(parseResetLocalDbArgs([]), {});
  assert.deepEqual(parseResetLocalDbArgs(['--module', 'tarefas']), { module: 'tarefas' });
  for (const argv of [['--module'], ['--module', ''], ['--module', '--other'], ['--module', 'a', '--module', 'b'], ['--module=a']]) {
    assert.throws(() => parseResetLocalDbArgs(argv), /\[resetLocalDb\] refused before schema write/u, argv.join(' '));
  }
  let called = false;
  await assert.rejects(
    () => run({
      databaseUrlTest: LOCAL_TEST,
      module: ' ',
      bootstrap: async () => { called = true; return report('full'); },
    }),
    /--module needs a module id/u,
  );
  assert.equal(called, false);
});

test('without --module the call and the line are the ones of today, with scope all', async () => {
  const seen: Array<{ forceRebuild?: boolean; forceModules?: string[] }> = [];
  const capture = captureInfo();
  try {
    await run({
      databaseUrlTest: LOCAL_TEST,
      databaseUrl: OTHER_DB,
      bootstrap: async (_env, options) => {
        seen.push({ forceRebuild: options?.forceRebuild, forceModules: options?.forceModules });
        return report('full');
      },
    });
  } finally {
    capture.restore();
  }
  assert.deepEqual(seen, [{ forceRebuild: true, forceModules: undefined }]);
  const marked = capture.lines.filter((line) => line.startsWith(RESET_LOCAL_DB_MARK));
  assert.deepEqual(JSON.parse(marked[0]!.slice(RESET_LOCAL_DB_MARK.length)), {
    scope: 'all',
    modules: [{ moduleId: 'tarefas', tables: 1, seedRows: 0 }],
    seededTables: [],
    database: 'collab_app_test',
  });
});
