/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/listenHost.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { listenHost } from '/_102034_/l1/server/layer_1_external/transport/http/listenHost.js';

test('without COLLAB_LISTEN_HOST the server listens on all interfaces, as before', () => {
  assert.equal(listenHost({}), '0.0.0.0');
  assert.equal(listenHost({ COLLAB_LISTEN_HOST: '   ' }), '0.0.0.0');
});

test('COLLAB_LISTEN_HOST names the address', () => {
  assert.equal(listenHost({ COLLAB_LISTEN_HOST: '127.0.0.1' }), '127.0.0.1');
});
