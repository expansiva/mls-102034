/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/seedLifecycle.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const optedIn = process.env.RUN_INTEGRATION_TESTS === 'true';
const modes = ['production', 'homologation', 'presentation', 'development'] as const;
type Mode = (typeof modes)[number];
const projectId = '918118';
const alphaTable = `mls${projectId}_alpha_item`;
const betaTable = `mls${projectId}_beta_note`;
const repoRoot = fileURLToPath(new URL('../../../../..', import.meta.url));

const consumers = [
  'mls-102034/l1/server/layer_1_external/persistence/seedApplier.ts',
  'mls-102034/l1/server/layer_1_external/data/moduleDataRuntime.ts',
  'mls-102034/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.ts',
  'mls-102034/l1/monitor/layer_3_usecases/testsUsecases.ts',
] as const;

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function assertDisposableUrl(url: string, label: string): URL {
  const parsed = new URL(url);
  if (!isLocalHost(parsed.hostname)) {
    throw new Error(`${label} host "${parsed.hostname}" is not local; refusing DDL`);
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  if (!name || name === 'postgres' || name === 'mdm' || name === 'mdm_test') {
    throw new Error(`${label} database "${name}" is not a disposable name created by this test`);
  }
  return parsed;
}

function withDatabase(adminUrl: string, database: string): string {
  const parsed = new URL(adminUrl);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function writeWorkspace(root: string, mode: Mode, seeds: { extraInitial: boolean; race: boolean; extraTest: boolean; badPurpose: boolean }): void {
  mkdirSync(join(root, 'l5'), { recursive: true });
  mkdirSync(join(root, 'mls-918118', 'l5'), { recursive: true });
  mkdirSync(join(root, 'mls-918118', 'l1', 'alpha'), { recursive: true });
  mkdirSync(join(root, 'mls-918118', 'l1', 'beta'), { recursive: true });
  mkdirSync(join(root, 'fe'), { recursive: true });
  const platformLink = join(root, 'mls-102034');
  if (!existsSync(platformLink)) {
    symlinkSync(join(repoRoot, 'mls-102034'), platformLink);
  }
  const projectJson = JSON.stringify({ appEnv: mode });
  writeFileSync(join(root, 'l5', 'project.json'), projectJson);
  writeFileSync(join(root, 'mls-918118', 'l5', 'project.json'), projectJson);
  writeFileSync(join(root, 'config.json'), JSON.stringify({
    defaultProjectId: projectId,
    projects: {
      [projectId]: {
        root: './mls-918118',
        type: 'client',
        persistenceModules: [
          { moduleId: 'alpha', persistenceEntrypoint: '/_918118_/l1/alpha/persistence.js' },
          { moduleId: 'beta', persistenceEntrypoint: '/_918118_/l1/beta/persistence.js' },
        ],
      },
      '102029': { root: './fe', type: 'master frontend' },
      '102034': {
        root: './mls-102034',
        type: 'master backend',
        persistenceModules: [{ moduleId: 'platform', persistenceEntrypoint: '/_102034_/l1/server/persistence.js' }],
      },
    },
  }));
  const purpose = seeds.badPurpose ? 'nope' : 'initial';
  const extraInitial = seeds.extraInitial
    ? ",\n    { org_id: 'o1', code: 'c', sku: 'S3', name: 'new', meta: { n: 1 }, tags: ['n'] }"
    : '';
  const race = seeds.race
    ? ",\n    { org_id: 'o1', code: 'd', sku: 'S4', name: 'race', meta: { n: 2 }, tags: ['r'] }"
    : '';
  const extraTest = seeds.extraTest
    ? ",\n    { org_id: 'o1', code: 't2', sku: 'S5', name: 'later-test', meta: { t: 2 }, tags: ['z'] }"
    : '';
  writeFileSync(join(root, 'mls-918118', 'l1', 'alpha', 'persistence.ts'), `
export const alphaItem = {
  moduleId: 'alpha',
  repositoryName: 'alphaItem',
  tableName: 'alpha_item',
  purpose: 'cadastro',
  description: 'rt118 fixture',
  backupHot: false,
  storageProfile: 'postgres',
  writeMode: 'sync',
  columns: [
    { name: 'org_id', postgresType: 'TEXT' },
    { name: 'code', postgresType: 'TEXT' },
    { name: 'sku', postgresType: 'TEXT' },
    { name: 'name', postgresType: 'TEXT' },
    { name: 'meta', postgresType: 'JSONB' },
    { name: 'tags', postgresType: 'TEXT[]' },
  ],
  primaryKey: ['org_id', 'code'],
  indexes: [{ name: 'alpha_item_sku', columns: ['sku'], unique: true }],
  version: 1,
};
export const tableDefinitions = [alphaItem];
export const alphaInitial = {
  seedFor: 'alphaItem',
  purpose: '${purpose}',
  rows: [
    { org_id: 'o1', code: 'a', sku: 'S1', name: 'orig', meta: { k: 1 }, tags: ['x'] },
    { org_id: 'o1', code: 'b', sku: 'S1', name: 'clash', meta: { k: 2 }, tags: ['y'] }${extraInitial}${race}
  ],
};
export const alphaTest = {
  seedFor: 'alphaItem',
  purpose: 'test',
  rows: [
    { org_id: 'o1', code: 't', sku: 'ST', name: 'mass', meta: { t: true }, tags: ['m'] }${extraTest}
  ],
};
`);
  writeFileSync(join(root, 'mls-918118', 'l1', 'beta', 'persistence.ts'), `
export const betaNote = {
  moduleId: 'beta',
  repositoryName: 'betaNote',
  tableName: 'beta_note',
  purpose: 'cadastro',
  description: 'rt118 other module',
  backupHot: false,
  storageProfile: 'postgres',
  writeMode: 'sync',
  columns: [
    { name: 'id', postgresType: 'TEXT' },
    { name: 'name', postgresType: 'TEXT' },
  ],
  primaryKey: ['id'],
  version: 1,
  seedRows: [{ id: 'legacy', name: 'legacy' }],
};
export const tableDefinitions = [betaNote];
export const betaInitial = {
  seedFor: 'betaNote',
  purpose: 'initial',
  rows: [{ id: 'b1', name: 'beta' }],
};
`);
}

async function runChild(workspace: string, databaseUrl: string): Promise<{ code: number; stdout: string; stderr: string; payload: Record<string, unknown> | null }> {
  const tsx = join(repoRoot, 'node_modules', '.bin', 'tsx');
  const hooks = join(repoRoot, 'test', 'register-hooks.mjs');
  const tsconfig = join(repoRoot, 'test', 'tsconfig.runtime.json');
  const child = spawn(tsx, ['--import', hooks, fileURLToPath(import.meta.url)], {
    cwd: workspace,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
      RT118_CHILD: '1',
      APP_ENV: 'development',
      RUNTIME_MODE: 'postgres',
      PROJECT_ID: projectId,
      DATABASE_URL: databaseUrl,
      DATABASE_URL_TEST: databaseUrl,
      TSX_TSCONFIG_PATH: tsconfig,
    },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (status) => resolve(status ?? 1));
  });
  const line = stdout.split('\n').find((item) => item.startsWith('RT118_JSON '));
  return { code, stdout, stderr, payload: line ? JSON.parse(line.slice('RT118_JSON '.length)) as Record<string, unknown> : null };
}

