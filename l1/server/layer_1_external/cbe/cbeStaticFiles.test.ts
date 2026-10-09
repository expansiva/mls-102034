/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeStaticFiles.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getCbeStaticFile,
  patchServiceWorkerForRuntime,
  resetPatchServiceWorkerWarnings,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeStaticFiles.js';

const MISS_BLOCK = `    totalNotFound += 1;
    return new Response(null, {
      status: 404,`;

const BUNDLE = `var MLSSERVICEWORKERVERSION = 12;
  var CACHE_NAME = "mls-v2";
${MISS_BLOCK}
    });`;

function etag(buf: Buffer): string {
  return `${createHash('sha1').update(buf).digest('base64')}a`;
}

function captureWarns(fn: () => void): string[] {
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return lines;
}

test('bundle real: CACHE_NAME ganha -r<id> e o patch do miss continua', () => {
  resetPatchServiceWorkerWarnings();
  const out = patchServiceWorkerForRuntime(Buffer.from(BUNDLE, 'utf8'), '20261009120000').toString('utf8');
  assert.match(out, /var CACHE_NAME = "mls-v2-r20261009120000";/u);
  assert.match(out, /const networkResponse = await fetch\(event\.request\);/u);
  assert.equal(out.includes('var MLSSERVICEWORKERVERSION = 12;'), true);
});

test('duas releases: bytes e ETag diferentes; a mesma release, o mesmo ETag', () => {
  resetPatchServiceWorkerWarnings();
  const a = patchServiceWorkerForRuntime(Buffer.from(BUNDLE, 'utf8'), '20261009120000');
  const b = patchServiceWorkerForRuntime(Buffer.from(BUNDLE, 'utf8'), '20261009120001');
  const a2 = patchServiceWorkerForRuntime(Buffer.from(BUNDLE, 'utf8'), '20261009120000');
  assert.notEqual(a.toString('utf8'), b.toString('utf8'));
  assert.notEqual(etag(a), etag(b));
  assert.equal(a.equals(a2), true);
  assert.equal(etag(a), etag(a2));
});

test('null deixa CACHE_NAME intacto e avisa uma vez', () => {
  resetPatchServiceWorkerWarnings();
  const first = captureWarns(() => {
    const out = patchServiceWorkerForRuntime(Buffer.from(BUNDLE, 'utf8'), null).toString('utf8');
    assert.match(out, /var CACHE_NAME = "mls-v2";/u);
    assert.doesNotMatch(out, /-r/u);
  });
  const second = captureWarns(() => {
    patchServiceWorkerForRuntime(Buffer.from(BUNDLE, 'utf8'), null);
  });
  assert.equal(first.some((l) => l.includes('serving without release-scoped cache')), true);
  assert.equal(second.length, 0);
});

test('id com aspas ou ponto-e-vírgula não entra', () => {
  resetPatchServiceWorkerWarnings();
  for (const bad of ['foo"bar', 'foo;bar', 'x";alert(1)']) {
    const out = patchServiceWorkerForRuntime(Buffer.from(BUNDLE, 'utf8'), bad).toString('utf8');
    assert.match(out, /var CACHE_NAME = "mls-v2";/u);
    assert.equal(out.includes(bad), false);
    assert.doesNotMatch(out, /mls-v2-r/u);
  }
});

test('sem linha CACHE_NAME: serve, com o aviso', () => {
  resetPatchServiceWorkerWarnings();
  const src = `var MLSSERVICEWORKERVERSION = 12;\n${MISS_BLOCK}\n    });`;
  const warns = captureWarns(() => {
    const out = patchServiceWorkerForRuntime(Buffer.from(src, 'utf8'), '20261009120000').toString('utf8');
    assert.equal(out.includes('CACHE_NAME'), false);
    assert.match(out, /const networkResponse = await fetch\(event\.request\);/u);
  });
  assert.equal(warns.some((l) => l.includes('CACHE_NAME assignment not found')), true);
});

test('MLSSERVICEWORKERVERSION sai igual ao de entrada', () => {
  resetPatchServiceWorkerWarnings();
  const out = patchServiceWorkerForRuntime(Buffer.from(BUNDLE, 'utf8'), '20261009120000').toString('utf8');
  assert.match(out, /var MLSSERVICEWORKERVERSION = 12;/u);
});

test('getCbeStaticFile: mesma release, mesmo ETag (arquivo no disco intacto)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cbe-static-'));
  const prev = process.env.CBE_STATIC_DIR;
  process.env.CBE_STATIC_DIR = dir;
  try {
    writeFileSync(join(dir, 'mlsServiceWorker.js'), BUNDLE);
    const first = await getCbeStaticFile('/mlsServiceWorker.js', '');
    const second = await getCbeStaticFile('/mlsServiceWorker.js', '');
    assert.equal(first.statusCode, 200);
    assert.equal(first.eTag, second.eTag);
    assert.equal(first.eTag, etag(first.content!));
    const onDisk = readFileSync(join(dir, 'mlsServiceWorker.js'), 'utf8');
    assert.equal(onDisk, BUNDLE);
  } finally {
    if (prev === undefined) delete process.env.CBE_STATIC_DIR;
    else process.env.CBE_STATIC_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
