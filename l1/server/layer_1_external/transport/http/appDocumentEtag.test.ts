/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/appDocumentEtag.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initCbeLatestJson } from '/_102034_/l1/server/layer_1_external/cbe/cbeLatestJson.js';
import { appHtmlBuildCount, buildHttpServer, clearAppHtmlCache } from '/_102034_/l1/server/layer_1_external/transport/http/startServer.js';

// rt183: the entry document of a module has an ETag of its final body, so a reload answers 304.

function eTagOf(res: { headers: Record<string, unknown> }): string {
  return String(res.headers.etag ?? '');
}

async function withLatest<T>(content: string, run: (restart: (next: string) => void) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'rt183-'));
  const saved = { dir: process.env.CBE_STATIC_DIR, url: process.env.CBE_LATEST_URL };
  process.env.CBE_STATIC_DIR = dir;
  process.env.CBE_LATEST_URL = 'http://127.0.0.1:1/latest.json'; // unreachable: only the disk copy counts
  const write = (text: string) => {
    writeFileSync(join(dir, 'latest.json'), text);
    initCbeLatestJson();
  };
  write(content);
  try {
    return await run(write);
  } finally {
    if (saved.dir === undefined) delete process.env.CBE_STATIC_DIR; else process.env.CBE_STATIC_DIR = saved.dir;
    if (saved.url === undefined) delete process.env.CBE_LATEST_URL; else process.env.CBE_LATEST_URL = saved.url;
  }
}

test('the entry document comes with an ETag and no-cache; If-None-Match with it answers 304', async () => {
  clearAppHtmlCache();
  const app = buildHttpServer();
  try {
    const root = await app.inject({ method: 'GET', url: '/' });
    const url = String(root.headers.location);
    assert.match(url, /\/index\.html$/u);
    const first = await app.inject({ method: 'GET', url });
    assert.equal(first.statusCode, 200);
    assert.equal(first.headers['cache-control'], 'no-cache');
    const tag = eTagOf(first);
    assert.match(tag, /^"[a-f0-9]{40}"$/u);
    const again = await app.inject({ method: 'GET', url, headers: { 'if-none-match': tag } });
    assert.equal(again.statusCode, 304);
    assert.equal(eTagOf(again), tag);
    const other = await app.inject({ method: 'GET', url, headers: { 'if-none-match': '"0000000000000000000000000000000000000000"' } });
    assert.equal(other.statusCode, 200);
    assert.equal(other.body, first.body);
    const weak = await app.inject({ method: 'GET', url, headers: { 'if-none-match': `W/${tag}` } });
    assert.equal(weak.statusCode, 304, 'a weak validator of the same tag (what a proxy sends) also matches');
  } finally {
    await app.close();
  }
});

test('every route of the module gets the same document and the same ETag', async () => {
  clearAppHtmlCache();
  const app = buildHttpServer();
  try {
    const root = await app.inject({ method: 'GET', url: '/' });
    const index = String(root.headers.location);
    const base = index.slice(0, index.lastIndexOf('/'));
    const a = await app.inject({ method: 'GET', url: index });
    const b = await app.inject({ method: 'GET', url: `${base}/uma/rota/qualquer` });
    assert.equal(b.statusCode, 200);
    assert.equal(eTagOf(b), eTagOf(a));
    assert.equal(b.body, a.body);
    const viaTag = await app.inject({ method: 'GET', url: `${base}/outra/rota`, headers: { 'if-none-match': eTagOf(a) } });
    assert.equal(viaTag.statusCode, 304, 'the ETag taken on one route validates another route of the same module');
  } finally {
    await app.close();
  }
});

test('a new latest.json changes the document and its ETag; the old ETag then gets a 200', async () => {
  const app = buildHttpServer();
  try {
    await withLatest('{"libs":"1"}', async (publish) => {
      clearAppHtmlCache();
      const root = await app.inject({ method: 'GET', url: '/' });
      const url = String(root.headers.location);
      const before = await app.inject({ method: 'GET', url });
      assert.match(before.body, /window\.latest=\{"libs":"1"\}/u);
      publish('{"libs":"2"}');
      const after = await app.inject({ method: 'GET', url, headers: { 'if-none-match': eTagOf(before) } });
      assert.equal(after.statusCode, 200, 'the document changed: the old tag no longer validates');
      assert.match(after.body, /window\.latest=\{"libs":"2"\}/u);
      assert.notEqual(eTagOf(after), eTagOf(before));
    });
  } finally {
    await app.close();
  }
});

test('the body is built once per module until something changes: more requests build nothing', async () => {
  clearAppHtmlCache();
  const app = buildHttpServer();
  try {
    const root = await app.inject({ method: 'GET', url: '/' });
    const index = String(root.headers.location);
    const base = index.slice(0, index.lastIndexOf('/'));
    const before = appHtmlBuildCount();
    for (const url of [index, `${base}/a`, `${base}/b/c`, index]) await app.inject({ method: 'GET', url });
    assert.equal(appHtmlBuildCount() - before, 1, 'four requests, one build');
    clearAppHtmlCache();
    await app.inject({ method: 'GET', url: index });
    assert.equal(appHtmlBuildCount() - before, 2, 'a cleared cache builds again');
  } finally {
    await app.close();
  }
});
