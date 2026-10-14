/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/classifyProjectAssetUrl.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProjectAssetUrl, HASHED_SHARED_JS_PATH } from '/_102034_/l1/server/layer_1_external/transport/http/classifyProjectAssetUrl.js';

const ID = '900001';

test('classifyProjectAssetUrl covers the five kinds plus query string', () => {
  assert.equal(classifyProjectAssetUrl(`/_${ID}_/l2/designSystem.js`), 'module');
  assert.equal(classifyProjectAssetUrl(`/_${ID}_/l2/shared/bootstrap`), 'module');
  assert.equal(classifyProjectAssetUrl(`/_${ID}_/l2/theme.css`), 'static');
  assert.equal(classifyProjectAssetUrl(`/_${ID}_/l2/icon.svg`), 'static');
  assert.equal(classifyProjectAssetUrl(`/_${ID}_/l2/data.json`), 'static');
  assert.equal(classifyProjectAssetUrl(`/_${ID}_/l2/page.html`), 'static');
  assert.equal(classifyProjectAssetUrl(`/_${ID}_/l2/readme.md`), 'static');
  assert.equal(classifyProjectAssetUrl('/_libs/lit.js'), 'libs');
  assert.equal(classifyProjectAssetUrl('/_chunks/chunk-ABC.js'), null);
  assert.equal(classifyProjectAssetUrl('/health'), null);
  assert.equal(classifyProjectAssetUrl(`/_${ID}_/l2/designSystem.js?v=abc`), 'module');
  assert.equal(classifyProjectAssetUrl('/_libs/lit.js?v=1'), 'libs');
  assert.equal(classifyProjectAssetUrl('/_chunks/x.js?v=1'), null);
});

test('T1: l3 library asset is static', () => {
  assert.equal(classifyProjectAssetUrl('/_102025_/l3/assets/x.wav'), 'static');
  assert.equal(classifyProjectAssetUrl('/_102025_/l3/assets/collabNotification.wav?v=1'), 'static');
});

test('T2: l3 path with .. is refused', () => {
  assert.equal(classifyProjectAssetUrl('/_102025_/l3/../../etc/passwd'), null);
  assert.equal(classifyProjectAssetUrl('/_102025_/l3/foo/../../../etc/passwd'), null);
});

test('T3: l3 .js is static, never module', () => {
  assert.equal(classifyProjectAssetUrl('/_102025_/l3/x.js'), 'static');
  assert.notEqual(classifyProjectAssetUrl('/_102025_/l3/x.js'), 'module');
});

function pathname(urlPath: string): string {
  return urlPath.replace(/\?.*$/u, '');
}

test('HASHED_SHARED_JS_PATH matches only lit shared chunks of eight hash chars', () => {
  for (const urlPath of [
    '/_libs/lit/shared-ABCDEFGH.js',
    '/_libs/lit/shared-A1B2C3D4.js',
    '/_libs/lit/shared-01234567.js?v=1',
    '/_libs/lit/shared-ABCDEFGH.js?extra=/_libs/lit/shared-ZZZZZZZZ.js',
  ]) {
    assert.equal(HASHED_SHARED_JS_PATH.test(pathname(urlPath)), true, urlPath);
  }
  for (const urlPath of [
    '/_libs/lit/index.js',
    '/_libs/lit/decorators.js',
    '/_libs/lit/directives/repeat.js',
    '/_libs/lit/echarts.min.js',
    '/_libs/echarts.min.js',
    '/_libs/lit/shared.js',
    '/_libs/lit/shared-ABC.js',
    '/_libs/lit/shared-ABCDEFGH.js.map',
    '/_libs/lit/shared_ABCDEFGH.js',
    '/_102034_/l2/shared-ABCDEFGH.js',
    '/_libs/other/shared-ABCDEFGH.js',
    '/_libs/lit/../lit/shared-ABCDEFGH.js',
    '/_libs/lit/index.js?cache=immutable',
  ]) {
    assert.equal(HASHED_SHARED_JS_PATH.test(pathname(urlPath)), false, urlPath);
  }
});

test('l4 is module only for .js or extensionless', () => {
  assert.equal(classifyProjectAssetUrl('/_102034_/l4/ontology/mdm.defs.js'), 'module');
  assert.equal(classifyProjectAssetUrl('/_102034_/l4/ontology/mdm'), 'module');
  assert.equal(classifyProjectAssetUrl('/_102034_/l4/ontology/mdm.defs.ts'), null);
  assert.equal(classifyProjectAssetUrl('/_102034_/l4/x.json'), null);
  assert.equal(classifyProjectAssetUrl('/_102034_/l4/../l1/x.js'), null);
});
