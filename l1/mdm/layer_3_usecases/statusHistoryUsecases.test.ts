/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/statusHistoryUsecases.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { createEntity, mergeEntity } from '/_102034_/l1/mdm/layer_3_usecases/recordUsecases.js';
import {
  findLatestStatusByEntity,
  findStatusHistoryByEntity,
} from '/_102034_/l1/mdm/layer_3_usecases/statusHistoryUsecases.js';

test('statusHistory queries return rows written by merge flow', async () => {
  const runtime = createMemoryDataRuntime();
  const ctx = createRequestContext(runtime);

  const winner = await createEntity(ctx, {
    detail: {
      subtype: 'Company',
      name: 'Winner Co',
      legalName: 'Winner Co LLC',
      status: 'Active',
    },
  });
  const loser = await createEntity(ctx, {
    detail: {
      subtype: 'Company',
      name: 'Loser Co',
      legalName: 'Loser Co LLC',
      status: 'Active',
    },
  });

  await mergeEntity(ctx, {
    winnerMdmId: winner.mdmId,
    loserMdmId: loser.mdmId,
  });

  const rows = await findStatusHistoryByEntity(ctx, {
    entityType: 'MdmEntity',
    entityId: loser.mdmId,
  });
  const latest = await findLatestStatusByEntity(ctx, {
    entityType: 'MdmEntity',
    entityId: loser.mdmId,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.toStatus, 'Merged');
  assert.equal(latest?.toStatus, 'Merged');
});
