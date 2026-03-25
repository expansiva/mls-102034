/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/kvUsecases.ts" enhancement="_blank" />
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { GetMdmKvParams, MdmKvRecord, PutMdmKvParams } from '/_102034_/l1/mdm/module.js';
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
