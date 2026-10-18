/// <mls fileReference="_102034_/l1/scripts/resetLocalDb.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import type { ProjectMode } from '/_102034_/l1/server/layer_1_external/config/projectMode.js';
import type { SchemaBootstrapResult } from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';
import { resetLocalDb } from '/_102034_/l1/scripts/resetLocalDb.js';

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
      rebuilt: [{ moduleId: 'tarefas', tables: 1, seedRows: 0 }],
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
  bootstrap?: (env: AppEnv, options?: { forceRebuild?: boolean }) => Promise<SchemaBootstrapResult>;
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
  const { result, calls, org } = await run({ databaseUrlTest: LOCAL_TEST, databaseUrl: OTHER_DB });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.forceRebuild, true);
  assert.equal(org, 1);
  assert.equal(result.report.mode, 'full');
  assert.equal(result.snapshotId, 'snap-same');
  assert.deepEqual(result.report.rebuilt.map((module) => module.moduleId), ['tarefas']);
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
