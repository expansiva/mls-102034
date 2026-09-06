/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/classifyProjectAssetUrl.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProjectAssetUrl } from '/_102034_/l1/server/layer_1_external/transport/http/classifyProjectAssetUrl.js';

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
