/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/newReleaseQaRoute.test.ts" enhancement="_blank" />

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNewReleaseQaHtml, canServeNewReleaseQa, isQaLoopback, newReleaseQaProjectHint } from './newReleaseQaRoute.js';

test('new release QA route is limited to test modes and loopback requests', () => {
  for (const mode of ['development', 'presentation'] as const) {
    assert.equal(canServeNewReleaseQa({ mode, host: 'localhost:2047', remoteAddress: '127.0.0.1' }), true);
    assert.equal(canServeNewReleaseQa({ mode, host: '[::1]:2047', remoteAddress: '::1' }), true);
  }
  assert.equal(canServeNewReleaseQa({ mode: 'production', host: 'localhost', remoteAddress: '127.0.0.1' }), false);
  assert.equal(canServeNewReleaseQa({ mode: 'homologation', host: 'localhost', remoteAddress: '127.0.0.1' }), false);
  assert.equal(canServeNewReleaseQa({ mode: 'presentation', host: '102047.collabcodes.com', remoteAddress: '127.0.0.1' }), false);
  assert.equal(canServeNewReleaseQa({ mode: 'presentation', host: 'localhost', remoteAddress: '10.0.0.8' }), false);
  for (const address of ['127.0.0.1', '127.255.255.255', '::1', '[::1]:2047', 'localhost:2047']) {
    assert.equal(isQaLoopback(address), true, address);
  }
  for (const address of ['0.0.0.0', '127.0.0.256', '127.00.0.1', '127.0.0', '128.0.0.1', '::ffff:10.0.0.1']) {
    assert.equal(isQaLoopback(address), false, address);
  }
});

test('QA html uses no login bypass and invalid project never falls back', () => {
  assert.equal(newReleaseQaProjectHint('/__qa/new-release'), 102047);
  assert.equal(newReleaseQaProjectHint('/__qa/new-release?project=102047'), 102047);
  assert.equal(newReleaseQaProjectHint('/__qa/new-release?project=bad'), 0);
  const html = buildNewReleaseQaHtml('release-1', 0);
  assert.match(html, /qaPreview\.js/u);
  assert.match(html, /projectId:"0"/u);
  assert.doesNotMatch(html, /cookie|cauth|loginUser|Authorization/u);
});
