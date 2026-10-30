/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { draftSlugForUser } from '/_102034_/l1/server/layer_1_external/cbe/cbeDraft.js';
import { DEFAULT_APPCONFIG_FILE } from '/_102034_/l1/server/layer_1_external/cbe/cbeProviderToken.js';
import {
  AncestorDenoConfigError,
  DenoMissingError,
  DraftDatabaseError,
  DraftWorktreeMissingError,
  buildDenoArgs,
  draftDatabaseName,
  draftDatabaseUrl,
  ensureDevProcess,
  setDevIdentitySecretForTests,
  stopDevProcess,
  ensureDevReaper,
  findAncestorDenoConfig,
  isDevPidAlive,
  linkSharedProjects,
  memoryModeAllowEnv,
  reapIdle,
  releaseAliasOf,
  restartDevProcess,
  touchDevProcess,
  waitForDevReady,
  type DevSpawn,
  type DevSpawnOptions,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.js';

const IDLE_MS = 30 * 60 * 1000;
const SLUG = 'team-102047';
const PARENT_TEST_URL = 'postgres://collab:secret@127.0.0.1:5432/collab_app_test';
const DRAFT_DATABASE = 'collab_app_draft_team_102047';

function writeOwnReleaseConfig(base: string, projectId = 102047, body = '{"release":true}\n'): void {
  const dir = join(base, `current-${projectId}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), body);
}

test('draftDatabaseUrl keeps the parent connection and swaps only the database name', () => {
  const url = draftDatabaseUrl(PARENT_TEST_URL, SLUG, 102047);
  const parsed = new URL(url);
  assert.equal(parsed.username, 'collab');
  assert.equal(parsed.password, 'secret');
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.equal(parsed.port, '5432');
  assert.equal(parsed.pathname, `/${DRAFT_DATABASE}`);
  assert.equal(url, `postgres://collab:secret@127.0.0.1:5432/${DRAFT_DATABASE}`);
  assert.notEqual(parsed.pathname, '/collab_app_test');

  const mixed = new URL(draftDatabaseUrl(PARENT_TEST_URL, 'Team.A@b-9', 102047));
  assert.equal(mixed.pathname, '/collab_app_draft_team_a_b_9');
  assert.equal(mixed.username, 'collab');
  assert.equal(mixed.hostname, '127.0.0.1');
  assert.equal(mixed.port, '5432');

  const capped = new URL(draftDatabaseUrl(PARENT_TEST_URL, 'abcdefghijklmnopqrstuvwxyz', 102047)).pathname.slice(1);
  assert.equal(capped.length, 40);
  assert.equal(capped, 'collab_app_draft_abcdefghijklmnopqrstuvw');

  assert.throws(() => draftDatabaseUrl('not a url', SLUG, 102047), /invalid database url/);
  assert.throws(() => draftDatabaseUrl('postgres://collab:secret@127.0.0.1:5432', SLUG, 102047), /invalid database url/);
});

test('draftDatabaseName: user drafts include project; team name unchanged', () => {
  const a = draftSlugForUser('ana_b@x.com');
  const b = draftSlugForUser('ana@b.x.com');
  const h12a = a.slug.slice('user-'.length, 'user-'.length + 12);
  const h12b = b.slug.slice('user-'.length, 'user-'.length + 12);
  assert.notEqual(h12a, h12b);
  assert.equal(draftDatabaseName(a.slug, 102056), `collab_app_draft_102056_u${h12a}`);
  assert.equal(draftDatabaseName(a.slug, 102047), `collab_app_draft_102047_u${h12a}`);
  assert.notEqual(draftDatabaseName(a.slug, 102056), draftDatabaseName(a.slug, 102047));
  assert.notEqual(draftDatabaseName(a.slug, 102056), draftDatabaseName(b.slug, 102056));
  assert.equal(draftDatabaseName(a.slug, 102056).length, `collab_app_draft_102056_u${h12a}`.length);
  assert.equal(draftDatabaseName(draftSlugForUser('ANA_B@X.COM').slug, 102056), draftDatabaseName(a.slug, 102056));
  assert.equal(draftDatabaseName('team-102056', 102056), 'collab_app_draft_team_102056');
  assert.equal(draftDatabaseName('team-102047', 999), 'collab_app_draft_team_102047');
});

test('memoryModeAllowEnv contains the measured env names once', () => {
  const names = memoryModeAllowEnv();
  assert.equal(names.includes('COLLAB_AUTH_BASE_URL'), true);
  assert.equal(names.includes('APP_ENV'), true);
  assert.equal(names.includes('DATABASE_URL'), false);
  assert.equal(new Set(names).size, names.length);
});

function envNamesReadInL1(): Set<string> {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const dot = /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/gu;
  const bracket = /process\.env\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]/gu;
  const names = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'scripts') continue;
        walk(join(dir, entry.name));
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
      const text = readFileSync(join(dir, entry.name), 'utf8');
      for (const match of text.matchAll(dot)) names.add(match[1]);
      for (const match of text.matchAll(bracket)) names.add(match[1]);
    }
  };
  walk(root);
  return names;
}

function allowEnvCovers(allowNames: ReadonlySet<string>, name: string): boolean {
  if (allowNames.has(name)) return true;
  for (const pattern of allowNames) {
    if (pattern.endsWith('*') && pattern.length > 1 && name.startsWith(pattern.slice(0, -1))) return true;
  }
  return false;
}

test('dev --allow-env covers every l1 env read except DATABASE_URL', () => {
  const allow = buildDenoArgs('/tmp/base', SLUG, 4100, draftDatabaseUrl(PARENT_TEST_URL, SLUG, 102047))
    .find((arg) => arg.startsWith('--allow-env='));
  assert.ok(allow);
  const allowNames = new Set(allow.slice('--allow-env='.length).split(','));
  assert.equal(allowNames.has('PG*'), true);
  assert.equal(allowNames.has('USERNAME'), true);
  assert.equal(allowNames.has('DATABASE_URL'), false);
  assert.equal(allowEnvCovers(allowNames, 'PGBINARY'), true);
  const missing = [...envNamesReadInL1()].filter((name) => name !== 'DATABASE_URL' && !allowEnvCovers(allowNames, name));
  assert.deepEqual(missing, []);
});

