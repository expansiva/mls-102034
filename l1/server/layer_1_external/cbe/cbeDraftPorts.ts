/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeDraftPorts.ts" enhancement="_blank" />
// One port per draft, fixed, from ONE table per machine (rt198).
//
// The apps of a VM share one port range, and a port is a machine-wide fact: a table kept per app (the `dev.json` files) let
// two apps pick the same port, and a call for one app's draft was answered by the other app's child (rt197). The table
// lives outside every release and every project tree (`/data/etc/draft-ports.json`, next to `shared.json`) and is only
// written under a machine lock, atomically (temp + rename).
//
//   { "versao": 1, "portas": { "<projectId>:<slug>": { "port": 4231, "desde": "<iso>" } } }
//
// A draft gets its port the first time it starts and keeps it: a stopped draft comes back on the same port. The port is
// the first of the range that is not in the table, not reserved and not listening right now. If the draft's own port is
// held by another program the caller fails loudly (`DraftPortBusyError`): a silent change of port is how two drafts end
// up answering for each other.

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DEFAULT_DRAFT_PORT_RANGE = '4000-6000';

/**
 * Services of the VM that listen inside the range (measured on the 102056, 09/11/2026: collab-messages 5151, Postgres 5432,
 * Redis 6379). They are skipped even while stopped, so a restart of one of them never finds its port taken by a draft.
 */
export const RESERVED_PORTS: readonly number[] = [5151, 5432, 6379];

const LOCK_RETRIES = 100;
const LOCK_RETRY_MS = 50;
const LOCK_STALE_MS = 30_000;

export interface DraftPortEntry {
  port: number;
  desde: string;
}

export interface DraftPortsTable {
  versao: 1;
  portas: Record<string, DraftPortEntry>;
}

export class DraftPortBusyError extends Error {
  constructor(readonly port: number, readonly slug: string, readonly projectId: number, readonly listener: string) {
    super(`the port ${port} of draft ${slug} (project ${projectId}) is held by another program (${listener}); it is the draft's fixed port, so it was not changed`);
    this.name = 'DraftPortBusyError';
  }
}

/** The table of this machine: the variable, else `/data/etc` on a VM (a base under /data), else inside the project base. */
export function draftPortsFile(base: string, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.COLLAB_DRAFT_PORTS_FILE?.trim();
  if (fromEnv) return fromEnv;
  if (base.startsWith('/data/') && existsSync('/data/etc')) return '/data/etc/draft-ports.json';
  return join(base, 'draft-ports.json');
}

const keyOf = (projectId: number, slug: string): string => `${projectId}:${slug}`;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === 'EPERM';
  }
}

function lockIsStale(path: string): boolean {
  try {
    const [pid, since] = readFileSync(path, 'utf8').split('\n');
    return !pidAlive(Number(pid)) || Date.now() - Number(since) > LOCK_STALE_MS;
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return false;
    console.error(`[cbe] draft ports lock unreadable at ${path}: ${(err as Error).message}`);
    return true;
  }
}

/** Exclusive lock of the table: a file created with `wx`, owned by a pid, taken over when its owner is gone or it is too old. */
function withMachineLock<T>(lockPath: string, fn: () => T): T {
  mkdirSync(dirname(lockPath), { recursive: true });
  let held = false;
  for (let attempt = 0; attempt < LOCK_RETRIES && !held; attempt += 1) {
    try {
      const fd = openSync(lockPath, 'wx');
      writeSync(fd, `${process.pid}\n${Date.now()}`);
      closeSync(fd);
      held = true;
    } catch (err) {
      if ((err as { code?: string }).code !== 'EEXIST') {
        console.error(`[cbe] draft ports lock failed at ${lockPath}: ${(err as Error).message}`);
        throw err;
      }
      if (lockIsStale(lockPath)) rmSync(lockPath, { force: true });
      else sleepSync(LOCK_RETRY_MS);
    }
  }
  if (!held) {
    console.error(`[cbe] draft ports lock busy: ${lockPath}`);
    throw new Error(`draft ports lock busy: ${lockPath}`);
  }
  try {
    return fn();
  } finally {
    try {
      if (readFileSync(lockPath, 'utf8').split('\n')[0] === String(process.pid)) rmSync(lockPath, { force: true });
    } catch (err) {
      console.error(`[cbe] draft ports lock release failed at ${lockPath}: ${(err as Error).message}`);
    }
  }
}

