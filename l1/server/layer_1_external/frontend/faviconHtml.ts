/// <mls fileReference="_102034_/l1/server/layer_1_external/frontend/faviconHtml.ts" enhancement="_blank" />
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
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

export function injectFaviconLink(html: string, href: string): string {
  if (/rel\s*=\s*["'][^"']*\bicon\b/i.test(html)) return html;
  const tag = `<link rel="icon" href="${hrefWithVersion(href)}" />`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `  ${tag}\n  </head>`);
  }
  return `${tag}\n${html}`;
}
