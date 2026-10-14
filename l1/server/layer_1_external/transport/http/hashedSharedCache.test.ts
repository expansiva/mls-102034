/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/hashedSharedCache.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getContentType, handleHttpRequest } from '/_102034_/l1/server/layer_1_external/transport/http/startServer.js';
import { resolveWebDistPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';

const ANNUAL = 'public, max-age=31536000, immutable';
const HASH_A = '/_libs/lit/shared-RT67AAA1.js';
const HASH_B = '/_libs/lit/shared-RT67BBB2.js';
const LIB = '/_libs/rt67-plainlib/plain.js';
const MISSING = '/_libs/lit/shared-RT67MISS.js';
const INDEX = '/_libs/lit/index.js';
const BYTES_A = Buffer.from('export const rt67a = 1;\n');
const BYTES_B = Buffer.from('export const rt67b = "other-bytes";\n');
const LIB_BYTES = Buffer.from('export const rt67plain = true;\n');

function distFile(urlPath: string): string {
  return resolveWebDistPath(`.${urlPath}`);
}

/** Writes a fixture only when the dist path is absent. Returns the remover. */
function place(urlPath: string, bytes: Buffer): () => void {
  const filePath = distFile(urlPath);
  if (existsSync(filePath)) {
    throw new Error(`refusing to overwrite ${filePath}`);
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, bytes);
  return () => {
    rmSync(filePath, { force: true });
  };
}

test('hashed lit shared chunks are immutable for a year; stable names stay no-cache', async () => {
  const cleanups: Array<() => void> = [];
  const probeDir = dirname(distFile(LIB));
  const probeDirExisted = existsSync(probeDir);
  try {
    cleanups.push(place(HASH_A, BYTES_A));
    cleanups.push(place(HASH_B, BYTES_B));
    cleanups.push(place(LIB, LIB_BYTES));

    const jsType = getContentType('.js');
    const a = await handleHttpRequest('GET', HASH_A);
    assert.equal(a.statusCode, 200);
    assert.ok(Buffer.isBuffer(a.body));
    assert.equal(Buffer.compare(a.body, BYTES_A), 0);
    assert.equal(a.headers?.['content-type'], jsType);
    assert.equal(a.headers?.['cache-control'], ANNUAL);

    const b = await handleHttpRequest('GET', HASH_B);
    assert.equal(b.statusCode, 200);
    assert.ok(Buffer.isBuffer(b.body));
    assert.equal(Buffer.compare(b.body, BYTES_B), 0);
    assert.notEqual(Buffer.compare(b.body, BYTES_A), 0);
    assert.equal(b.headers?.['content-type'], jsType);
    assert.equal(b.headers?.['cache-control'], ANNUAL);

    const withQuery = await handleHttpRequest('GET', `${HASH_A}?v=rt67`);
    assert.equal(withQuery.statusCode, 200);
    assert.ok(Buffer.isBuffer(withQuery.body));
    assert.equal(Buffer.compare(withQuery.body, BYTES_A), 0);
    assert.equal(withQuery.headers?.['content-type'], jsType);
    assert.equal(withQuery.headers?.['cache-control'], ANNUAL);

    const indexPath = distFile(INDEX);
    const indexExisted = existsSync(indexPath);
    const indexBytes = indexExisted
      ? readFileSync(indexPath)
      : Buffer.from('export const rt67index = 1;\n');
    if (!indexExisted) {
      cleanups.push(place(INDEX, indexBytes));
    }
    const index = await handleHttpRequest('GET', INDEX);
    assert.equal(index.statusCode, 200);
    assert.ok(Buffer.isBuffer(index.body));
    assert.equal(Buffer.compare(index.body, indexBytes), 0);
    assert.equal(index.headers?.['content-type'], jsType);
    assert.equal(index.headers?.['cache-control'], 'no-cache');

    const lib = await handleHttpRequest('GET', LIB);
    assert.equal(lib.statusCode, 200);
    assert.ok(Buffer.isBuffer(lib.body));
    assert.equal(Buffer.compare(lib.body, LIB_BYTES), 0);
    assert.equal(lib.headers?.['content-type'], jsType);
    assert.equal(lib.headers?.['cache-control'], 'no-cache');

    const missing = await handleHttpRequest('GET', MISSING);
    assert.equal(missing.statusCode, 404);
    assert.notEqual(missing.headers?.['cache-control'], ANNUAL);
  } finally {
    for (const cleanup of cleanups.reverse()) {
      cleanup();
    }
    if (!probeDirExisted) {
      rmSync(probeDir, { recursive: true, force: true });
    }
  }
});
