/// <mls fileReference="_102034_/l1/server/layer_1_external/frontend/faviconHtml.ts" enhancement="_blank" />

/** Default tab icon: same-origin l3 asset of the master frontend (not23). */
export const DEFAULT_APP_FAVICON_HREF = '/_102033_/l3/assets/favicon.png';

export type FaviconSource = 'config' | 'default';

export function resolveAppFaviconHref(favicon: string | undefined | null): { href: string; source: FaviconSource } {
  const candidate = typeof favicon === 'string' ? favicon.trim() : '';
  // Same-origin only: a leading `/` that is not protocol-relative (`//cdn...`).
  if (candidate.startsWith('/') && !candidate.startsWith('//')) {
    return { href: candidate, source: 'config' };
  }
  return { href: DEFAULT_APP_FAVICON_HREF, source: 'default' };
}

export function injectFaviconLink(html: string, href: string): string {
  if (/rel\s*=\s*["'][^"']*\bicon\b/i.test(html)) return html;
  const tag = `<link rel="icon" href="${href}" />`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `  ${tag}\n  </head>`);
  }
  return `${tag}\n${html}`;
}
