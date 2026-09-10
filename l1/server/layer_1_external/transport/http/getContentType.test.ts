/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/getContentType.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { getContentType, handleHttpRequest } from '/_102034_/l1/server/layer_1_external/transport/http/startServer.js';
import { resolveWebDistPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';

test('T4: getContentType covers audio, image and font assets', () => {
  assert.equal(getContentType('.wav'), 'audio/wav');
  assert.equal(getContentType('collabNotification.wav'), 'audio/wav');
  assert.equal(getContentType('.mp3'), 'audio/mpeg');
  assert.equal(getContentType('.ogg'), 'audio/ogg');
  assert.equal(getContentType('.png'), 'image/png');
  assert.equal(getContentType('.jpg'), 'image/jpeg');
  assert.equal(getContentType('.jpeg'), 'image/jpeg');
  assert.equal(getContentType('.webp'), 'image/webp');
  assert.equal(getContentType('.gif'), 'image/gif');
  assert.equal(getContentType('.ico'), 'image/x-icon');
  assert.equal(getContentType('.woff2'), 'font/woff2');
});

test('E4: GET /_102025_/l3/assets/collabNotification.wav is 200 audio/wav 13934 when dist has the file', async (t) => {
  const filePath = resolveWebDistPath('./_102025_/l3/assets/collabNotification.wav');
  if (!existsSync(filePath)) {
    t.skip('dist/web does not contain the wav (build not run in this workspace)');
    return;
  }
  const result = await handleHttpRequest('GET', '/_102025_/l3/assets/collabNotification.wav');
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers?.['content-type'], 'audio/wav');
  assert.equal(Buffer.isBuffer(result.body) ? result.body.length : 0, 13934);
});

test('T2 via HTTP: GET /_102025_/l3/../../etc/passwd does not escape', async () => {
  const result = await handleHttpRequest('GET', '/_102025_/l3/../../etc/passwd');
  assert.notEqual(result.statusCode, 200);
  const body = result.body;
  if (Buffer.isBuffer(body)) {
    assert.notEqual(body.subarray(0, 4).toString(), 'RIFF');
  }
});