/** A missing file is an empty table; an unreadable or malformed one is an ERROR (never silently replaced: it holds every port). */
export function readDraftPorts(file: string): DraftPortsTable {
  if (!existsSync(file)) return { versao: 1, portas: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`[cbe] draft ports table unreadable at ${file}: ${(err as Error).message}`);
    throw new Error(`draft ports table unreadable at ${file}`);
  }
  const portas = (parsed as { versao?: unknown; portas?: unknown } | null)?.portas;
  if ((parsed as { versao?: unknown } | null)?.versao !== 1 || !portas || typeof portas !== 'object' || Array.isArray(portas)) {
    console.error(`[cbe] draft ports table malformed at ${file}`);
    throw new Error(`draft ports table malformed at ${file}`);
  }
  for (const [key, entry] of Object.entries(portas)) {
    const port = (entry as { port?: unknown } | null)?.port;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      console.error(`[cbe] draft ports table has a bad entry '${key}' at ${file}`);
      throw new Error(`draft ports table has a bad entry '${key}' at ${file}`);
    }
  }
  return parsed as DraftPortsTable;
}

function writeDraftPorts(file: string, table: DraftPortsTable): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(table, null, 2)}\n`, { mode: 0o644 });
  renameSync(temp, file);
}

const lockOf = (file: string): string => join(dirname(file), 'draft-ports.lock');

export interface AllocateInput {
  file: string;
  projectId: number;
  slug: string;
  range: { start: number; end: number };
  /** Is the port free on the machine right now? Consulted only for a port the draft does not have yet. */
  portFree: (port: number) => boolean;
  now?: () => number;
}

/** The draft's fixed port: its entry in the table, or the first usable port of the range, recorded under the machine lock. */
export function allocateDraftPort(input: AllocateInput): { port: number; fresh: boolean } {
  return withMachineLock(lockOf(input.file), () => {
    const table = readDraftPorts(input.file);
    const key = keyOf(input.projectId, input.slug);
    const existing = table.portas[key];
    if (existing) return { port: existing.port, fresh: false };

    const taken = new Set(Object.values(table.portas).map((entry) => entry.port));
    for (let port = input.range.start; port <= input.range.end; port += 1) {
      if (taken.has(port) || RESERVED_PORTS.includes(port)) continue;
      if (!input.portFree(port)) {
        console.error(`[cbe] dev ${input.slug}: port ${port} is listening on this machine, trying the next one`);
        continue;
      }
      table.portas[key] = { port, desde: new Date((input.now ?? Date.now)()).toISOString() };
      writeDraftPorts(input.file, table);
      return { port, fresh: true };
    }
    console.error(`[cbe] dev ${input.slug}: no free port in ${input.range.start}-${input.range.end}`);
    throw new Error(`no free port in ${input.range.start}-${input.range.end}`);
  });
}

/**
 * A live child that predates the table (or whose entry was lost) is recorded under the port it really holds, so the table
 * answers "whose port is it" truthfully. Never takes a port that the table gave to another draft.
 */
export function adoptDraftPort(input: { file: string; projectId: number; slug: string; port: number; now?: () => number }): void {
  withMachineLock(lockOf(input.file), () => {
    const table = readDraftPorts(input.file);
    const key = keyOf(input.projectId, input.slug);
    if (table.portas[key]) return;
    const owner = Object.entries(table.portas).find(([, entry]) => entry.port === input.port)?.[0];
    if (owner) {
      console.error(`[cbe] dev ${input.slug}: live child on port ${input.port}, which the table gave to ${owner}; not recorded`);
      return;
    }
    table.portas[key] = { port: input.port, desde: new Date((input.now ?? Date.now)()).toISOString() };
    writeDraftPorts(input.file, table);
  });
}

/** Best effort: who listens on `port` (`ss -ltnp`: process and pid), or 'unknown listener'. Never throws. */
export function describeListener(port: number): string {
  try {
    const result = spawnSync('ss', ['-ltnpH', `sport = :${Math.trunc(port)}`], { encoding: 'utf8', timeout: 3000 });
    const match = /users:\(\("([^"]+)",pid=(\d+)/u.exec(result.stdout ?? '');
    return match ? `${match[1]} pid=${match[2]}` : 'unknown listener';
  } catch {
    return 'unknown listener';
  }
}
