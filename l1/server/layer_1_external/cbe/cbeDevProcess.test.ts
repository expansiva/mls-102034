/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildDenoArgs,
  ensureDevProcess,
  ensureDevReaper,
  isDevPidAlive,
  memoryModeAllowEnv,
  reapIdle,
  restartDevProcess,
  touchDevProcess,
  type DevSpawn,
  type DevSpawnOptions,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.js';

const IDLE_MS = 30 * 60 * 1000;
const SLUG = 'team-102047';

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
  process.env.COLLAB_DEV_PORT_RANGE = '4100-4199';
  process.env.DATABASE_URL = 'postgres://should-not-leak';
  t.after(() => {
    killPids(pids);
    if (prevRange === undefined) delete process.env.COLLAB_DEV_PORT_RANGE;
    else process.env.COLLAB_DEV_PORT_RANGE = prevRange;
    if (prevMax === undefined) delete process.env.COLLAB_DEV_MAX;
    else process.env.COLLAB_DEV_MAX = prevMax;
    if (prevDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDatabase;
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
      const first = ensureDevProcess({ base, slug: SLUG, clientProjectId: 102047, spawn: spawnDev, now });
      const second = ensureDevProcess({ base, slug: SLUG, clientProjectId: 102047, spawn: spawnDev, now });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].command, 'deno');
      assert.deepEqual(calls[0].args, buildDenoArgs(base, SLUG, 4100));
      assert.deepEqual(calls[0].args, [
        'run',
        `--allow-read=${base},${join(base, 'drafts', SLUG)}`,
        `--allow-env=${memoryModeAllowEnv().join(',')}`,
        '--allow-net=0.0.0.0:4100,127.0.0.1',
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
      assert.equal(calls[0].options.env.COLLAB_RUNTIME_MODE, 'memory');
      assert.equal(calls[0].options.env.COLLAB_DRAFT, SLUG);
      assert.equal(calls[0].options.env.COLLAB_PROJECT_ID, '102047');
      assert.equal(calls[0].options.env.DATABASE_URL, undefined);
      assert.equal(calls[0].options.logPath, join(base, 'logs', `dev-${SLUG}.log`));
      assert.equal(readFileSync(join(base, 'drafts', SLUG, 'config.json'), 'utf8'), '{"release":true}\n');
      const stored = JSON.parse(readFileSync(join(base, 'drafts', SLUG, 'dev.json'), 'utf8'));
      assert.deepEqual(stored, { port: 4100, pid: first.pid, startedAt: now(), lastRequestAt: now() });
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
      const opts = { base, slug: SLUG, clientProjectId: 102047, spawn: spawnDev, now: () => 1_700_000_000_000 };
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

function existsDev(base: string, slug: string): boolean {
  try {
    readFileSync(join(base, 'drafts', slug, 'dev.json'));
    return true;
  } catch {
    return false;
  }
}
