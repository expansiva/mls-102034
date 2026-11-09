/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeDraftPorts.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  DEFAULT_DRAFT_PORT_RANGE,
  RESERVED_PORTS,
  adoptDraftPort,
  allocateDraftPort,
  draftPortsFile,
  readDraftPorts,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeDraftPorts.js';

const RANGE = { start: 4000, end: 4010 };
const free = (): boolean => true;

function tableFile(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cbe-ports-'));
  return { dir, file: join(dir, 'etc', 'draft-ports.json') };
}

test('the default range is 4000-6000 and the VM services inside it are reserved', () => {
  assert.equal(DEFAULT_DRAFT_PORT_RANGE, '4000-6000');
  for (const port of [5151, 5432, 6379]) assert.ok(RESERVED_PORTS.includes(port), String(port));
});

test('a draft gets the first free port, keeps it on the 2nd start, and the table says whose it is', () => {
  const { dir, file } = tableFile();
  try {
    const first = allocateDraftPort({ file, projectId: 102047, slug: 'team-102047', range: RANGE, portFree: free, now: () => 1_700_000_000_000 });
    assert.deepEqual(first, { port: 4000, fresh: true });
    const other = allocateDraftPort({ file, projectId: 102047, slug: 'user-0123456789abcdef', range: RANGE, portFree: free });
    assert.equal(other.port, 4001);
    // the 2nd start returns the same port without asking the machine
    const again = allocateDraftPort({ file, projectId: 102047, slug: 'team-102047', range: RANGE, portFree: () => assert.fail('no consulta a máquina') });
    assert.deepEqual(again, { port: 4000, fresh: false });
    const table = readDraftPorts(file);
    assert.equal(table.versao, 1);
    assert.deepEqual(table.portas['102047:team-102047'], { port: 4000, desde: '2023-11-14T22:13:20.000Z' });
    assert.equal(table.portas['102047:user-0123456789abcdef'].port, 4001);
    assert.deepEqual(readdirSync(dirname(file)).filter((name) => name.includes('.tmp-')), [], 'sem temporário esquecido (gravação atômica)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a port that is listening, reserved or in the table is skipped', () => {
  const { dir, file } = tableFile();
  try {
    const listening = new Set([4000, 4001]);
    const portFree = (port: number): boolean => !listening.has(port);
    assert.equal(allocateDraftPort({ file, projectId: 1, slug: 'team-1', range: RANGE, portFree }).port, 4002);
    assert.equal(allocateDraftPort({ file, projectId: 2, slug: 'team-2', range: RANGE, portFree }).port, 4003);
    // reserved: a range around the VM's Postgres
    const reserved = allocateDraftPort({ file, projectId: 3, slug: 'team-3', range: { start: 5431, end: 5433 }, portFree: free });
    assert.equal(reserved.port, 5431);
    assert.equal(allocateDraftPort({ file, projectId: 4, slug: 'team-4', range: { start: 5431, end: 5433 }, portFree: free }).port, 5433, '5432 (Postgres) é reservada');
    assert.throws(() => allocateDraftPort({ file, projectId: 5, slug: 'team-5', range: { start: 5431, end: 5433 }, portFree: free }), /no free port in 5431-5433/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two apps of one VM (two bases, one table) never get the same port, also at the same time', async () => {
  const { dir, file } = tableFile();
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const monorepoRoot = join(here, '..', '..', '..', '..', '..');
    const run = (projectId: string, slug: string): Promise<{ port: number }> => new Promise((resolve, reject) => {
      const child = spawn(join(monorepoRoot, 'node_modules', '.bin', 'tsx'), [
        '--import', join(monorepoRoot, 'test', 'register-hooks.mjs'),
        '--import', join(monorepoRoot, 'test', 'setup-l1.ts'),
        join(here, 'cbeDraftPortsWorker.ts'), file, projectId, slug,
      ], { cwd: join(monorepoRoot, 'mls-102034', 'l1'), env: { ...process.env, TSX_TSCONFIG_PATH: join(monorepoRoot, 'test', 'tsconfig.runtime.json') } });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.stderr.on('data', (chunk) => { err += chunk; });
      child.on('close', (code) => (code === 0 ? resolve(JSON.parse(out) as { port: number }) : reject(new Error(err))));
    });
    const results = await Promise.all([
      run('102047', 'team-102047'), run('102056', 'team-102056'),
      run('102047', 'user-aaaaaaaaaaaaaaaa'), run('102056', 'user-bbbbbbbbbbbbbbbb'),
      run('102047', 'user-cccccccccccccccc'), run('102056', 'user-dddddddddddddddd'),
    ]);
    const ports = results.map((r) => r.port);
    assert.equal(new Set(ports).size, 6, `portas repetidas: ${ports.join(',')}`);
    assert.equal(Object.keys(readDraftPorts(file).portas).length, 6);
    assert.equal(existsSync(join(dirname(file), 'draft-ports.lock')), false, 'a trava foi solta');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a lock left by a dead process is taken over; a malformed table is an error, never silently replaced', () => {
  const { dir, file } = tableFile();
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(join(dirname(file), 'draft-ports.lock'), `${2 ** 22 + 1234}\n${Date.now()}`); // a pid that does not exist
    assert.equal(allocateDraftPort({ file, projectId: 1, slug: 'team-1', range: RANGE, portFree: free }).port, 4000);
    writeFileSync(file, '{ not json');
    assert.throws(() => allocateDraftPort({ file, projectId: 2, slug: 'team-2', range: RANGE, portFree: free }), /draft ports table unreadable/u);
    assert.equal(readFileSync(file, 'utf8'), '{ not json', 'a tabela não foi sobrescrita');
    writeFileSync(file, JSON.stringify({ versao: 1, portas: { '1:team-1': { port: 'x', desde: '' } } }));
    assert.throws(() => readDraftPorts(file), /bad entry/u);
    writeFileSync(file, JSON.stringify({ versao: 2, portas: {} }));
    assert.throws(() => readDraftPorts(file), /malformed/u);
    // an old lock of a LIVE pid is also taken over after the stale limit
    const lock = join(dirname(file), 'draft-ports.lock');
    writeFileSync(file, JSON.stringify({ versao: 1, portas: {} }));
    writeFileSync(lock, `${process.pid}\n${Date.now() - 120_000}`);
    utimesSync(lock, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
    assert.equal(allocateDraftPort({ file, projectId: 3, slug: 'team-3', range: RANGE, portFree: free }).port, 4000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('adoptDraftPort records a live child that predates the table, and never takes a port the table gave to another draft', () => {
  const { dir, file } = tableFile();
  try {
    adoptDraftPort({ file, projectId: 102047, slug: 'team-102047', port: 4100 });
    assert.equal(readDraftPorts(file).portas['102047:team-102047'].port, 4100);
    adoptDraftPort({ file, projectId: 102056, slug: 'team-102056', port: 4100 }); // same port, other draft: refused, logged
    assert.equal(readDraftPorts(file).portas['102056:team-102056'], undefined);
    adoptDraftPort({ file, projectId: 102047, slug: 'team-102047', port: 4999 }); // already has one: unchanged
    assert.equal(readDraftPorts(file).portas['102047:team-102047'].port, 4100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('draftPortsFile: the variable wins; a base outside /data keeps the table inside the base', () => {
  assert.equal(draftPortsFile('/data/app1/mls-base', { COLLAB_DRAFT_PORTS_FILE: '/x/ports.json' }), '/x/ports.json');
  assert.equal(draftPortsFile('/tmp/some-base', {}), join('/tmp/some-base', 'draft-ports.json'));
});
