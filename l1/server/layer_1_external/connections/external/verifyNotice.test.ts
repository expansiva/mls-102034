/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/verifyNotice.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import type { ExternalVerify, ExternalVerifyHmac } from '/_102034_/l2/shared/contracts/connections/externalSystem.js';
import { verifyExternalNotice, type ExternalNotice } from '/_102034_/l1/server/layer_1_external/connections/external/verifyNotice.js';

const SECRET = 'notice-secret';
const BODY = Buffer.from('{"id":"n1"}', 'utf8');
const WHEN = new Date('2026-11-19T12:00:00.000Z');

function notice(headers: Record<string, string>, rawBody: Buffer = BODY): ExternalNotice {
  return { rawBody, headers, receivedAt: WHEN };
}

function mac(algorithm: 'sha256' | 'sha512', message: Buffer, encoding: 'hex' | 'base64'): string {
  return createHmac(algorithm, SECRET).update(message).digest(encoding);
}

function hmac(patch: Partial<ExternalVerifyHmac> = {}): ExternalVerifyHmac {
  return {
    scheme: 'hmac',
    algorithm: 'sha256',
    secret: 'webhookSecret',
    signature: { header: 'X-Signature', encoding: 'hex' },
    signed: ['body'],
    ...patch,
  };
}

describe('verifyExternalNotice hmac', () => {
  it('accepts sha256 hex of the raw body', () => {
    const signature = mac('sha256', BODY, 'hex');
    const result = verifyExternalNotice(hmac(), notice({ 'X-Signature': signature }), SECRET);
    assert.deepEqual(result, { ok: true });
  });

  it('accepts sha256 base64 of the raw body', () => {
    const signature = mac('sha256', BODY, 'base64');
    const verify = hmac({ signature: { header: 'X-Signature', encoding: 'base64' } });
    assert.deepEqual(verifyExternalNotice(verify, notice({ 'X-Signature': signature }), SECRET), { ok: true });
  });

  it('signs timestamp and body with a separator and a prefix', () => {
    const stamped = String(Math.floor(WHEN.getTime() / 1000));
    const message = Buffer.concat([Buffer.from(stamped, 'utf8'), Buffer.from('.', 'utf8'), BODY]);
    const signature = `v1=${mac('sha256', message, 'hex')}`;
    const verify = hmac({
      signature: { header: 'X-Signature', prefix: 'v1=', encoding: 'hex' },
      signed: [{ header: 'X-Timestamp' }, 'body'],
      separator: '.',
      timestamp: { header: 'X-Timestamp', toleranceSeconds: 300 },
    });
    const result = verifyExternalNotice(verify, notice({ 'X-Timestamp': stamped, 'X-Signature': signature }), SECRET);
    assert.deepEqual(result, { ok: true });
  });

  it('refuses a body changed by one byte', () => {
    const signature = mac('sha256', BODY, 'hex');
    const flipped = Buffer.from(BODY);
    flipped[0] = flipped[0] ^ 0x01;
    const result = verifyExternalNotice(hmac(), notice({ 'X-Signature': signature }, flipped), SECRET);
    assert.deepEqual(result, { ok: false, reason: 'signature' });
  });

  it('refuses a timestamp outside the tolerance', () => {
    const stamped = String(Math.floor(WHEN.getTime() / 1000) - 301);
    const message = Buffer.concat([Buffer.from(stamped, 'utf8'), BODY]);
    const signature = mac('sha256', message, 'hex');
    const verify = hmac({
      signed: [{ header: 'X-Timestamp' }, 'body'],
      timestamp: { header: 'X-Timestamp', toleranceSeconds: 300 },
    });
    const result = verifyExternalNotice(verify, notice({ 'X-Timestamp': stamped, 'X-Signature': signature }), SECRET);
    assert.deepEqual(result, { ok: false, reason: 'timestamp' });
  });

  it('reports a missing signature header', () => {
    const result = verifyExternalNotice(hmac(), notice({}), SECRET);
    assert.deepEqual(result, { ok: false, reason: 'missing' });
  });
});

describe('verifyExternalNotice token', () => {
  const verify: ExternalVerify = { scheme: 'token', secret: 'hookToken', header: 'Authorization', prefix: 'Bearer ' };

  it('accepts the secret after the prefix', () => {
    const result = verifyExternalNotice(verify, notice({ Authorization: `Bearer ${SECRET}` }), SECRET);
    assert.deepEqual(result, { ok: true });
  });

  it('refuses a different token', () => {
    const result = verifyExternalNotice(verify, notice({ Authorization: 'Bearer other' }), SECRET);
    assert.deepEqual(result, { ok: false, reason: 'signature' });
  });

  it('reports a missing header', () => {
    const result = verifyExternalNotice(verify, notice({}), SECRET);
    assert.deepEqual(result, { ok: false, reason: 'missing' });
  });
});

describe('verifyExternalNotice with an empty secret', () => {
  it('never accepts, even when the notice was signed with an empty key or carries an empty token', () => {
    const emptySigned = createHmac('sha256', '').update(BODY).digest('hex');
    assert.deepEqual(verifyExternalNotice(hmac(), notice({ 'X-Signature': emptySigned }), ''), { ok: false, reason: 'signature' });
    const token: ExternalVerify = { scheme: 'token', secret: 'webhookSecret', header: 'X-Token' };
    assert.deepEqual(verifyExternalNotice(token, notice({ 'X-Token': '' }), ''), { ok: false, reason: 'signature' });
  });
});
