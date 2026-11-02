/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeCompiledLocal.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import {
  getCompiledProject,
  loadCompiledProject,
  warmCompiledProjects,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeCompiledLocal.js';

let nextProjectId = 880001;

function allocProjectId(): number {
  return nextProjectId++;
}

function withProjectsDir(fn: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'cbe-compiled-'));
  const prev = process.env.CBE_PROJECTS_DIR;
  process.env.CBE_PROJECTS_DIR = root;
  return fn(root).finally(() => {
    if (prev === undefined) delete process.env.CBE_PROJECTS_DIR;
    else process.env.CBE_PROJECTS_DIR = prev;
    rmSync(root, { recursive: true, force: true });
  });
}

function writeZip(root: string, projectId: number, files: { name: string; data: string }[]): void {
  const zip = new AdmZip();
  for (const file of files) zip.addFile(file.name, Buffer.from(file.data));
  const dir = join(root, `mls-${projectId}`, 'obj');
  mkdirSync(dir, { recursive: true });
  zip.writeZip(join(dir, 'compiled.zip'));
}

function flushImmediate(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

test('warmup reads each project once', async () => {
  await withProjectsDir(async (root) => {
    const first = allocProjectId();
    const second = allocProjectId();
    writeZip(root, first, []);
    writeZip(root, second, []);
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = ((...args: unknown[]) => {
      warns.push(args.map(String).join(' '));
    }) as typeof console.warn;
    try {
      warmCompiledProjects([first, second, first]);
      await flushImmediate();
      await flushImmediate();
      await flushImmediate();
      await flushImmediate();
    } finally {
      console.warn = orig;
    }
    const forFirst = warns.filter((line) => line.includes(`project ${first}:`));
    const forSecond = warns.filter((line) => line.includes(`project ${second}:`));
    assert.equal(forFirst.length, 1);
    assert.equal(forSecond.length, 1);
  });
});

test('login during warmup uses the same promise', async () => {
  await withProjectsDir(async (root) => {
    const projectId = allocProjectId();
    writeZip(root, projectId, [{
      name: 'fileinfos.json',
      data: JSON.stringify({ files: [{ shortPath: 'l2/foo.ts' }], lastModified: '2099-01-01T00:00:00.000Z' }),
    }, {
      name: `_${projectId}_/l2/foo.js`,
      data: 'console.log(1)',
    }]);
    const warmed = loadCompiledProject(projectId);
    const login = loadCompiledProject(projectId);
    assert.equal(login, warmed);
    const fromPromise = await warmed;
    const fromLogin = getCompiledProject(projectId);
    assert.ok(fromPromise);
    assert.equal(fromLogin, fromPromise);
    assert.equal(fromPromise.filesInfo[0]?.shortPath, 'l2/foo.ts');
    assert.equal(typeof fromPromise.filesInfo[0]?.jsContent, 'string');
  });
});

test('shortPath map matches findIndex: first duplicate wins', async () => {
  await withProjectsDir(async (root) => {
    const projectId = allocProjectId();
    writeZip(root, projectId, [{
      name: 'fileinfos.json',
      data: JSON.stringify({
        files: [
          { shortPath: 'l2/foo.ts' },
          { shortPath: 'l2/foo.ts' },
          { shortPath: 'l2/other.ts' },
        ],
        lastModified: '2099-01-01T00:00:00.000Z',
      }),
    }, {
      name: `_${projectId}_/l2/foo.js`,
      data: 'console.log(1)',
    }]);
    const entry = getCompiledProject(projectId);
    assert.ok(entry);
    assert.equal(typeof entry.filesInfo[0]?.jsContent, 'string');
    assert.equal(entry.filesInfo[1]?.jsContent, undefined);
    assert.equal(entry.filesInfo[2]?.jsContent, undefined);
    assert.equal(entry.isEmpty, false);
  });
});

test('one broken zip logs once and the next project still loads', async () => {
  await withProjectsDir(async (root) => {
    const broken = allocProjectId();
    const ok = allocProjectId();
    const brokenDir = join(root, `mls-${broken}`, 'obj');
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(join(brokenDir, 'compiled.zip'), 'not-a-zip');
    writeZip(root, ok, [{
      name: 'fileinfos.json',
      data: JSON.stringify({ files: [{ shortPath: 'l2/foo.ts' }], lastModified: '2099-01-02T00:00:00.000Z' }),
    }]);
    const errors: string[] = [];
    const orig = console.error;
    console.error = ((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    }) as typeof console.error;
    try {
      warmCompiledProjects([broken, ok]);
      await flushImmediate();
      await flushImmediate();
      await flushImmediate();
      await flushImmediate();
    } finally {
      console.error = orig;
    }
    const forBroken = errors.filter((line) => line.includes(`project ${broken}:`));
    assert.equal(forBroken.length, 1);
    const loaded = getCompiledProject(ok);
    assert.ok(loaded);
    assert.equal(loaded.isEmpty, false);
  });
});
