/// <mls fileReference="_102034_/l1/server/layer_1_external/cache/CacheRuntimeMemory.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { CacheRuntimeMemory } from '/_102034_/l1/server/layer_1_external/cache/CacheRuntimeMemory.js';
import { createIdentityCache } from '/_102034_/l1/server/layer_1_external/cache/identityCache.js';
import { CacheRuntimeRedis } from '/_102034_/l1/server/layer_1_external/cache/CacheRuntimeRedis.js';

test('memory cache stores, expires by TTL, and deletes', async () => {
  const cache = new CacheRuntimeMemory();
  await cache.set('k', { n: 1 }, 1);
  assert.deepEqual(await cache.get('k'), { n: 1 });
  await cache.del('k');
  assert.equal(await cache.get('k'), null);

  await cache.set('ttl', 'x', 0.001);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(await cache.get('ttl'), null);
});

test('createIdentityCache branches on REDIS_URL presence, never on host', () => {
  assert.equal(createIdentityCache(undefined) instanceof CacheRuntimeMemory, true);
  assert.equal(createIdentityCache('') instanceof CacheRuntimeMemory, true);
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    assert.equal(createIdentityCache(redisUrl) instanceof CacheRuntimeRedis, true);
  }
});
