/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/registrationStore.ts" enhancement="_blank" />
import { createHash } from 'node:crypto';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { CacheRuntimeMemory } from '/_102034_/l1/server/layer_1_external/cache/CacheRuntimeMemory.js';
import { createMdmFacade } from '/_102034_/l1/mdm/layer_3_usecases/mdmFacade.js';
import type { MdmKvRecord } from '/_102034_/l1/mdm/module.js';

/** Platform KV prefix. Public mdm.kv get/put must refuse it. */
export const REGISTRATION_STORE_PREFIX = 'runtime.onboarding/';

const registrationTx = Symbol('registrationTx');

type RegistrationTxContext = RequestContext & { [registrationTx]?: true };

export function isRegistrationStoreKey(key: string): boolean {
  return typeof key === 'string' && key.trim().startsWith(REGISTRATION_STORE_PREFIX);
}

export function assertPublicKvKey(key: unknown): void {
  if (typeof key === 'string' && isRegistrationStoreKey(key)) {
    throw new AppError('VALIDATION_ERROR', 'key is reserved', 400, { field: 'key' });
  }
}

function assertStoreKey(key: string): string {
  if (typeof key !== 'string' || !isRegistrationStoreKey(key)) {
    throw new AppError('VALIDATION_ERROR', 'registration key is required', 400, { field: 'key' });
  }
  return key.trim();
}

function isPlatformJson(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function kvRepository(ctx: RequestContext) {
  return ctx.data.moduleData.getTable<MdmKvRecord>('mdmKv');
}

/** Missing row is null. A stored row that is not platform JSON throws. */
export async function readRegistrationStore(
  ctx: RequestContext,
  key: string,
): Promise<Record<string, unknown> | null> {
  const storedKey = assertStoreKey(key);
  const repository = await kvRepository(ctx);
  const row = await repository.findOne({ where: { key: storedKey } });
  if (!row) return null;
  if (!isPlatformJson(row.value)) {
    throw new AppError('REGISTRATION_STORE_INVALID', 'registration store value is invalid', 500, {
      field: 'value',
    });
  }
  return row.value;
}

export async function writeRegistrationStore(
  ctx: RequestContext,
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  const storedKey = assertStoreKey(key);
  if (!isPlatformJson(value)) {
    throw new AppError('VALIDATION_ERROR', 'registration store value is invalid', 400, { field: 'value' });
  }
  const repository = await kvRepository(ctx);
  await repository.upsert({ record: { key: storedKey, value } });
}

/** lockKey = prefix + SHA-256 of the JSON tuple. Same tuple, same key. */
export function registrationLockKey(scope: readonly unknown[]): string {
  const digest = createHash('sha256').update(JSON.stringify(scope)).digest('hex');
  return `${REGISTRATION_STORE_PREFIX}${digest}`;
}

/**
 * Keyed transaction. The callback sees bound data, a rebound facade and a private cache.
 * The parent cache is left untouched; callers drop identityCacheKey on the parent only after this resolves.
 */
export async function withRegistrationTransaction<TValue>(
  ctx: RequestContext,
  scope: readonly unknown[],
  callback: (ctx: RequestContext) => Promise<TValue>,
): Promise<TValue> {
  if ((ctx as RegistrationTxContext)[registrationTx]) {
    throw new AppError('NESTED_KEYED_TRANSACTION', 'nested registration transaction', 409);
  }
  const lockKey = registrationLockKey(scope);
  return ctx.data.runInTransaction(async (data) => {
    const tx: RegistrationTxContext = {
      ...ctx,
      data,
      cache: new CacheRuntimeMemory(),
    };
    tx.mdm = createMdmFacade(tx);
    tx[registrationTx] = true;
    return callback(tx);
  }, { lockKey });
}
