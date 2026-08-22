/// <mls fileReference="_102034_/l1/server/layer_1_external/storage/objectBuckets.test.ts" enhancement="_blank" />

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PERMANENT_BUCKET_PATTERN, DEFAULT_TMP_BUCKET_PATTERN, applyProjectId, resolveObjectBuckets,
} from '/_102034_/l1/server/layer_1_external/storage/objectBuckets.js';

test('one permanent bucket per project, named with the project id', () => {
  const resolved = resolveObjectBuckets({
    projectId: '102047',
    awsAccessKeyId: 'AKIA',
    awsSecretAccessKey: 'secret',
  });
  assert.equal(resolved.provider, 's3');
  assert.equal(resolved.permanent, 'collab-102047');
  assert.equal(resolved.tmp, 'collab-102047-tmp');
  assert.equal(resolved.localReason, '');
  assert.equal(DEFAULT_PERMANENT_BUCKET_PATTERN, 'collab-{projectId}');
  assert.equal(DEFAULT_TMP_BUCKET_PATTERN, 'collab-{projectId}-tmp');
  assert.equal(applyProjectId('collab-{projectId}', '102033'), 'collab-102033');
});

test('missing credentials or project id fall back to local and name what is missing', () => {
  const noCreds = resolveObjectBuckets({ projectId: '102047' });
  assert.equal(noCreds.provider, 'local');
  assert.match(noCreds.localReason, /AWS_ACCESS_KEY_ID/);
  assert.equal(noCreds.permanent, 'local-102047');

  const noProject = resolveObjectBuckets({
    awsAccessKeyId: 'AKIA',
    awsSecretAccessKey: 'secret',
  });
  assert.equal(noProject.provider, 'local');
  assert.match(noProject.localReason, /PROJECT_ID is missing/);

  const empty = resolveObjectBuckets({
    projectId: '102047',
    s3BucketPattern: '',
    awsAccessKeyId: 'AKIA',
    awsSecretAccessKey: 'secret',
  });
  assert.equal(empty.provider, 'local');
  assert.match(empty.localReason, /S3_BUCKET is empty/);
});

test('an empty tmp pattern disables the tmp bucket; MDM never needs it', () => {
  const resolved = resolveObjectBuckets({
    projectId: '102047',
    awsAccessKeyId: 'AKIA',
    awsSecretAccessKey: 'secret',
    s3BucketTmpPattern: '',
  });
  assert.equal(resolved.permanent, 'collab-102047');
  assert.equal(resolved.tmp, null);
});