test('the default appconfig path (OAuth client secrets) is outside every --allow-read root of the draft process', () => {
  const base = '/data/mls-base';
  const args = buildDenoArgs(base, SLUG, 4100, draftDatabaseUrl(PARENT_TEST_URL, SLUG, 102047));
  const allow = args.find((arg) => arg.startsWith('--allow-read='));
  assert.ok(allow);
  for (const root of allow.slice('--allow-read='.length).split(',')) {
    const prefix = root.endsWith('/') ? root : `${root}/`;
    assert.equal(DEFAULT_APPCONFIG_FILE === root || DEFAULT_APPCONFIG_FILE.startsWith(prefix), false, `${DEFAULT_APPCONFIG_FILE} is readable through ${root}`);
  }
});

test('dev --allow-read ends with CBE_PROJECT_FILES_DIR', () => {
  const previous = process.env.CBE_PROJECT_FILES_DIR;
  process.env.CBE_PROJECT_FILES_DIR = '/x/projects';
  try {
    const allow = buildDenoArgs('/tmp/base', SLUG, 4100, draftDatabaseUrl(PARENT_TEST_URL, SLUG, 102047))
      .find((arg) => arg.startsWith('--allow-read='));
    assert.ok(allow);
    assert.equal(allow.endsWith(',/x/projects'), true);
  } finally {
    if (previous === undefined) delete process.env.CBE_PROJECT_FILES_DIR;
    else process.env.CBE_PROJECT_FILES_DIR = previous;
  }
});

test('draft --allow-read uses the real project path and keeps appconfig outside it', () => {
  const root = mkdtempSync(join(tmpdir(), 'cbe-allow-'));
  const dataEtc = join(root, 'data', 'etc');
  const projects = join(dataEtc, 'projects');
  mkdirSync(projects, { recursive: true });
  writeFileSync(join(dataEtc, 'appconfig.json'), '{}\n');
  const etcCollab = join(root, 'etc', 'collab');
  mkdirSync(dirname(etcCollab), { recursive: true });
  symlinkSync(dataEtc, etcCollab);
  const linkedProjects = join(etcCollab, 'projects');
  const linkedAppconfig = join(etcCollab, 'appconfig.json');
  const missing = join(root, 'missing', 'projects');
  const previousProjects = process.env.CBE_PROJECT_FILES_DIR;
  const previousAppconfig = process.env.COLLAB_APPCONFIG_FILE;
  const databaseUrl = draftDatabaseUrl(PARENT_TEST_URL, SLUG, 102047);
  try {
    process.env.CBE_PROJECT_FILES_DIR = missing;
    const missingAllow = buildDenoArgs('/tmp/base', SLUG, 4100, databaseUrl)
      .find((arg) => arg.startsWith('--allow-read='));
    assert.ok(missingAllow);
    assert.equal(missingAllow.endsWith(`,${missing}`), true);
    assert.equal(process.env.CBE_PROJECT_FILES_DIR, missing);

    process.env.CBE_PROJECT_FILES_DIR = linkedProjects;
    process.env.COLLAB_APPCONFIG_FILE = linkedAppconfig;
    const allow = buildDenoArgs('/tmp/base', SLUG, 4100, databaseUrl)
      .find((arg) => arg.startsWith('--allow-read='));
    assert.ok(allow);
    const realProjects = realpathSync(linkedProjects);
    const roots = allow.slice('--allow-read='.length).split(',');
    assert.equal(roots.includes(linkedProjects), true, 'the link path must be allowed: Deno does not resolve it first');
    assert.equal(roots.includes(realProjects), true);
    assert.equal(process.env.CBE_PROJECT_FILES_DIR, linkedProjects);
    const appconfig = process.env.COLLAB_APPCONFIG_FILE;
    const appconfigReal = realpathSync(appconfig);
    for (const entry of allow.slice('--allow-read='.length).split(',')) {
      const prefix = entry.endsWith('/') ? entry : `${entry}/`;
      assert.equal(appconfig === entry || appconfig.startsWith(prefix), false, `${appconfig} is readable through ${entry}`);
      assert.equal(appconfigReal === entry || appconfigReal.startsWith(prefix), false, `${appconfigReal} is readable through ${entry}`);
      assert.equal(DEFAULT_APPCONFIG_FILE === entry || DEFAULT_APPCONFIG_FILE.startsWith(prefix), false);
    }
  } finally {
    if (previousProjects === undefined) delete process.env.CBE_PROJECT_FILES_DIR;
    else process.env.CBE_PROJECT_FILES_DIR = previousProjects;
    if (previousAppconfig === undefined) delete process.env.COLLAB_APPCONFIG_FILE;
    else process.env.COLLAB_APPCONFIG_FILE = previousAppconfig;
    rmSync(root, { recursive: true, force: true });
  }
});

function dummyPid(pids: number[]): number {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  assert.ok(child.pid);
  pids.push(child.pid);
  return child.pid;
}

function killPids(pids: number[]): void {
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
}

async function waitDead(pid: number): Promise<void> {
  const deadline = Date.now() + 2000;
  while (isDevPidAlive(pid)) {
    if (Date.now() > deadline) return;
    await new Promise((done) => setTimeout(done, 20));
  }
}

function writeDev(base: string, slug: string, record: { port: number; pid: number; startedAt: number; lastRequestAt: number }): void {
  const dir = join(base, 'drafts', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'dev.json'), `${JSON.stringify(record)}\n`);
}

