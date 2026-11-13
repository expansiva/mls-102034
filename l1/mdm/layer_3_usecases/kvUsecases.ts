/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/kvUsecases.ts" enhancement="_blank" />
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { GetMdmKvParams, MdmKvRecord, PutMdmKvParams } from '/_102034_/l1/mdm/module.js';
import { UNIQUE_VIOLATION } from '/_102034_/l1/server/layer_1_external/data/moduleDataRuntime.js';
import { runMonitoredWrite } from '/_102034_/l1/mdm/layer_3_usecases/core/DataRecordService.js';

function validateKey(key: string) {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', 'key is required', 400, { field: 'key' });
  }
}

export async function getMdmKv(
  ctx: RequestContext,
  params: GetMdmKvParams,
): Promise<MdmKvRecord | null> {
  validateKey(params.key);
  const repository = await ctx.data.moduleData.getTable<MdmKvRecord>('mdmKv');
  return repository.findOne({
    where: {
      key: params.key.trim(),
    },
  });
}

export async function putMdmKv(
  ctx: RequestContext,
  params: PutMdmKvParams,
): Promise<MdmKvRecord> {
  validateKey(params.key);
  const record: MdmKvRecord = {
    key: params.key.trim(),
    value: params.value ?? null,
  };

  return runMonitoredWrite(ctx, {
    entityType: 'MdmKv',
    entityId: record.key,
    module: 'mdm',
    routine: 'mdm.kv.put',
    action: 'update',
  }, async () => {
    const repository = await ctx.data.moduleData.getTable<MdmKvRecord>('mdmKv');
    await repository.upsert({ record });
    return record;
  });
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } } | null)?.code
    ?? (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return code === UNIQUE_VIOLATION;
}

/**
 * Takes a key for the caller, once: the insert itself decides, so two callers of one key cannot both get it
 * (a read followed by a write could). `reserved: false` returns the row that holds the key.
 */
export async function reserveMdmKv(
  ctx: RequestContext,
  params: PutMdmKvParams,
): Promise<{ reserved: true; record: MdmKvRecord } | { reserved: false; record: MdmKvRecord | null }> {
  validateKey(params.key);
  const record: MdmKvRecord = { key: params.key.trim(), value: params.value ?? null };
  const repository = await ctx.data.moduleData.getTable<MdmKvRecord>('mdmKv');
  try {
    await repository.insert({ record });
    return { reserved: true, record };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return { reserved: false, record: await repository.findOne({ where: { key: record.key } }) };
  }
}
