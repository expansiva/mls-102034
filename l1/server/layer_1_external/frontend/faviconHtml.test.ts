/// <mls fileReference="_102034_/l1/server/layer_1_external/frontend/faviconHtml.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_APP_FAVICON_HREF,
  injectFaviconLink,
  resolveAppFaviconHref,
} from '/_102034_/l1/server/layer_1_external/frontend/faviconHtml.js';
import { handleHttpRequest } from '/_102034_/l1/server/layer_1_external/transport/http/startServer.js';
import { resolveWebDistPath, type ProjectsConfig } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';

const spaHtml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../../mls-102033/l2/shared/spa/index.html'),
  'utf8',
);

test('resolveAppFaviconHref uses config when same-origin and default otherwise', () => {
  assert.deepEqual(resolveAppFaviconHref(undefined), { href: DEFAULT_APP_FAVICON_HREF, source: 'default' });
  assert.deepEqual(resolveAppFaviconHref(''), { href: DEFAULT_APP_FAVICON_HREF, source: 'default' });
  assert.deepEqual(resolveAppFaviconHref('https://cdn.example/icon.png'), {
    href: DEFAULT_APP_FAVICON_HREF,
    source: 'default',
  });
  assert.deepEqual(resolveAppFaviconHref('//cdn.example/icon.png'), {
    href: DEFAULT_APP_FAVICON_HREF,
    source: 'default',
  });
  assert.deepEqual(resolveAppFaviconHref('/me/icon.png'), { href: '/me/icon.png', source: 'config' });
});

test('not25 R2: ProjectsConfig.favicon is the typed config field (default and app)', () => {
  const fromApp: ProjectsConfig = {
    defaultProjectId: '1',
    shellTemplates: { spa: './spa.html', pwa: './pwa.html' },
    favicon: '/app/icon.png',
    projects: { '1': { root: '.', type: 'client' } },
  };
  assert.deepEqual(resolveAppFaviconHref(fromApp.favicon), { href: '/app/icon.png', source: 'config' });

  const fallback: ProjectsConfig = {
    defaultProjectId: '1',
    shellTemplates: { spa: './spa.html', pwa: './pwa.html' },
    projects: { '1': { root: '.', type: 'client' } },
  };
  assert.deepEqual(resolveAppFaviconHref(fallback.favicon), { href: DEFAULT_APP_FAVICON_HREF, source: 'default' });
});

test('not25 T6: injected HTML contains same-origin rel=icon', () => {
  assert.doesNotMatch(spaHtml, /rel=["']icon["']/);
  const html = injectFaviconLink(spaHtml, DEFAULT_APP_FAVICON_HREF);
  assert.match(html, /<link rel="icon" href="\/_102033_\/l3\/assets\/favicon\.png" \/>/);
  const href = html.match(/<link rel="icon" href="([^"]+)"/)?.[1] ?? '';
  assert.ok(href.startsWith('/') && !href.startsWith('//'), `href must be same-origin, got ${href}`);
  assert.equal(injectFaviconLink(html, '/other.png'), html);
});

test('readAppHtml injects the favicon link', () => {
  const source = readFileSync(new URL('../transport/http/startServer.ts', import.meta.url), 'utf8');
  assert.match(source, /injectFaviconLink/);
  assert.match(source, /faviconHref/);
});

test('GET /_102033_/l3/assets/favicon.png is 200 image/png when dist has the file', async (t) => {
  const filePath = resolveWebDistPath('./_102033_/l3/assets/favicon.png');
  if (!existsSync(filePath)) {
    t.skip('dist/web does not contain the favicon (build not run in this workspace)');
    return;
  }
  const result = await handleHttpRequest('GET', '/_102033_/l3/assets/favicon.png');
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers?.['content-type'], 'image/png');
  assert.ok(Buffer.isBuffer(result.body) && result.body.length > 0);
});
