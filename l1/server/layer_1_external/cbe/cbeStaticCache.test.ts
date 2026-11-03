/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeStaticCache.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { registerCbeRoutes } from '/_102034_/l1/server/layer_1_external/cbe/cbeRoutes.js';

const STAMP = '20261102143000';
const IMMUTABLE = 'public, max-age=31536000, immutable';

test('versioned /libs and /monaco are immutable; a path without the stamp stays no-cache with an ETag', async () => {
  const base = mkdtempSync(join(tmpdir(), 'cbe-static-cache-'));
  const prev = process.env.CBE_STATIC_DIR;
  process.env.CBE_STATIC_DIR = base;
  mkdirSync(join(base, 'libs', STAMP), { recursive: true });
  mkdirSync(join(base, 'libs'), { recursive: true });
  mkdirSync(join(base, 'monaco', STAMP), { recursive: true });
  mkdirSync(join(base, 'monaco'), { recursive: true });
  writeFileSync(join(base, 'libs', STAMP, 'lit.js'), 'lit-bytes');
  writeFileSync(join(base, 'monaco', STAMP, 'editor.js'), 'monaco-bytes');
  writeFileSync(join(base, 'libs', 'lit.js'), 'plain-lib');
  writeFileSync(join(base, 'monaco', 'editor.js'), 'plain-monaco');

  const app = Fastify();
  registerCbeRoutes(app);
  try {
    const versionedLib = await app.inject({ method: 'GET', url: `/libs/${STAMP}/lit.js` });
    assert.equal(versionedLib.statusCode, 200);
    assert.equal(versionedLib.headers['cache-control'], IMMUTABLE);
    assert.match(String(versionedLib.headers.etag), /^".+"$/);

    const versionedMonaco = await app.inject({ method: 'GET', url: `/monaco/${STAMP}/editor.js?x=1` });
    assert.equal(versionedMonaco.statusCode, 200);
    assert.equal(versionedMonaco.headers['cache-control'], IMMUTABLE);
    assert.equal(typeof versionedMonaco.headers.etag, 'string');

    const plainLib = await app.inject({ method: 'GET', url: '/libs/lit.js' });
    assert.equal(plainLib.statusCode, 200);
    assert.equal(plainLib.headers['cache-control'], 'no-cache');
    assert.match(String(plainLib.headers.etag), /^".+"$/);

    const plainMonaco = await app.inject({ method: 'GET', url: '/monaco/editor.js' });
    assert.equal(plainMonaco.statusCode, 200);
    assert.equal(plainMonaco.headers['cache-control'], 'no-cache');
    assert.equal(typeof plainMonaco.headers.etag, 'string');

    const versioned304 = await app.inject({
      method: 'GET',
      url: `/libs/${STAMP}/lit.js`,
      headers: { 'if-none-match': String(versionedLib.headers.etag) },
    });
    assert.equal(versioned304.statusCode, 304);
    assert.equal(versioned304.headers['cache-control'], IMMUTABLE);
    assert.equal(versioned304.headers.etag, versionedLib.headers.etag);

    const plain304 = await app.inject({
      method: 'GET',
      url: '/libs/lit.js',
      headers: { 'if-none-match': String(plainLib.headers.etag) },
    });
    assert.equal(plain304.statusCode, 304);
    assert.equal(plain304.headers['cache-control'], 'no-cache');
    assert.equal(plain304.headers.etag, plainLib.headers.etag);
  } finally {
    await app.close();
    if (prev === undefined) delete process.env.CBE_STATIC_DIR;
    else process.env.CBE_STATIC_DIR = prev;
    rmSync(base, { recursive: true, force: true });
  }
});
