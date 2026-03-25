/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/attachmentUsecases.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import {
  attachFile,
  detachFile,
  findAttachmentsByEntity,
} from '/_102034_/l1/mdm/layer_3_usecases/attachmentUsecases.js';

test('attachment attach and detach keeps local metadata', async () => {
  const runtime = createMemoryDataRuntime();
  const ctx = createRequestContext(runtime);

  const attached = await attachFile(ctx, {
    entityType: 'PurchaseOrder',
    entityId: 'po-2',
    fileName: 'quote.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    storageKey: 'attachments/purchasing/po-2/quote.pdf',
    storageProvider: 'local',
    category: 'quote',
  });
  const detached = await detachFile(ctx, { id: attached.id });
  const rows = await findAttachmentsByEntity(ctx, {
    entityType: 'PurchaseOrder',
    entityId: 'po-2',
  });

  assert.equal(attached.fileName, 'quote.pdf');
  assert.equal(detached.deletedAt !== null, true);
  assert.equal(rows.length, 1);
});