async function childMain(): Promise<void> {
  const { readAppEnv } = await import('/_102034_/l1/server/layer_1_external/config/env.js');
  const { getSharedPgPool } = await import('/_102034_/l1/server/layer_1_external/data/postgres/pg.js');
  const { createMemoryModuleDataRuntime } = await import('/_102034_/l1/server/layer_1_external/data/moduleDataRuntime.js');
  const { readProjectMode } = await import('/_102034_/l1/server/layer_1_external/config/projectMode.js');
  const { loadResolvedTableDefinitions } = await import('/_102034_/l1/server/layer_1_external/persistence/registry.js');
  const { bootstrapSchema } = await import('/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js');
  const { selectMonitorSeedRows } = await import('/_102034_/l1/monitor/layer_3_usecases/testsUsecases.js');
  const env = readAppEnv();
  const mode = readProjectMode(projectId);
  const result = await bootstrapSchema(env, { ensureDynamo: false, recordSnapshotLog: false });
  const definitions = await loadResolvedTableDefinitions(env);
  const alpha = definitions.find((definition) => definition.repositoryName === 'alphaItem');
  const beta = definitions.find((definition) => definition.repositoryName === 'betaNote');
  if (!alpha || !beta) {
    throw new Error('fixture tables missing from registry');
  }
  const memory = createMemoryModuleDataRuntime(env);
  const alphaMemory = await memory.getTable<Record<string, unknown>>('alphaItem');
  const first = await alphaMemory.findMany();
  await alphaMemory.update({ where: { code: 'a' }, patch: { name: 'memory-edit' } });
  const second = await alphaMemory.findMany();
  const monitorBeta = selectMonitorSeedRows(beta, {
    tableName: beta.tableName,
    logicalTableName: beta.logicalTableName,
    projectMode: mode,
    serverMode: readProjectMode(env.projectId),
  });
  const testMode = mode === 'development' || mode === 'presentation';
  const codes = first.map((row) => row.code);
  assert.equal(codes.includes('a'), true);
  assert.equal(codes.includes('t'), testMode);
  assert.equal(second.find((row) => row.code === 'a')?.name, 'memory-edit');
  assert.deepEqual(monitorBeta.map((row) => row.id).sort(), testMode ? ['b1', 'legacy'] : ['b1']);
  const pool = getSharedPgPool(env);
  await pool.end();
  console.log(`RT118_JSON ${JSON.stringify({ plan: result.report.mode, rebuilt: result.report.rebuilt, snapshotId: result.snapshotId })}`);
}

