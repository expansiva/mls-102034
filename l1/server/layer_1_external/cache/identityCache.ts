/// <mls fileReference="_102034_/l1/server/layer_1_external/cache/identityCache.ts" enhancement="_blank" />
import {
  CacheRuntimeMemory,
  type ICacheRuntime,
} from '/_102034_/l1/server/layer_1_external/cache/CacheRuntimeMemory.js';
import { CacheRuntimeRedis } from '/_102034_/l1/server/layer_1_external/cache/CacheRuntimeRedis.js';

export const IDENTITY_CACHE_KEY_PREFIX = 'identity:login:';
export const DEFAULT_IDENTITY_CACHE_TTL_SECONDS = 300;

export interface IdentityCacheValue {
  mdmId: string;
  name: string;
}

export function identityCacheKey(email: string): string {
  return `${IDENTITY_CACHE_KEY_PREFIX}${email.trim().toLowerCase()}`;
}

export function identityCacheTtlSeconds(): number {
  const raw = process.env.IDENTITY_CACHE_TTL_SECONDS;
  const parsed = raw ? Number(raw) : DEFAULT_IDENTITY_CACHE_TTL_SECONDS;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_IDENTITY_CACHE_TTL_SECONDS;
}

/**
 * Pick the cache implementation by capability: Redis when REDIS_URL is present,
 * in-memory otherwise. Never by host name.
 */
export function createIdentityCache(redisUrl?: string | null): ICacheRuntime {
  const ttl = identityCacheTtlSeconds();
  if (redisUrl) return new CacheRuntimeRedis(redisUrl, ttl);
  return new CacheRuntimeMemory(ttl);
}

let shared: ICacheRuntime | undefined;

export function getSharedIdentityCache(): ICacheRuntime {
  if (!shared) {
    shared = createIdentityCache(process.env.REDIS_URL);
  }
  return shared;
}

export function resetSharedIdentityCacheForTests(): void {
  shared = undefined;
}
