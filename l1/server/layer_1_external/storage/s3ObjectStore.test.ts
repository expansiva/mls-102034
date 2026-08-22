/// <mls fileReference="_102034_/l1/server/layer_1_external/storage/s3ObjectStore.test.ts" enhancement="_blank" />

import test from 'node:test';
import assert from 'node:assert/strict';
import { S3ObjectStore } from '/_102034_/l1/server/layer_1_external/storage/s3ObjectStore.js';

test('presigned GET is a derived URL — bucket per project, never a tmp prefix', async () => {
  const store = new S3ObjectStore({
    region: 'us-east-1',
    accessKeyId: 'AKIAFAKE',
    secretAccessKey: 'secret',
  });
  const url = await store.getPresignedGetUrl({
    bucket: 'collab-102047',
    key: 'attachments/102047/MdmEntity/pet-1/id-before.jpg',
    expiresIn: 3600,
  });
  assert.match(url, /^https:\/\/collab-102047\.s3\.amazonaws.com\/attachments\/102047\//u);
  assert.match(url, /X-Amz-Signature=/u);
  assert.match(url, /X-Amz-Expires=3600/u);
  assert.equal(url.includes('/tmp/'), false);
});
