/// <mls fileReference="_102034_/l1/server/layer_1_external/frontend/appRegistry.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { requireShellTemplate } from '/_102034_/l1/server/layer_1_external/frontend/appRegistry.js';

test('requireShellTemplate names the missing key instead of reading undefined.spa', () => {
  assert.throws(
    () => requireShellTemplate(undefined, 'spa'),
    /config\.shellTemplates\.spa is required \(missing from client config\.json\)/,
  );
  assert.throws(
    () => requireShellTemplate({}, 'spa'),
    /config\.shellTemplates\.spa is required/,
  );
  assert.throws(
    () => requireShellTemplate({ spa: './_102033_/l2/shared/spa/index.html' }, 'pwa'),
    /config\.shellTemplates\.pwa is required/,
  );
});

test('requireShellTemplate returns the path when the mode is declared', () => {
  assert.equal(
    requireShellTemplate(
      { spa: './_102033_/l2/shared/spa/index.html', pwa: './_102033_/l2/shared/pwa/index.html' },
      'spa',
    ),
    './_102033_/l2/shared/spa/index.html',
  );
});
