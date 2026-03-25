/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/tagUsecases.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import {
  addTag,
  findTagsByEntity,
  findTagsByTag,
  removeTag,
} from '/_102034_/l1/mdm/layer_3_usecases/tagUsecases.js';

test('tag add normalizes lowercase, deduplicates, and can list by entity/tag', async () => {
  const runtime = createMemoryDataRuntime();
  const ctx = createRequestContext(runtime);

  const first = await addTag(ctx, {
    entityType: 'MdmCompany',
    entityId: 'entity-1',
    tag: 'VIP',
    module: 'purchasing',
  });
  const duplicate = await addTag(ctx, {
    entityType: 'MdmCompany',
    entityId: 'entity-1',
    tag: 'vip',
    module: 'purchasing',
  });

  assert.equal(first.alreadyExists, false);
  assert.equal(first.tag.tag, 'vip');
  assert.equal(duplicate.alreadyExists, true);

  const entityTags = await findTagsByEntity(ctx, {
    entityType: 'MdmCompany',
    entityId: 'entity-1',
  });
  assert.equal(entityTags.length, 1);

  const tagRows = await findTagsByTag(ctx, {
    entityType: 'MdmCompany',
    tag: 'VIP',
    module: 'purchasing',
  });
  assert.equal(tagRows.length, 1);

  const auditRows = await runtime.mdmAuditLog.findMany({
    where: { entityType: 'MdmTag', action: 'create' },
  });
  assert.equal(auditRows.length, 1);
});

test('tag remove deletes local row and records audit', async () => {
  const runtime = createMemoryDataRuntime();
  const ctx = createRequestContext(runtime);

  const created = await addTag(ctx, {
    entityType: 'MdmCompany',
    entityId: 'entity-2',
    tag: 'urgent',
    module: 'purchasing',
  });

  const removed = await removeTag(ctx, {
    entityType: 'MdmCompany',
    entityId: 'entity-2',
    tag: 'urgent',
    module: 'purchasing',
  });

  assert.equal(removed.removed, true);
  assert.equal(removed.id, created.tag.id);

  const entityTags = await findTagsByEntity(ctx, {
    entityType: 'MdmCompany',
    entityId: 'entity-2',
  });
  assert.equal(entityTags.length, 0);

  const auditRows = await runtime.mdmAuditLog.findMany({
    where: { entityType: 'MdmTag', entityId: created.tag.id, action: 'delete' },
  });
  assert.equal(auditRows.length, 1);
});
