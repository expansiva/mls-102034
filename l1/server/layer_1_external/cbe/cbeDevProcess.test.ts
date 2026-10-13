/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  AncestorDenoConfigError,
  DraftDatabaseError,
  buildDenoArgs,
  draftDatabaseUrl,
  ensureDevProcess,
  ensureDevReaper,
  findAncestorDenoConfig,
  isDevPidAlive,
  linkSharedProjects,
  memoryModeAllowEnv,
  reapIdle,
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

test('draftDatabaseUrl keeps the parent connection and swaps only the database name', () => {
  const url = draftDatabaseUrl(PARENT_TEST_URL, SLUG);
  const parsed = new URL(url);
  assert.equal(parsed.username, 'collab');
  assert.equal(parsed.password, 'secret');
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.equal(parsed.port, '5432');
  assert.equal(parsed.pathname, `/${DRAFT_DATABASE}`);
  assert.equal(url, `postgres://collab:secret@127.0.0.1:5432/${DRAFT_DATABASE}`);
  assert.notEqual(parsed.pathname, '/collab_app_test');

  const mixed = new URL(draftDatabaseUrl(PARENT_TEST_URL, 'Team.A@b-9'));
  assert.equal(mixed.pathname, '/collab_app_draft_team_a_b_9');
  assert.equal(mixed.username, 'collab');
  assert.equal(mixed.hostname, '127.0.0.1');
  assert.equal(mixed.port, '5432');

  const capped = new URL(draftDatabaseUrl(PARENT_TEST_URL, 'abcdefghijklmnopqrstuvwxyz')).pathname.slice(1);
  assert.equal(capped.length, 40);
  assert.equal(capped, 'collab_app_draft_abcdefghijklmnopqrstuvw');

  assert.throws(() => draftDatabaseUrl('not a url', SLUG), /invalid database url/);
  assert.throws(() => draftDatabaseUrl('postgres://collab:secret@127.0.0.1:5432', SLUG), /invalid database url/);
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

test('dev --allow-env covers every l1 env read except DATABASE_URL', () => {
  const allow = buildDenoArgs('/tmp/base', SLUG, 4100, draftDatabaseUrl(PARENT_TEST_URL, SLUG))
    .find((arg) => arg.startsWith('--allow-env='));
  assert.ok(allow);
  const allowNames = new Set(allow.slice('--allow-env='.length).split(','));
  assert.equal(allowNames.has('DATABASE_URL'), false);
  const missing = [...envNamesReadInL1()].filter((name) => name !== 'DATABASE_URL' && !allowNames.has(name));
  assert.deepEqual(missing, []);
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
      writeFileSync(join(base, 'config.json'), '{"release":true}\n');
      const calls: Array<{ command: string; args: string[]; options: DevSpawnOptions }> = [];
      const spawnDev: DevSpawn = (command, args, options) => {
        calls.push({ command, args, options });
        return { pid: dummyPid(pids) };
      };
      const now = () => 1_700_000_000_000;
      const writeConfig = () => {};
      const draftUrl = draftDatabaseUrl(PARENT_TEST_URL, SLUG);
      process.env.DATABASE_URL_TEST = PARENT_TEST_URL;
      const first = ensureDevProcess({ base, slug: SLUG, clientProjectId: 102047, spawn: spawnDev, now, writeConfig });
      const second = ensureDevProcess({ base, slug: SLUG, clientProjectId: 102047, spawn: spawnDev, now, writeConfig });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].command, 'deno');
      assert.deepEqual(calls[0].args, buildDenoArgs(base, SLUG, 4100, draftUrl));
      assert.deepEqual(calls[0].args, [
        'run',
        `--allow-read=${base},${join(base, 'drafts', SLUG)}`,
        `--allow-env=${[...memoryModeAllowEnv(), 'DATABASE_URL_TEST'].join(',')}`,
        '--allow-net=0.0.0.0:4100,127.0.0.1,127.0.0.1:5432',
        '--allow-sys=networkInterfaces',
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
      writeFileSync(join(base, 'config.json'), '{"release":true}\n');
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

  await t.test('restart of a dead pid only clears dev.json, then spawns', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cbe-dev-'));
    try {
      writeFileSync(join(base, 'config.json'), '{"release":true}\n');
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
      writeFileSync(join(base, 'config.json'), '{"release":true}\n');
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
    writeFileSync(join(base, 'config.json'), '{"release":true}\n');
    writeFileSync(join(base, 'deno.json'), '{}\n');
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
    writeFileSync(join(base, 'config.json'), '{"release":true}\n');
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

test('ensureDevProcess spawns when no ancestor deno config exists', () => {
  const pids: number[] = [];
  const base = mkdtempSync(join(tmpdir(), 'cbe-dev-clean-'));
  const prevRange = process.env.COLLAB_DEV_PORT_RANGE;
  const prevTestDatabase = process.env.DATABASE_URL_TEST;
  process.env.COLLAB_DEV_PORT_RANGE = '4100-4199';
  process.env.DATABASE_URL_TEST = PARENT_TEST_URL;
  try {
    writeFileSync(join(base, 'config.json'), '{"release":true}\n');
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

function existsDev(base: string, slug: string): boolean {
  try {
    readFileSync(join(base, 'drafts', slug, 'dev.json'));
    return true;
  } catch {
    return false;
  }
}
