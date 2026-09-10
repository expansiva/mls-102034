/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/classifyProjectAssetUrl.ts" enhancement="_blank" />
export type ProjectAssetKind = 'module' | 'static' | 'libs';

const QUERY_RE = /\?.*$/u;
const PROJECT_PATH_RE = /^\/_\d+_\/(l2|l3)\/(.+)$/u;

function remainderEscapesRoot(remainder: string): boolean {
  return remainder.split('/').includes('..');
}

/**
 * Who answers a runtime URL. Query string is ignored.
 * `module` → obj/compiled.zip only. `static`/`libs` → dist/<target>.
 * `/_chunks/**` and everything else → null (chunks are gone; rest is handleHttpRequest).
 * `l3` is always `static` (never a JS module). `..` in the remainder is refused.
 */
export function classifyProjectAssetUrl(urlPath: string): ProjectAssetKind | null {
  const path = urlPath.replace(QUERY_RE, '');
  if (path === '/_chunks' || path.startsWith('/_chunks/')) {
    return null;
  }
  if (path === '/_libs' || path.startsWith('/_libs/')) {
    return 'libs';
  }
  const match = PROJECT_PATH_RE.exec(path);
  if (!match) {
    return null;
  }
  const layer = match[1];
  const remainder = match[2];
  if (remainderEscapesRoot(remainder)) {
    return null;
  }
  if (layer === 'l3') {
    return 'static';
  }
  const lastSlash = remainder.lastIndexOf('/');
  const fileName = lastSlash === -1 ? remainder : remainder.slice(lastSlash + 1);
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) {
    return 'module';
  }
  const ext = fileName.slice(lastDot + 1).toLowerCase();
  return ext === 'js' ? 'module' : 'static';
}