if (process.env.RT118_CHILD === '1') {
  childMain().then(() => process.exit(0)).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
} else {
  test('seed selection stays on the four consumers and initial apply stays outside the rebuild branch', () => {
    const bootstrap = readFileSync(join(repoRoot, 'mls-102034/l1/server/layer_1_external/persistence/schemaBootstrap.ts'), 'utf8');
    const rebuildAt = bootstrap.indexOf('async function rebuildPostgresSchema');
    const applyAt = bootstrap.indexOf('const seedCounts = await applySeedRows(');
    assert.equal(applyAt > rebuildAt, true);
    assert.equal(bootstrap.slice(rebuildAt, applyAt).includes('await applySeedRows('), false);
    for (const relative of consumers) {
      const source = readFileSync(join(repoRoot, relative), 'utf8');
      assert.equal(
        source.includes('selectEligibleSeedRows') || source.includes('copyEligibleSeedRows'),
        true,
        relative,
      );
    }
  });

  test('postgres: initial survives every mode without a seed-only rebuild', { skip: !optedIn, timeout: 180000 }, async () => {
    // Explicit only: no DATABASE_URL and no default credential as a fallback.
    const adminUrl = process.env.RT118_PG_ADMIN;
    if (!adminUrl) throw new Error('RT118_PG_ADMIN is required (local tunnel admin URL of a role with CREATEDB)');
    const adminParsed = new URL(adminUrl);
    if (!isLocalHost(adminParsed.hostname)) {
      throw new Error(`admin host "${adminParsed.hostname}" is not local; no fallback`);
    }
    const admin = new Client({ connectionString: adminUrl });
    try {
      await admin.connect();
    } catch (error) {
      throw new Error(`local postgres unavailable (${error instanceof Error ? error.message : String(error)})`);
    }
    const created: string[] = [];
    try {
      for (const mode of modes) {
        const database = `rt118s6_${mode}_${process.pid}_${Math.random().toString(16).slice(2, 8)}`;
        await admin.query(`CREATE DATABASE ${quoteIdent(database)}`);
        created.push(database);
        const databaseUrl = withDatabase(adminUrl, database);
        assertDisposableUrl(databaseUrl, mode);
        const workspace = mkdtempSync(join(tmpdir(), 'rt118-s6-'));
        const probe = new Client({ connectionString: databaseUrl });
        await probe.connect();
        try {
          writeWorkspace(workspace, mode, { extraInitial: false, race: false, extraTest: false, badPurpose: false });
          const first = await runChild(workspace, databaseUrl);
          assert.equal(first.code, 0, first.stderr || first.stdout);
          assert.notEqual(first.payload?.plan, 'none');
          const testMode = mode === 'development' || mode === 'presentation';
          const alpha = await probe.query<{ code: string; name: string; meta: { k?: number }; tags: string[] }>(
            `SELECT code, name, meta, tags FROM ${quoteIdent(alphaTable)} ORDER BY code`,
          );
          assert.deepEqual(alpha.rows.map((row) => row.code), testMode ? ['a', 't'] : ['a']);
          assert.equal(alpha.rows[0]?.name, 'orig');
          assert.deepEqual(alpha.rows[0]?.meta, { k: 1 });
          assert.deepEqual(alpha.rows[0]?.tags, ['x']);
          const betaBefore = await probe.query<{ id: string; name: string }>(
            `SELECT id, name FROM ${quoteIdent(betaTable)} ORDER BY id`,
          );
          assert.deepEqual(betaBefore.rows, testMode
            ? [{ id: 'b1', name: 'beta' }, { id: 'legacy', name: 'legacy' }]
            : [{ id: 'b1', name: 'beta' }]);
          const oidBefore = await probe.query<{ oid: string }>(
            'SELECT c.oid::text AS oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2',
            ['public', alphaTable],
          );
          await probe.query(`UPDATE ${quoteIdent(alphaTable)} SET name = 'edited' WHERE code = 'a'`);
          await probe.query(
            `INSERT INTO ${quoteIdent(alphaTable)} (org_id, code, sku, name, meta, tags) VALUES ('u1', 'u', 'SU', 'user', '{"u":true}', '{user}')`,
          );
          await probe.query(`UPDATE ${quoteIdent(betaTable)} SET name = 'beta-edited' WHERE id = 'b1'`);
          await probe.query(`INSERT INTO ${quoteIdent(betaTable)} (id, name) VALUES ('user', 'kept')`);
          writeWorkspace(workspace, mode, { extraInitial: true, race: false, extraTest: true, badPurpose: false });
          const second = await runChild(workspace, databaseUrl);
          assert.equal(second.code, 0, second.stderr || second.stdout);
          assert.equal(second.payload?.plan, 'none');
          const oidAfter = await probe.query<{ oid: string }>(
            'SELECT c.oid::text AS oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2',
            ['public', alphaTable],
          );
          assert.equal(oidAfter.rows[0]?.oid, oidBefore.rows[0]?.oid);
          const alphaAfter = await probe.query<{ code: string; name: string }>(
            `SELECT code, name FROM ${quoteIdent(alphaTable)} ORDER BY code`,
          );
          const names = Object.fromEntries(alphaAfter.rows.map((row) => [row.code, row.name]));
          assert.equal(names.a, 'edited');
          assert.equal(names.u, 'user');
          assert.equal(names.c, 'new');
          assert.equal('d' in names, false);
          assert.equal('t2' in names, false);
          assert.equal('b' in names, false);
          assert.equal(names.t, testMode ? 'mass' : undefined);
          const betaAfter = await probe.query<{ id: string; name: string }>(
            `SELECT id, name FROM ${quoteIdent(betaTable)} ORDER BY id`,
          );
          assert.deepEqual(betaAfter.rows, testMode
            ? [{ id: 'b1', name: 'beta-edited' }, { id: 'legacy', name: 'legacy' }, { id: 'user', name: 'kept' }]
            : [{ id: 'b1', name: 'beta-edited' }, { id: 'user', name: 'kept' }]);
          writeWorkspace(workspace, mode, { extraInitial: true, race: true, extraTest: true, badPurpose: false });
          const pair = await Promise.all([runChild(workspace, databaseUrl), runChild(workspace, databaseUrl)]);
          assert.equal(pair[0].code, 0, pair[0].stderr);
          assert.equal(pair[1].code, 0, pair[1].stderr);
          assert.equal(pair[0].payload?.plan, 'none');
          assert.equal(pair[1].payload?.plan, 'none');
          const raced = await probe.query(`SELECT count(*)::int AS n FROM ${quoteIdent(alphaTable)} WHERE code = 'd'`);
          assert.equal(raced.rows[0]?.n, 1);
          writeWorkspace(workspace, mode, { extraInitial: true, race: true, extraTest: true, badPurpose: true });
          const invalid = await runChild(workspace, databaseUrl);
          assert.notEqual(invalid.code, 0);
          assert.match(`${invalid.stderr}\n${invalid.stdout}`, /purpose|PERSISTENCE_SEED_INVALID/u);
          const still = await probe.query(`SELECT name FROM ${quoteIdent(alphaTable)} WHERE code = 'a'`);
          assert.equal(still.rows[0]?.name, 'edited');
        } finally {
          await probe.end();
          rmSync(workspace, { recursive: true, force: true });
        }
      }
    } finally {
      for (const database of created) {
        await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [database]);
        await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(database)}`);
      }
      await admin.end();
    }
  });
}
