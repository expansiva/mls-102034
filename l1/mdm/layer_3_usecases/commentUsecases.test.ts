/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/commentUsecases.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import {
  addComment,
  editComment,
  findCommentsByEntity,
  removeComment,
} from '/_102034_/l1/mdm/layer_3_usecases/commentUsecases.js';

test('comment add/edit/remove keeps thread and audit trail', async () => {
  const runtime = createMemoryDataRuntime();
  const ctx = createRequestContext(runtime);
  ctx.requestMeta = {
    userId: 'user-1',
    source: 'test',
  };

  const created = await addComment(ctx, {
    entityType: 'PurchaseOrder',
    entityId: 'po-1',
    text: 'Initial note',
    module: 'purchasing',
  });
  const edited = await editComment(ctx, {
    id: created.id,
    text: 'Edited note',
    editorId: 'user-1',
  });
  const removed = await removeComment(ctx, { id: created.id });
  const rows = await findCommentsByEntity(ctx, {
    entityType: 'PurchaseOrder',
    entityId: 'po-1',
  });

  assert.equal(edited.text, 'Edited note');
  assert.equal(removed.text, '[removed]');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.deletedAt !== null, true);
});
