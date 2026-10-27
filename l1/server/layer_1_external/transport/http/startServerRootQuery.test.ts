/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/startServerRootQuery.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHttpServer, handleHttpRequest, withQuery } from '/_102034_/l1/server/layer_1_external/transport/http/startServer.js';

test('withQuery leaves a location unchanged when the url has no query', () => {
  assert.equal(withQuery('/cafe/index.html', '/'), '/cafe/index.html');
  assert.equal(withQuery('/health', '/'), '/health');
});

test('withQuery copies the query as received', () => {
  assert.equal(
    withQuery('/cafe/index.html', '/?source=github&code=x&state=y'),
    '/cafe/index.html?source=github&code=x&state=y',
  );
  assert.equal(
    withQuery('/cafe/index.html', '/?code=a%2Fb'),
    '/cafe/index.html?code=a%2Fb',
  );
});

test('withQuery joins with & when the destination already has a query', () => {
  assert.equal(
    withQuery('/health?ok=1', '/?source=gitlab&code=x'),
    '/health?ok=1&source=gitlab&code=x',
  );
});

test('GET /?source=github&code=x&state=y redirects to the default page with the same query', async () => {
  const bare = await handleHttpRequest('GET', '/');
  const queried = await handleHttpRequest('GET', '/?source=github&code=x&state=y');
  const bareLocation = bare.headers?.location;
  assert.equal(typeof bareLocation, 'string');
  assert.match(String(bareLocation), /\/index\.html$|\/health$/u);
  assert.equal(queried.statusCode, 302);
  assert.equal(queried.headers?.location, `${bareLocation}?source=github&code=x&state=y`);
});

test('the Fastify root route keeps the query too (the door the browser actually uses)', async () => {
  const app = buildHttpServer();
  try {
    const bare = await app.inject({ method: 'GET', url: '/' });
    const queried = await app.inject({ method: 'GET', url: '/?source=github&code=x&state=y' });
    assert.equal(queried.statusCode, 302);
    assert.equal(queried.headers.location, `${bare.headers.location}?source=github&code=x&state=y`);
    const encoded = await app.inject({ method: 'GET', url: '/?code=a%2Fb&state=s' });
    assert.equal(encoded.headers.location, `${bare.headers.location}?code=a%2Fb&state=s`, 'copied as received, not decoded');
  } finally {
    await app.close();
  }
});
