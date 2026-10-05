/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/msgProxy.test.ts" enhancement="_blank" />

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  msgProxyStartupLog, serviceIdentityHeaders,
} from '/_102034_/l1/server/layer_1_external/transport/http/msgProxy.js';

const TOKEN = 'rt39-service-token-must-not-leak';

test('empty env does not inject a service identity', () => {
  assert.deepEqual(serviceIdentityHeaders({}), { inject: null });
});

test('token and user produce the service headers', () => {
  assert.deepEqual(serviceIdentityHeaders({
    MSG_PROXY_TOKEN: TOKEN,
    MSG_PROXY_USER_ID: 'user-desenv',
    MSG_PROXY_ORG_ID: 'org-1',
  }), {
    inject: {
      authorization: `Bearer ${TOKEN}`,
      'x-user-id': 'user-desenv',
      'x-org-id': 'org-1',
    },
  });
});

test('a missing org omits x-org-id', () => {
  const result = serviceIdentityHeaders({
    MSG_PROXY_TOKEN: TOKEN,
    MSG_PROXY_USER_ID: 'user-desenv',
  });
  assert.ok('inject' in result && result.inject);
  assert.equal(Object.hasOwn(result.inject, 'x-org-id'), false);
});

test('a token without a user is an error and injects nothing', () => {
  assert.deepEqual(serviceIdentityHeaders({ MSG_PROXY_TOKEN: TOKEN, MSG_PROXY_USER_ID: '  ' }), {
    error: 'MSG_PROXY_TOKEN is set but MSG_PROXY_USER_ID is empty — service identity not injected',
  });
});

test('the startup log names the user and never the token', () => {
  const identity = serviceIdentityHeaders({
    MSG_PROXY_TOKEN: TOKEN,
    MSG_PROXY_USER_ID: 'user-desenv',
  });
  const line = msgProxyStartupLog('http://127.0.0.1:8180', identity);
  assert.match(line, /service identity user-desenv/u);
  assert.equal(line.includes(TOKEN), false);
});
