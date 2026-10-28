/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeStaticFiles.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getCbeStaticFile,
  patchServiceWorkerForRuntime,
  
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

test('bundle real: CACHE_NAME fica mls-v2 sem release e o patch do miss continua', () => {
  const out = patchServiceWorkerForRuntime(Buffer.from(BUNDLE, 'utf8'), '20261009120000').toString('utf8');
  assert.match(out, /var CACHE_NAME = "mls-v2";/u);
  assert.doesNotMatch(out, /mls-v2-r/u);
  assert.match(out, /const networkResponse = await fetch\(event\.request\);/u);
  assert.match(out, /await cache\.put\(url, networkResponse\.clone\(\)\);/u);
  assert.equal(out.includes('var MLSSERVICEWORKERVERSION = 12;'), true);
});

test('miss grava a resposta ok sob a mesma url, só /local/ ou /_', () => {
  const out = patchServiceWorkerForRuntime(Buffer.from(BUNDLE, 'utf8'), '20261009120000').toString('utf8');
  assert.match(out, /caches\.open\(CACHE_NAME\)/u);
  assert.match(out, /url\.startsWith\('\/local\/'\) \|\| url\.startsWith\('\/_'\)/u);
  assert.match(out, /await cache\.put\(url, networkResponse\.clone\(\)\);/u);
  assert.match(out, /console\.warn\('\[ServiceWorker\] cache\.put failed', err\);/u);
  assert.equal(out.includes('return networkResponse;'), true);
  const putAt = out.indexOf('cache.put');
  const returnAt = out.indexOf('return networkResponse;');
  assert.equal(putAt > 0 && putAt < returnAt, true);
});

test('duas releases: os mesmos bytes e o mesmo ETag', () => {
  const a = patchServiceWorkerForRuntime(Buffer.from(BUNDLE, 'utf8'), '20261009120000');
  const b = patchServiceWorkerForRuntime(Buffer.from(BUNDLE, 'utf8'), '20261009120001');
  const a2 = patchServiceWorkerForRuntime(Buffer.from(BUNDLE, 'utf8'), '20261009120000');
  assert.equal(a.toString('utf8'), b.toString('utf8'));
  assert.equal(etag(a), etag(b));
  assert.equal(a.equals(a2), true);
  assert.equal(etag(a), etag(a2));
});

test('null deixa CACHE_NAME intacto e não avisa por release', () => {
  const first = captureWarns(() => {
    const out = patchServiceWorkerForRuntime(Buffer.from(BUNDLE, 'utf8'), null).toString('utf8');
    assert.match(out, /var CACHE_NAME = "mls-v2";/u);
    assert.doesNotMatch(out, /-r/u);
  });
  assert.equal(first.some((l) => l.includes('release-scoped cache')), false);
});

test('id com aspas ou ponto-e-vírgula não entra', () => {
  for (const bad of ['foo"bar', 'foo;bar', 'x";alert(1)']) {
    const out = patchServiceWorkerForRuntime(Buffer.from(BUNDLE, 'utf8'), bad).toString('utf8');
    assert.match(out, /var CACHE_NAME = "mls-v2";/u);
    assert.equal(out.includes(bad), false);
    assert.doesNotMatch(out, /mls-v2-r/u);
  }
});

test('MLSSERVICEWORKERVERSION sai igual ao de entrada', () => {
  const out = patchServiceWorkerForRuntime(Buffer.from(BUNDLE, 'utf8'), '20261009120000').toString('utf8');
  assert.match(out, /var MLSSERVICEWORKERVERSION = 12;/u);
});

test('sem slug: CACHE_NAME fica mls-v2, sem release', () => {
  const out = patchServiceWorkerForRuntime(Buffer.from(BUNDLE, 'utf8'), '20261009120000').toString('utf8');
  assert.match(out, /var CACHE_NAME = "mls-v2";/u);
  assert.doesNotMatch(out, /mls-v2-r/u);
  assert.doesNotMatch(out, /-d/u);
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

test('getCbeStaticFile: o service worker servido é o mesmo para todas as abas (sem sufixo de rascunho)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cbe-static-one-'));
  const prev = process.env.CBE_STATIC_DIR;
  process.env.CBE_STATIC_DIR = dir;
  try {
    writeFileSync(join(dir, 'mlsServiceWorker.js'), BUNDLE);
    const a = await getCbeStaticFile('/mlsServiceWorker.js', '');
    const b = await getCbeStaticFile('/mlsServiceWorker.js', '');
    assert.equal(a.statusCode, 200);
    assert.equal(a.eTag, b.eTag);
    assert.match(a.content!.toString('utf8'), /var CACHE_NAME = "mls-v2";/u);
    assert.doesNotMatch(a.content!.toString('utf8'), /-d/u);
    assert.equal(readFileSync(join(dir, 'mlsServiceWorker.js'), 'utf8'), BUNDLE);
  } finally {
    if (prev === undefined) delete process.env.CBE_STATIC_DIR;
    else process.env.CBE_STATIC_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
