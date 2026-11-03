/// <mls fileReference="_102034_/l1/server/layer_1_external/frontend/faviconHtml.ts" enhancement="_blank" />
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { resolveWebDistPath, type ProjectsConfig } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';

/** Default tab icon: same-origin l3 asset of the master frontend (not23). */
export const DEFAULT_APP_FAVICON_HREF = '/_102033_/l3/assets/favicon.png';

export type FaviconSource = 'config' | 'default';

/** Indexed access on `ProjectsConfig.favicon` so a missing field is a compile error (not25 R1). */
export function resolveAppFaviconHref(
  favicon: ProjectsConfig['favicon'] | null,
): { href: string; source: FaviconSource } {
  const candidate = typeof favicon === 'string' ? favicon.trim() : '';
  // Same-origin only: a leading `/` that is not protocol-relative (`//cdn...`).
  if (candidate.startsWith('/') && !candidate.startsWith('//')) {
    return { href: candidate, source: 'config' };
  }
  return { href: DEFAULT_APP_FAVICON_HREF, source: 'default' };
}

/** First 12 hex of sha256. Same width the build writes into `?v=`. */
export function contentHash12(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 12);
}

const faviconHashByHref = new Map<string, string>();

/** Hash of a same-origin favicon, kept for the life of the process. Missing file caches as empty. */
export function faviconContentHash(href: string): string {
  const cached = faviconHashByHref.get(href);
  if (cached !== undefined) return cached;
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('?') || href.includes('..')) {
    faviconHashByHref.set(href, '');
    return '';
  }
  const filePath = resolveWebDistPath(`.${href}`);
  if (!existsSync(filePath)) {
    faviconHashByHref.set(href, '');
    return '';
  }
  const hash = contentHash12(readFileSync(filePath));
  faviconHashByHref.set(href, hash);
  return hash;
}

function hrefWithVersion(href: string): string {
  if (href.includes('?')) return href;
  const hash = faviconContentHash(href);
  return hash ? `${href}?v=${hash}` : href;
}

function faviconContentType(filePath: string): string {
  switch (extname(filePath)) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.avif':
      return 'image/avif';
    case '.svg':
      return 'image/svg+xml; charset=utf-8';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

/** Bytes of the same-origin file `resolveAppFaviconHref` chose. Missing or unsafe href is null. */
export function readAppFaviconFile(href: string): { body: Buffer; contentType: string } | null {
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('?') || href.includes('..')) {
    return null;
  }
  const filePath = resolveWebDistPath(`.${href}`);
  if (!existsSync(filePath)) return null;
  return { body: readFileSync(filePath), contentType: faviconContentType(filePath) };
}

export interface FaviconIcoHttp {
  statusCode: 200 | 304 | 404;
  body: Buffer | '';
  headers?: { 'content-type': string; 'cache-control': 'no-cache'; etag: string };
}

/** 200 with the file type, or 304 when `If-None-Match` equals the ETag. Always `no-cache`. */
export function faviconIcoFromFile(
  file: { body: Buffer; contentType: string },
  ifNoneMatch: string | undefined,
): FaviconIcoHttp {
  const tag = contentHash12(file.body);
  const headers = {
    'content-type': file.contentType,
    'cache-control': 'no-cache' as const,
    etag: `"${tag}"`,
  };
  const client = (ifNoneMatch ?? '').replace(/^W\//u, '').replaceAll('"', '');
  if (client && client === tag) {
    return { statusCode: 304, body: '', headers };
  }
  return { statusCode: 200, body: file.body, headers };
}

/** `GET /favicon.ico`: the file `resolveAppFaviconHref` chose. Missing file is 404 plus one log line. */
export function faviconIcoResponse(
  favicon: ProjectsConfig['favicon'] | null,
  ifNoneMatch: string | undefined,
): FaviconIcoHttp {
  const href = resolveAppFaviconHref(favicon).href;
  const file = readAppFaviconFile(href);
  if (!file) {
    console.error(`[favicon] missing file for ${href}`);
    return { statusCode: 404, body: '' };
  }
  return faviconIcoFromFile(file, ifNoneMatch);
}

export function injectFaviconLink(html: string, href: string): string {
  if (/rel\s*=\s*["'][^"']*\bicon\b/i.test(html)) return html;
  const tag = `<link rel="icon" href="${hrefWithVersion(href)}" />`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `  ${tag}\n  </head>`);
  }
  return `${tag}\n${html}`;
}
