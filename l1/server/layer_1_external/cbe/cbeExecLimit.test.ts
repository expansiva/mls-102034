/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeExecLimit.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { EXEC_BODY_LIMIT, EXEC_BODY_TOO_LARGE_MSG } from '/_102034_/l1/server/layer_1_external/cbe/cbeExecLimit.js';
import { registerCbeRoutes } from '/_102034_/l1/server/layer_1_external/cbe/cbeRoutes.js';

const MB = 1024 * 1024;

function body(bytes: number): string {
  return JSON.stringify({ action: 'setContents', payload: 'x'.repeat(bytes) });
}

async function post(payload: string): Promise<{ statusCode: number; json: () => Record<string, unknown> }> {
  const app = Fastify();
  registerCbeRoutes(app);
  try {
    return await app.inject({ method: 'POST', url: '/exec', headers: { 'content-type': 'application/json' }, payload });
  } finally {
    await app.close();
  }
}

test('/exec limit is 4 MB', () => {
  assert.equal(EXEC_BODY_LIMIT, 4 * MB);
});

test('/exec takes a ~3 MB body (it was 413 over 1 MB) and answers 413 with the reason over 4 MB', async () => {
  const small = await post(body(3 * MB));
  assert.notEqual(small.statusCode, 413);
  const big = await post(body(5 * MB));
  assert.equal(big.statusCode, 413);
  assert.deepEqual(big.json(), { statusCode: 413, status: 'error', msg: EXEC_BODY_TOO_LARGE_MSG });
});

test('/exec keeps its other errors: invalid JSON is still 400, not 413', async () => {
  const res = await post('{"action":');
  assert.equal(res.statusCode, 400);
});
