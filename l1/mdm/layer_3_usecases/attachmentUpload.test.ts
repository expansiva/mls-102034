/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/attachmentUpload.test.ts" enhancement="_blank" />

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { handleHttpRequest } from '/_102034_/l1/server/layer_1_external/transport/http/startServer.js';
import { assertPermanentAttachmentKey } from '/_102034_/l1/server/layer_1_external/storage/attachmentKey.js';
import { MemoryObjectStore } from '/_102034_/l1/server/layer_1_external/storage/objectStore.js';
import { resolveObjectBuckets } from '/_102034_/l1/server/layer_1_external/storage/objectBuckets.js';
import {
  getAttachmentReadUrl, resetAttachmentStorage, uploadAttachment,
} from '/_102034_/l1/mdm/layer_3_usecases/attachmentUpload.js';

const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex').toString('base64');

test.beforeEach(() => {
  process.env.APP_ENV = 'development';
  process.env.RUNTIME_MODE = 'memory';
  process.env.PROJECT_ID = '102047';
  process.env.ATTACHMENT_LOCAL_DIR = mkdtempSync(join(tmpdir(), 'att-'));
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.S3_BUCKET;
  resetAttachmentStorage();
});

function storage() {
  const store = new MemoryObjectStore();
  const buckets = resolveObjectBuckets({ projectId: '102047' });
  return { store, buckets };
}

test('upload writes the permanent prefix, never a URL, and never tmp', async () => {
  const ctx = createRequestContext();
  const pet = await ctx.mdm.entity.create({
    details: { subtype: 'Animal', name: 'Rex', tags: ['petShop'], moduleTypes: ['petShop.Pet'] },
  });
  const { store, buckets } = storage();
  const result = await uploadAttachment(ctx, {
    entityType: 'MdmEntity',
    entityId: pet.mdmId,
    fileName: 'before.jpg',
    mimeType: 'image/jpeg',
    category: 'before',
    base64: JPEG,
  }, { store, buckets });

  assert.equal(result.record.storageProvider, 'local');
  assert.match(result.record.storageKey, /^attachments\/102047\/MdmEntity\//u);
  assert.equal(result.record.storageKey.includes('tmp'), false);
  assert.equal(result.bucket, 'local-102047');
  const serialized = JSON.stringify(result.record);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(serialized.includes('X-Amz-'), false);
  assert.ok(store.objects.has(`${result.bucket}/${result.record.storageKey}`));

  const read = await getAttachmentReadUrl(ctx, result.record.id, { store, buckets });
  assert.equal(read.storageKey, result.record.storageKey);
  assert.equal(read.url.startsWith('/attachments/'), true);
  assert.equal(JSON.stringify(result.record).includes(read.url), false);
});

test('mimeType and size are rejected before any object is stored', async () => {
  const ctx = createRequestContext();
  const { store, buckets } = storage();
  await assert.rejects(
    () => uploadAttachment(ctx, {
      entityType: 'MdmEntity', entityId: 'pet-1', fileName: 'x.txt', mimeType: 'text/plain', base64: JPEG,
    }, { store, buckets }),
    (error: unknown) => error instanceof AppError && error.message.includes('not allowed'),
  );
  await assert.rejects(
    () => uploadAttachment(ctx, {
      entityType: 'MdmEntity', entityId: 'pet-1', fileName: 'x.jpg', mimeType: 'image/jpeg', base64: JPEG,
    }, { store, buckets, limits: { maxBytes: 4, allowedMime: ['image/jpeg'] } }),
    (error: unknown) => error instanceof AppError && /maximum is 4/.test(error.message),
  );
  assert.equal(store.objects.size, 0);
});

test('a tmp key is refused — that prefix expires and would leave a dead mdm_attachment row', () => {
  assert.throws(
    () => assertPermanentAttachmentKey('images/tmp/pet/before.jpg'),
    (error: unknown) => error instanceof AppError && /cannot use a tmp/.test(error.message),
  );
});

test('POST /attachments then GET url never persists the signed path on the record', async () => {
  const ctx = createRequestContext();
  const pet = await ctx.mdm.entity.create({
    details: { subtype: 'Animal', name: 'Mia', tags: ['petShop'], moduleTypes: ['petShop.Pet'] },
  });
  const posted = await handleHttpRequest('POST', '/attachments', {
    entityType: 'MdmEntity',
    entityId: pet.mdmId,
    fileName: 'after.png',
    mimeType: 'image/png',
    category: 'after',
    base64: Buffer.from('png').toString('base64'),
  }, ctx);
  assert.equal(posted.statusCode, 200);
  const body = posted.body as { ok: boolean; data: { record: { id: string; storageKey: string } } };
  assert.equal(body.ok, true);
  assert.match(body.data.record.storageKey, /^attachments\/102047\//u);
  assert.equal(JSON.stringify(body.data.record).includes('https://'), false);

  const read = await handleHttpRequest('GET', `/attachments/${body.data.record.id}/url`, undefined, ctx);
  assert.equal(read.statusCode, 200);
  const readBody = read.body as { ok: boolean; data: { url: string; storageKey: string } };
  assert.equal(readBody.data.storageKey, body.data.record.storageKey);
  assert.equal(JSON.stringify(body.data.record).includes(readBody.data.url), false);
});