test('dev process: ensure, restart debounce, reapIdle', async (t) => {
  const pids: number[] = [];
  const prevRange = process.env.COLLAB_DEV_PORT_RANGE;
  const prevMax = process.env.COLLAB_DEV_MAX;
  const prevDatabase = process.env.DATABASE_URL;
  const prevTestDatabase = process.env.DATABASE_URL_TEST;
  process.env.COLLAB_DEV_PORT_RANGE = '4100-4199';
  process.env.DATABASE_URL = 'postgres://should-not-leak';
  process.env.DATABASE_URL_TEST = PARENT_TEST_URL;
  t.after(() => {
    killPids(pids);
    if (prevRange === undefined) delete process.env.COLLAB_DEV_PORT_RANGE;
    else process.env.COLLAB_DEV_PORT_RANGE = prevRange;
    if (prevMax === undefined) delete process.env.COLLAB_DEV_MAX;
    else process.env.COLLAB_DEV_MAX = prevMax;
    if (prevDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDatabase;
    if (prevTestDatabase === undefined) delete process.env.DATABASE_URL_TEST;
    else process.env.DATABASE_URL_TEST = prevTestDatabase;
  });

  await t.test('first ensure spawns once with the measured flags; second does not', () => {
    const base = mkdtempSync(join(tmpdir(), 'cbe-dev-'));
    try {
      writeOwnReleaseConfig(base);
      mkdirSync(join(base, 'drafts', SLUG, 'mls-102047'), { recursive: true });
      const calls: Array<{ command: string; args: string[]; options: DevSpawnOptions }> = [];
      const spawnDev: DevSpawn = (command, args, options) => {
        calls.push({ command, args, options });
        return { pid: dummyPid(pids) };
      };
      const now = () => 1_700_000_000_000;
      const writeConfig = () => {};
      const draftUrl = draftDatabaseUrl(PARENT_TEST_URL, SLUG, 102047);
      process.env.DATABASE_URL_TEST = PARENT_TEST_URL;
      const first = ensureDevProcess({ base, slug: SLUG, clientProjectId: 102047, spawn: spawnDev, now, writeConfig });
      const second = ensureDevProcess({ base, slug: SLUG, clientProjectId: 102047, spawn: spawnDev, now, writeConfig });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].command, 'deno');
      assert.deepEqual(calls[0].args, buildDenoArgs(base, SLUG, 4100, draftUrl));
      const projectFilesDir = process.env.CBE_PROJECT_FILES_DIR ?? '/etc/collab/projects';
      const projectFilesAllow = [...new Set([projectFilesDir, ...(existsSync(projectFilesDir) ? [realpathSync(projectFilesDir)] : [])])];
      assert.deepEqual(calls[0].args, [
        'run',
        `--allow-read=${base},${join(base, 'drafts', SLUG)},${projectFilesAllow.join(',')}`,
        `--allow-env=${[...memoryModeAllowEnv(), 'DATABASE_URL_TEST', 'PG*', 'USERNAME', 'MDM_DATABASE_URL'].join(',')}`,
        '--allow-net=0.0.0.0:4100,127.0.0.1,127.0.0.1:5432',
        '--allow-sys=networkInterfaces,loadavg,systemMemoryInfo,cpus',
        '--config',
        join(base, 'drafts', SLUG, 'deno.json'),
        '--node-modules-dir=manual',
        '--no-lock',
        join(base, 'mls-102034', 'l1', 'server', 'layer_1_external', 'transport', 'http', 'startServer.ts'),
      ]);
      const allowEnv = calls[0].args[2];
      const allowNames = allowEnv.slice('--allow-env='.length).split(',');
      for (const key of ['APP_ENV', 'PORT', 'PORT_DEVELOPMENT', 'RUNTIME_MODE', 'COLLAB_PROJECT_ID', 'PGPASSWORD']) {
        assert.equal(allowNames.includes(key), true, key);
      }
      assert.equal(allowNames.includes('DATABASE_URL'), false);
      assert.equal(allowEnv.includes('--allow-all'), false);
      assert.equal(calls[0].args.includes('--allow-write'), false);
      assert.equal(calls[0].args.includes('--allow-run'), false);
      assert.equal(calls[0].options.cwd, join(base, 'drafts', SLUG));
      assert.equal(calls[0].options.env.PORT, '4100');
      assert.equal(calls[0].options.env.APP_ENV, 'development');
      assert.equal(calls[0].options.env.RUNTIME_MODE, 'postgres');
      assert.equal(calls[0].options.env.DATABASE_URL_TEST, draftUrl);
      assert.equal(new URL(calls[0].options.env.DATABASE_URL_TEST).pathname, `/${DRAFT_DATABASE}`);
      assert.equal(calls[0].options.env.MDM_DATABASE_URL, PARENT_TEST_URL);
      assert.equal(new URL(calls[0].options.env.MDM_DATABASE_URL).pathname, '/collab_app_test');
      assert.equal(calls[0].args.some((arg) => arg.startsWith('--allow-net=') && arg.includes('127.0.0.1:5432')), true);
      assert.equal(calls[0].options.env.COLLAB_RUNTIME_MODE, undefined);
      assert.equal(calls[0].options.env.COLLAB_DRAFT, SLUG);
      assert.equal(calls[0].options.env.COLLAB_PROJECT_ID, '102047');
      assert.equal(calls[0].options.env.DATABASE_URL, undefined);
      assert.equal(calls[0].options.logPath, join(base, 'logs', `dev-${SLUG}.log`));
      assert.equal(readFileSync(join(base, 'drafts', SLUG, 'config.json'), 'utf8'), '{"release":true}\n');
      const stored = JSON.parse(readFileSync(join(base, 'drafts', SLUG, 'dev.json'), 'utf8'));
      assert.deepEqual(stored, { port: 4100, pid: first.pid, startedAt: now(), lastRequestAt: now(), database: DRAFT_DATABASE });
      assert.equal(second.pid, first.pid);
      assert.equal(isDevPidAlive(first.pid), true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  await t.test('restart kills and re-spawns once per burst', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cbe-dev-'));
    try {
      writeOwnReleaseConfig(base);
      mkdirSync(join(base, 'drafts', SLUG, 'mls-102047'), { recursive: true });
      const calls: number[] = [];
      const spawnDev: DevSpawn = () => {
        const pid = dummyPid(pids);
        calls.push(pid);
        return { pid };
      };
      const opts = { base, slug: SLUG, clientProjectId: 102047, spawn: spawnDev, now: () => 1_700_000_000_000, writeConfig: () => {} };
      const first = ensureDevProcess(opts);
      const pending = [restartDevProcess(opts), restartDevProcess(opts), restartDevProcess(opts)];
      assert.equal(calls.length, 1);
      const restarted = await Promise.all(pending);
      assert.equal(calls.length, 2);
      assert.equal(restarted[0].pid, restarted[1].pid);
      assert.equal(restarted[1].pid, restarted[2].pid);
      assert.notEqual(restarted[0].pid, first.pid);
      await waitDead(first.pid);
      assert.equal(isDevPidAlive(first.pid), false);
      assert.equal(JSON.parse(readFileSync(join(base, 'drafts', SLUG, 'dev.json'), 'utf8')).pid, restarted[0].pid);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  await t.test('the identity secret is per process, reaches the child env, and is never written to dev.json', () => {
    const base = mkdtempSync(join(tmpdir(), 'cbe-dev-'));
    try {
      writeOwnReleaseConfig(base);
      mkdirSync(join(base, 'drafts', SLUG, 'mls-102047'), { recursive: true });
      const secrets: string[] = [];
      const spawnDev: DevSpawn = (_command, _args, options) => {
        secrets.push(options.env.COLLAB_DRAFT_IDENTITY_SECRET);
        return { pid: dummyPid(pids) };
      };
      const opts = { base, slug: SLUG, clientProjectId: 102047, spawn: spawnDev, now: () => 1, writeConfig: () => {} };
      const first = ensureDevProcess(opts);
      assert.match(secrets[0], /^[0-9a-f]{64}$/u);
      assert.equal(first.identitySecret, secrets[0]);
      assert.equal(readFileSync(join(base, 'drafts', SLUG, 'dev.json'), 'utf8').includes(secrets[0]), false);
      const again = ensureDevProcess(opts);
      assert.equal(secrets.length, 1);
      assert.equal(again.identitySecret, secrets[0]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  await t.test('a live child whose secret the parent lost (parent restart) is replaced, not reused', () => {
    const base = mkdtempSync(join(tmpdir(), 'cbe-dev-'));
    try {
      writeOwnReleaseConfig(base);
      mkdirSync(join(base, 'drafts', SLUG, 'mls-102047'), { recursive: true });
      // Reparented like the real dev process (detached under init), so a SIGTERM leaves no zombie behind.
      const launched = spawnSync('sh', ['-c', `${process.execPath} -e 'setInterval(() => {}, 1000)' >/dev/null 2>&1 & echo $!`], { encoding: 'utf8' });
      const orphan = Number(launched.stdout.trim());
      assert.ok(Number.isInteger(orphan) && orphan > 0);
      pids.push(orphan);
      writeDev(base, SLUG, { port: 4100, pid: orphan, startedAt: 1, lastRequestAt: 1 });
      const secrets: string[] = [];
      const info = ensureDevProcess({
        base,
        slug: SLUG,
        clientProjectId: 102047,
        now: () => 2,
        writeConfig: () => {},
        spawn: (_command, _args, options) => {
          secrets.push(options.env.COLLAB_DRAFT_IDENTITY_SECRET);
          return { pid: dummyPid(pids) };
        },
      });
      assert.equal(secrets.length, 1);
      assert.notEqual(info.pid, orphan);
      assert.equal(info.identitySecret, secrets[0]);
      assert.equal(isDevPidAlive(orphan), false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  await t.test('restart of a dead pid only clears dev.json, then spawns', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cbe-dev-'));
    try {
      writeOwnReleaseConfig(base);
      mkdirSync(join(base, 'drafts', SLUG, 'mls-102047'), { recursive: true });
      writeDev(base, SLUG, { port: 4100, pid: 2_147_483_646, startedAt: 1, lastRequestAt: 1 });
      let spawned = 0;
      const info = await restartDevProcess({
        base,
        slug: SLUG,
        clientProjectId: 102047,
        now: () => 5,
        writeConfig: () => {},
        spawn: () => {
          spawned += 1;
          return { pid: dummyPid(pids) };
        },
      });
      assert.equal(spawned, 1);
      assert.equal(info.pid > 0, true);
      assert.notEqual(info.pid, 2_147_483_646);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  await t.test('writeConfig runs once before the first spawn and a failure does not spawn or write dev.json', () => {
    const base = mkdtempSync(join(tmpdir(), 'cbe-dev-'));
    try {
      writeOwnReleaseConfig(base);
      mkdirSync(join(base, 'drafts', SLUG, 'mls-102047'), { recursive: true });
      const order: string[] = [];
      const now = () => 1_700_000_000_000;
      const writeConfig = () => { order.push('write'); };
      const spawnDev: DevSpawn = () => {
        order.push('spawn');
        return { pid: dummyPid(pids) };
      };
      ensureDevProcess({ base, slug: SLUG, clientProjectId: 102047, spawn: spawnDev, now, writeConfig });
      ensureDevProcess({ base, slug: SLUG, clientProjectId: 102047, spawn: spawnDev, now, writeConfig });
      assert.deepEqual(order, ['write', 'spawn']);

      const other = 'team-102048';
      mkdirSync(join(base, 'drafts', other, 'mls-102047'), { recursive: true });
      let spawned = 0;
      assert.throws(() => ensureDevProcess({
        base,
        slug: other,
        clientProjectId: 102047,
        now,
        spawn: () => {
          spawned += 1;
          return { pid: dummyPid(pids) };
        },
        writeConfig: () => { throw new Error('config write failed'); },
      }), /config write failed/);
      assert.equal(spawned, 0);
      assert.equal(existsSync(join(base, 'drafts', other, 'dev.json')), false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  await t.test('reapIdle drops the idle process and enforces COLLAB_DEV_MAX', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cbe-dev-'));
    process.env.COLLAB_DEV_MAX = '2';
    try {
      const now = 1_700_000_000_000;
      const idlePid = dummyPid(pids);
      const olderPid = dummyPid(pids);
      const middlePid = dummyPid(pids);
      const newestPid = dummyPid(pids);
      writeDev(base, 'team-idle', { port: 4100, pid: idlePid, startedAt: now - IDLE_MS - 1, lastRequestAt: now - IDLE_MS - 1 });
      writeDev(base, 'team-older', { port: 4101, pid: olderPid, startedAt: now - 3_000, lastRequestAt: now - 3_000 });
      writeDev(base, 'team-middle', { port: 4102, pid: middlePid, startedAt: now - 2_000, lastRequestAt: now - 2_000 });
      writeDev(base, 'team-newest', { port: 4103, pid: newestPid, startedAt: now - 1_000, lastRequestAt: now - 1_000 });
      writeDev(base, 'team-dead', { port: 4104, pid: 2_147_483_646, startedAt: 1, lastRequestAt: 1 });

      reapIdle({ base, now });

      await waitDead(idlePid);
      await waitDead(olderPid);
      assert.equal(isDevPidAlive(idlePid), false);
      assert.equal(isDevPidAlive(olderPid), false);
      assert.equal(isDevPidAlive(middlePid), true);
      assert.equal(isDevPidAlive(newestPid), true);
      assert.equal(existsDev(base, 'team-idle'), false);
      assert.equal(existsDev(base, 'team-older'), false);
      assert.equal(existsDev(base, 'team-middle'), true);
      assert.equal(existsDev(base, 'team-newest'), true);
      assert.equal(existsDev(base, 'team-dead'), false);
    } finally {
      delete process.env.COLLAB_DEV_MAX;
      rmSync(base, { recursive: true, force: true });
    }
  });
});

test('touchDevProcess updates only lastRequestAt; ensureDevReaper arms one timer per base', () => {
  const base = mkdtempSync(join(tmpdir(), 'cbe-dev-touch-'));
  const timers: Array<ReturnType<typeof setInterval>> = [];
  const origInterval = globalThis.setInterval;
  try {
    const record = { port: 4100, pid: 4242, startedAt: 10, lastRequestAt: 10 };
    writeDev(base, SLUG, record);
    touchDevProcess(base, SLUG, 99);
    assert.deepEqual(JSON.parse(readFileSync(join(base, 'drafts', SLUG, 'dev.json'), 'utf8')), {
      ...record,
      lastRequestAt: 99,
    });

    const missing = 'team-102048';
    touchDevProcess(base, missing, 5);
    assert.equal(existsSync(join(base, 'drafts', missing, 'dev.json')), false);

    globalThis.setInterval = ((handler: () => void, ms?: number) => {
      const timer = origInterval(handler, ms);
      timers.push(timer);
      return timer;
    }) as typeof setInterval;
    ensureDevReaper(base);
    ensureDevReaper(base);
    assert.equal(timers.length, 1);
  } finally {
    globalThis.setInterval = origInterval;
    for (const timer of timers) clearInterval(timer);
    rmSync(base, { recursive: true, force: true });
  }
});

test('linkSharedProjects symlinks sibling mls dirs into the draft and leaves a real path', () => {
  const base = mkdtempSync(join(tmpdir(), 'cbe-dev-link-'));
  const warns: string[] = [];
  const origWarn = console.warn;
  console.warn = (message?: unknown, ...rest: unknown[]) => {
    warns.push([message, ...rest].map(String).join(' '));
  };
  try {
    mkdirSync(join(base, 'mls-1'));
    mkdirSync(join(base, 'mls-2'));
    mkdirSync(join(base, 'mls-9'));
    writeFileSync(join(base, 'config.json'), '{}\n');
    const draft = join(base, 'drafts', 's');
    const realLib = join(draft, 'mls-2');
    mkdirSync(realLib, { recursive: true });
    writeFileSync(join(realLib, 'keep.txt'), 'stay');

    linkSharedProjects(base, 's', 9);
    assert.equal(readFileSync(join(realLib, 'keep.txt'), 'utf8'), 'stay');
    assert.equal(lstatSync(realLib).isSymbolicLink(), false);
    assert.equal(warns.includes('[cbe] dev s: mls-2 is a real path, not linking'), true);
    assert.equal(readlinkSync(join(draft, 'mls-1')), '../../mls-1');
    assert.equal(realpathSync(join(draft, 'mls-1')), realpathSync(join(base, 'mls-1')));
    assert.equal(existsSync(join(draft, 'mls-9')), false);

    rmSync(realLib, { recursive: true, force: true });
    linkSharedProjects(base, 's', 9);
    assert.equal(readlinkSync(join(draft, 'mls-1')), '../../mls-1');
    assert.equal(readlinkSync(join(draft, 'mls-2')), '../../mls-2');
    assert.equal(realpathSync(join(draft, 'mls-2')), realpathSync(join(base, 'mls-2')));
    assert.equal(existsSync(join(draft, 'mls-9')), false);

    const warnCount = warns.length;
    linkSharedProjects(base, 's', 9);
    assert.equal(readlinkSync(join(draft, 'mls-1')), '../../mls-1');
    assert.equal(readlinkSync(join(draft, 'mls-2')), '../../mls-2');
    assert.equal(warns.length, warnCount);
  } finally {
    console.warn = origWarn;
    rmSync(base, { recursive: true, force: true });
  }
});

test('waitForDevReady is true on the third health check and false when the port stays down', async () => {
  let checks = 0;
  const sleeps: number[] = [];
  const ready = await waitForDevReady(4101, {
    timeoutMs: 10_000,
    stepMs: 250,
    fetchImpl: async (input, init) => {
      checks += 1;
      assert.equal(String(input), 'http://127.0.0.1:4101/health');
      assert.equal(init?.method, 'GET');
      assert.ok(init?.signal);
      if (checks < 3) throw new Error('connect ECONNREFUSED');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  assert.equal(ready, true);
  assert.equal(checks, 3);
  assert.deepEqual(sleeps, [250, 250]);

  let misses = 0;
  const never = await waitForDevReady(4102, {
    timeoutMs: 500,
    stepMs: 250,
    fetchImpl: async () => {
      misses += 1;
      return new Response('no', { status: 503 });
    },
    sleep: async () => {},
  });
  assert.equal(never, false);
  assert.equal(misses, 2);
});

test('findAncestorDenoConfig finds deno.json above the draft and ignores the draft file', () => {
  const draftDir = join('/data/mls-base/drafts', SLUG);
  const ancestor = join('/data/mls-base', 'deno.json');
  assert.equal(findAncestorDenoConfig(draftDir, (candidate) => candidate === ancestor), ancestor);

  const own = join(draftDir, 'deno.json');
  const asked: string[] = [];
  assert.equal(findAncestorDenoConfig(draftDir, (candidate) => {
    asked.push(candidate);
    return candidate === own;
  }), undefined);
  assert.equal(asked.includes(own), false);

  assert.equal(findAncestorDenoConfig(draftDir, () => false), undefined);

  const jsonc = join('/data', 'deno.jsonc');
  assert.equal(findAncestorDenoConfig(draftDir, (candidate) => candidate === jsonc), jsonc);
  assert.equal(
    findAncestorDenoConfig(draftDir, (candidate) => candidate === join(dirname(draftDir), 'deno.json') || candidate === join(dirname(draftDir), 'deno.jsonc')),
    join(dirname(draftDir), 'deno.json'),
  );
});

test('ancestor deno.json blocks a new dev process; a live process skips the guard', () => {
  const base = mkdtempSync(join(tmpdir(), 'cbe-dev-ancestor-'));
  const prevRange = process.env.COLLAB_DEV_PORT_RANGE;
  process.env.COLLAB_DEV_PORT_RANGE = '4100-4199';
  try {
    writeOwnReleaseConfig(base);
    writeFileSync(join(base, 'deno.json'), '{}\n');
    mkdirSync(join(base, 'drafts', SLUG, 'mls-102047'), { recursive: true });
    const calls: string[] = [];
    const spawnDev: DevSpawn = () => {
      calls.push('spawn');
      return { pid: 1 };
    };
    const writeConfig = () => {
      calls.push('config');
    };
    assert.throws(
      () => ensureDevProcess({ base, slug: SLUG, clientProjectId: 102047, spawn: spawnDev, writeConfig }),
      (err: unknown) => {
        assert.ok(err instanceof AncestorDenoConfigError);
        assert.equal((err as AncestorDenoConfigError).message, `ancestor deno config: ${join(base, 'deno.json')}`);
        return true;
      },
    );
    assert.deepEqual(calls, []);
    assert.equal(existsDev(base, SLUG), false);

    writeDev(base, SLUG, { port: 4100, pid: process.pid, startedAt: 1, lastRequestAt: 2 });
    setDevIdentitySecretForTests(base, SLUG, 'known-secret');
    const live = ensureDevProcess({ base, slug: SLUG, clientProjectId: 102047, spawn: spawnDev, writeConfig });
    assert.equal(live.pid, process.pid);
    assert.equal(live.port, 4100);
    assert.deepEqual(calls, []);
  } finally {
    if (prevRange === undefined) delete process.env.COLLAB_DEV_PORT_RANGE;
    else process.env.COLLAB_DEV_PORT_RANGE = prevRange;
    rmSync(base, { recursive: true, force: true });
  }
});

function writeProjectMode(base: string, slug: string, projectId: number, appEnv: string): void {
  const dir = join(base, 'drafts', slug, `mls-${projectId}`, 'l5');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'project.json'), `${JSON.stringify({ appEnv })}\n`);
}

test('a non-test project mode or a missing DATABASE_URL_TEST refuses a new dev process', () => {
  const base = mkdtempSync(join(tmpdir(), 'cbe-dev-mode-'));
  const prevRange = process.env.COLLAB_DEV_PORT_RANGE;
  const prevTestDatabase = process.env.DATABASE_URL_TEST;
  process.env.COLLAB_DEV_PORT_RANGE = '4100-4199';
  process.env.DATABASE_URL_TEST = PARENT_TEST_URL;
  try {
    writeOwnReleaseConfig(base);
    for (const mode of ['production', 'homologation'] as const) {
      writeProjectMode(base, SLUG, 102047, mode);
      const calls: string[] = [];
      assert.throws(
        () => ensureDevProcess({
          base,
          slug: SLUG,
          clientProjectId: 102047,
          spawn: () => {
            calls.push('spawn');
            return { pid: 1 };
          },
          writeConfig: () => { calls.push('config'); },
        }),
        (err: unknown) => {
          assert.ok(err instanceof DraftDatabaseError);
          assert.equal((err as DraftDatabaseError).message, `project mode ${mode} is not a test mode`);
          return true;
        },
      );
      assert.deepEqual(calls, []);
      assert.equal(existsDev(base, SLUG), false);
    }

    writeDev(base, SLUG, { port: 4100, pid: process.pid, startedAt: 1, lastRequestAt: 2 });
    setDevIdentitySecretForTests(base, SLUG, 'known-secret');
    const calls: string[] = [];
    const live = ensureDevProcess({
      base,
      slug: SLUG,
      clientProjectId: 102047,
      spawn: () => {
        calls.push('spawn');
        return { pid: 1 };
      },
      writeConfig: () => { calls.push('config'); },
    });
    assert.equal(live.pid, process.pid);
    assert.deepEqual(calls, []);
    rmSync(join(base, 'drafts', SLUG, 'dev.json'), { force: true });

    delete process.env.DATABASE_URL_TEST;
    writeProjectMode(base, SLUG, 102047, 'development');
    const missingCalls: string[] = [];
    assert.throws(
      () => ensureDevProcess({
        base,
        slug: SLUG,
        clientProjectId: 102047,
        spawn: () => {
          missingCalls.push('spawn');
          return { pid: 1 };
        },
        writeConfig: () => { missingCalls.push('config'); },
      }),
      (err: unknown) => {
        assert.ok(err instanceof DraftDatabaseError);
        assert.equal((err as DraftDatabaseError).message, 'DATABASE_URL_TEST is not set');
        return true;
      },
    );
    assert.deepEqual(missingCalls, []);
    assert.equal(existsDev(base, SLUG), false);
  } finally {
    if (prevRange === undefined) delete process.env.COLLAB_DEV_PORT_RANGE;
    else process.env.COLLAB_DEV_PORT_RANGE = prevRange;
    if (prevTestDatabase === undefined) delete process.env.DATABASE_URL_TEST;
    else process.env.DATABASE_URL_TEST = prevTestDatabase;
    rmSync(base, { recursive: true, force: true });
  }
});

test('ensureDevProcess refuses when deno is missing from PATH and spawns when a fake deno is executable', () => {
  const base = mkdtempSync(join(tmpdir(), 'cbe-dev-deno-path-'));
  const prevRange = process.env.COLLAB_DEV_PORT_RANGE;
  const prevTestDatabase = process.env.DATABASE_URL_TEST;
  const prevPath = process.env.PATH;
  process.env.COLLAB_DEV_PORT_RANGE = '4100-4199';
  process.env.DATABASE_URL_TEST = PARENT_TEST_URL;
  const errors: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };
  try {
    writeOwnReleaseConfig(base);
    mkdirSync(join(base, 'drafts', SLUG, 'mls-102047'), { recursive: true });
    writeProjectMode(base, SLUG, 102047, 'development');
    const emptyDir = join(base, 'empty-bin');
    mkdirSync(emptyDir);
    process.env.PATH = emptyDir;
    const started = Date.now();
    assert.throws(
      () => ensureDevProcess({
        base,
        slug: SLUG,
        clientProjectId: 102047,
        writeConfig: () => {},
      }),
      (err: unknown) => {
        assert.ok(err instanceof DenoMissingError);
        assert.equal(
          (err as DenoMissingError).message,
          'deno not found on PATH; install it with collab-runtime/scripts/06b-install-deno.sh',
        );
        return true;
      },
    );
    assert.equal(Date.now() - started < 10_000, true);
    assert.ok(errors.some((line) => line.includes('[cbe] dev team-102047: deno not found on PATH; install it with collab-runtime/scripts/06b-install-deno.sh')));
    assert.equal(existsDev(base, SLUG), false);

    const fakeDir = join(base, 'fake-bin');
    mkdirSync(fakeDir);
    const fakeDeno = join(fakeDir, 'deno');
    writeFileSync(fakeDeno, '#!/bin/sh\nexit 0\n');
    chmodSync(fakeDeno, 0o755);
    process.env.PATH = `${fakeDir}${prevPath ? `:${prevPath}` : ''}`;
    const info = ensureDevProcess({
      base,
      slug: SLUG,
      clientProjectId: 102047,
      writeConfig: () => {},
    });
    assert.equal(Number.isInteger(info.pid) && info.pid > 0, true);
    assert.equal(existsDev(base, SLUG), true);
    try { process.kill(info.pid, 'SIGTERM'); } catch { /* already gone */ }
  } finally {
    console.error = origError;
    stopDevProcess(base, SLUG);
    if (prevRange === undefined) delete process.env.COLLAB_DEV_PORT_RANGE;
    else process.env.COLLAB_DEV_PORT_RANGE = prevRange;
    if (prevTestDatabase === undefined) delete process.env.DATABASE_URL_TEST;
    else process.env.DATABASE_URL_TEST = prevTestDatabase;
    if (prevPath === undefined) delete process.env.PATH;
    else process.env.PATH = prevPath;
    rmSync(base, { recursive: true, force: true });
  }
});

test('ensureDevProcess refuses to start when the draft worktree is missing', () => {
  const base = mkdtempSync(join(tmpdir(), 'cbe-dev-missing-'));
  try {
    writeOwnReleaseConfig(base);
    let spawned = 0;
    assert.throws(
      () => ensureDevProcess({
        base,
        slug: SLUG,
        clientProjectId: 102047,
        spawn: () => {
          spawned += 1;
          return { pid: 1 };
        },
        writeConfig: () => {},
      }),
      (err: unknown) => {
        assert.ok(err instanceof DraftWorktreeMissingError);
        assert.equal(
          (err as DraftWorktreeMissingError).message,
          `draft worktree missing: ${join(base, 'drafts', SLUG, 'mls-102047')}`,
        );
        return true;
      },
    );
    assert.equal(spawned, 0);
    assert.equal(existsSync(join(base, 'drafts', SLUG, 'config.json')), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('ensureDevProcess spawns when no ancestor deno config exists', () => {
  const pids: number[] = [];
  const base = mkdtempSync(join(tmpdir(), 'cbe-dev-clean-'));
  const prevRange = process.env.COLLAB_DEV_PORT_RANGE;
  const prevTestDatabase = process.env.DATABASE_URL_TEST;
  process.env.COLLAB_DEV_PORT_RANGE = '4100-4199';
  process.env.DATABASE_URL_TEST = PARENT_TEST_URL;
  try {
    writeOwnReleaseConfig(base);
    mkdirSync(join(base, 'drafts', SLUG, 'mls-102047'), { recursive: true });
    const calls: Array<{ command: string; args: string[] }> = [];
    const spawnDev: DevSpawn = (command, args) => {
      calls.push({ command, args });
      return { pid: dummyPid(pids) };
    };
    const info = ensureDevProcess({
      base,
      slug: SLUG,
      clientProjectId: 102047,
      spawn: spawnDev,
      now: () => 1_700_000_000_000,
      writeConfig: () => {},
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'deno');
    assert.equal(info.pid > 0, true);
    assert.equal(existsDev(base, SLUG), true);
  } finally {
    killPids(pids);
    if (prevRange === undefined) delete process.env.COLLAB_DEV_PORT_RANGE;
    else process.env.COLLAB_DEV_PORT_RANGE = prevRange;
    if (prevTestDatabase === undefined) delete process.env.DATABASE_URL_TEST;
    else process.env.DATABASE_URL_TEST = prevTestDatabase;
    rmSync(base, { recursive: true, force: true });
  }
});

function secretPathOf(base: string, slug: string): string {
  const name = createHash('sha256').update(`${base}\0${slug}`).digest('hex');
  const getuid = process.getuid;
  if (!getuid) throw new Error('dev identity secret dir requires getuid');
  return join(tmpdir(), `collab-draft-secrets-${getuid()}`, name);
}

test('two node processes share the draft secret and do not replace a live child', () => {
  const base = mkdtempSync(join(tmpdir(), 'cbe-dev-workers-'));
  const sleeper = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
  sleeper.unref();
  const prevRange = process.env.COLLAB_DEV_PORT_RANGE;
  const prevTestDatabase = process.env.DATABASE_URL_TEST;
  process.env.COLLAB_DEV_PORT_RANGE = '4100-4199';
  process.env.DATABASE_URL_TEST = PARENT_TEST_URL;
  try {
    assert.ok(sleeper.pid);
    writeOwnReleaseConfig(base);
    mkdirSync(join(base, 'drafts', SLUG, 'mls-102047'), { recursive: true });
    const first = runEnsureInOtherProcess(base, sleeper.pid);
    const second = runEnsureInOtherProcess(base, sleeper.pid);
    assert.equal(first.pid, sleeper.pid);
    assert.equal(second.pid, sleeper.pid);
    assert.equal(first.identitySecret, second.identitySecret);
    assert.match(first.identitySecret, /^[0-9a-f]{64}$/u);
    assert.equal(isDevPidAlive(sleeper.pid), true);
  } finally {
    if (sleeper.pid) {
      try { process.kill(sleeper.pid, 'SIGTERM'); } catch { /* already gone */ }
    }
    if (prevRange === undefined) delete process.env.COLLAB_DEV_PORT_RANGE;
    else process.env.COLLAB_DEV_PORT_RANGE = prevRange;
    if (prevTestDatabase === undefined) delete process.env.DATABASE_URL_TEST;
    else process.env.DATABASE_URL_TEST = prevTestDatabase;
    rmSync(secretPathOf(base, SLUG), { force: true });
    rmSync(base, { recursive: true, force: true });
  }
});

test('stopDev removes the secret file; the file is 0600, the dir is 0700, and the path is outside --allow-read', async () => {
  const base = mkdtempSync(join(tmpdir(), 'cbe-dev-secret-'));
  const prevRange = process.env.COLLAB_DEV_PORT_RANGE;
  const prevTestDatabase = process.env.DATABASE_URL_TEST;
  process.env.COLLAB_DEV_PORT_RANGE = '4100-4199';
  process.env.DATABASE_URL_TEST = PARENT_TEST_URL;
  const pids: number[] = [];
  try {
    writeOwnReleaseConfig(base);
    mkdirSync(join(base, 'drafts', SLUG, 'mls-102047'), { recursive: true });
    const info = ensureDevProcess({
      base,
      slug: SLUG,
      clientProjectId: 102047,
      now: () => 1,
      writeConfig: () => {},
      spawn: () => ({ pid: dummyPid(pids) }),
    });
    const secretPath = secretPathOf(base, SLUG);
    assert.equal(readFileSync(secretPath, 'utf8'), info.identitySecret);
    assert.equal(statSync(secretPath).mode & 0o777, 0o600);
    assert.equal(statSync(dirname(secretPath)).mode & 0o777, 0o700);
    const allow = buildDenoArgs(base, SLUG, 4100, draftDatabaseUrl(PARENT_TEST_URL, SLUG, 102047))
      .find((arg) => arg.startsWith('--allow-read='));
    assert.ok(allow);
    const roots = allow.slice('--allow-read='.length).split(',');
    for (const root of roots) {
      assert.equal(secretPath === root || secretPath.startsWith(root.endsWith('/') ? root : `${root}/`), false);
    }
    stopDevProcess(base, SLUG);
    assert.equal(existsSync(secretPath), false);
    await waitDead(info.pid);
    assert.equal(isDevPidAlive(info.pid), false);
  } finally {
    killPids(pids);
    if (prevRange === undefined) delete process.env.COLLAB_DEV_PORT_RANGE;
    else process.env.COLLAB_DEV_PORT_RANGE = prevRange;
    if (prevTestDatabase === undefined) delete process.env.DATABASE_URL_TEST;
    else process.env.DATABASE_URL_TEST = prevTestDatabase;
    rmSync(secretPathOf(base, SLUG), { force: true });
    rmSync(base, { recursive: true, force: true });
  }
});

test('draft copies the project release config, not the shared base config', () => {
  const base = mkdtempSync(join(tmpdir(), 'cbe-dev-own-release-'));
  const prevRange = process.env.COLLAB_DEV_PORT_RANGE;
  const prevTestDatabase = process.env.DATABASE_URL_TEST;
  process.env.COLLAB_DEV_PORT_RANGE = '4100-4199';
  process.env.DATABASE_URL_TEST = PARENT_TEST_URL;
  const pids: number[] = [];
  try {
    writeFileSync(join(base, 'config.json'), '{"project":102047}\n');
    writeOwnReleaseConfig(base, 102056, '{"project":102056}\n');
    mkdirSync(join(base, 'drafts', SLUG, 'mls-102056'), { recursive: true });
    ensureDevProcess({
      base,
      slug: SLUG,
      clientProjectId: 102056,
      spawn: () => ({ pid: dummyPid(pids) }),
      now: () => 1,
      writeConfig: () => {},
    });
    assert.equal(readFileSync(join(base, 'drafts', SLUG, 'config.json'), 'utf8'), '{"project":102056}\n');
  } finally {
    killPids(pids);
    if (prevRange === undefined) delete process.env.COLLAB_DEV_PORT_RANGE;
    else process.env.COLLAB_DEV_PORT_RANGE = prevRange;
    if (prevTestDatabase === undefined) delete process.env.DATABASE_URL_TEST;
    else process.env.DATABASE_URL_TEST = prevTestDatabase;
    rmSync(base, { recursive: true, force: true });
  }
});

test('a missing project release config fails with that path', () => {
  const base = mkdtempSync(join(tmpdir(), 'cbe-dev-own-release-missing-'));
  const prevRange = process.env.COLLAB_DEV_PORT_RANGE;
  const prevTestDatabase = process.env.DATABASE_URL_TEST;
  process.env.COLLAB_DEV_PORT_RANGE = '4100-4199';
  process.env.DATABASE_URL_TEST = PARENT_TEST_URL;
  const errors: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };
  const src = join(base, 'current-102056', 'config.json');
  try {
    writeFileSync(join(base, 'config.json'), '{"project":102047}\n');
    mkdirSync(join(base, 'drafts', SLUG, 'mls-102056'), { recursive: true });
    assert.throws(
      () => ensureDevProcess({
        base,
        slug: SLUG,
        clientProjectId: 102056,
        spawn: () => ({ pid: 1 }),
        writeConfig: () => {},
      }),
      (err: unknown) => {
        assert.equal((err as Error).message, `release config.json missing at ${src}`);
        return true;
      },
    );
    assert.equal(errors.includes(`[cbe] dev ${SLUG}: release config.json missing at ${src}`), true);
    assert.equal(existsSync(join(base, 'drafts', SLUG, 'config.json')), false);
  } finally {
    console.error = origError;
    if (prevRange === undefined) delete process.env.COLLAB_DEV_PORT_RANGE;
    else process.env.COLLAB_DEV_PORT_RANGE = prevRange;
    if (prevTestDatabase === undefined) delete process.env.DATABASE_URL_TEST;
    else process.env.DATABASE_URL_TEST = prevTestDatabase;
    rmSync(base, { recursive: true, force: true });
  }
});

test('releaseAliasOf matches scripts/runtime/projectPorts.mjs', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const ports = await import(join(here, '..', '..', '..', '..', '..', 'scripts', 'runtime', 'projectPorts.mjs'));
  assert.equal(releaseAliasOf(102056), ports.releaseAliasOf(102056));
  assert.equal(releaseAliasOf(' 102047 '), ports.releaseAliasOf(' 102047 '));
});

function runEnsureInOtherProcess(base: string, pid: number): { pid: number; identitySecret: string } {
  const here = dirname(fileURLToPath(import.meta.url));
  const monorepoRoot = join(here, '..', '..', '..', '..', '..');
  const layerRoot = join(monorepoRoot, 'mls-102034', 'l1');
  const result = spawnSync(join(monorepoRoot, 'node_modules', '.bin', 'tsx'), [
    '--import', join(monorepoRoot, 'test', 'register-hooks.mjs'),
    '--import', join(monorepoRoot, 'test', 'setup-l1.ts'),
    join(here, 'cbeDevProcessTwoWorkers.ts'),
    base,
    SLUG,
    String(pid),
  ], {
    cwd: layerRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: join(monorepoRoot, 'test', 'tsconfig.runtime.json'),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as { pid: number; identitySecret: string };
}

function existsDev(base: string, slug: string): boolean {
  try {
    readFileSync(join(base, 'drafts', slug, 'dev.json'));
    return true;
  } catch {
    return false;
  }
}
