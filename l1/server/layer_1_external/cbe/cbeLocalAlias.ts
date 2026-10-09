/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeLocalAlias.ts" enhancement="_blank" />

const LOCAL_ALIAS_RE = /^\/local\/_(\d+)_(.+)$/u;

/**
 * `/local/_<id>_<resto>` is the SW cache key; the release module lives at
 * `/_<id>_/l2/<resto>` then `/_<id>_/l4/<resto>`. Query is ignored.
 */
export function localAliasCandidates(rawUrl: string): string[] {
  const urlPath = rawUrl.replace(/\?.*$/u, '');
  const match = LOCAL_ALIAS_RE.exec(urlPath);
  if (!match) return [];

  let rest = match[2];
  if (rest.startsWith('/')) rest = rest.slice(1);
  if (!rest || rest.includes('..')) return [];

  const id = match[1];
  return [`/_${id}_/l2/${rest}`, `/_${id}_/l4/${rest}`];
}
