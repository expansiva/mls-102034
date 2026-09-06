/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/classifyProjectAssetUrl.ts" enhancement="_blank" />
export type ProjectAssetKind = 'module' | 'static' | 'libs';

const QUERY_RE = /\?.*$/u;
const L2_PATH_RE = /^\/_\d+_\/l2\/(.+)$/u;

/**
 * Who answers a runtime URL. Query string is ignored.
 * `module` → obj/compiled.zip only. `static`/`libs` → dist/<target>.
 * `/_chunks/**` and everything else → null (chunks are gone; rest is handleHttpRequest).
 */
export function classifyProjectAssetUrl(urlPath: string): ProjectAssetKind | null {
  const path = urlPath.replace(QUERY_RE, '');
  if (path === '/_chunks' || path.startsWith('/_chunks/')) {
    return null;
  }
  if (path === '/_libs' || path.startsWith('/_libs/')) {
    return 'libs';
  }
  const match = L2_PATH_RE.exec(path);
  if (!match) {
    return null;
  }
  const remainder = match[1];
  const lastSlash = remainder.lastIndexOf('/');
  const fileName = lastSlash === -1 ? remainder : remainder.slice(lastSlash + 1);
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) {
    return 'module';
  }
  const ext = fileName.slice(lastDot + 1).toLowerCase();
  return ext === 'js' ? 'module' : 'static';
}
