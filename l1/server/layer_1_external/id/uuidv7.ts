/// <mls fileReference="_102034_/l1/server/layer_1_external/id/uuidv7.ts" enhancement="_blank" />
import { fillRandomBytes } from '/_102034_/l1/server/layer_1_external/platform/webCrypto.js';

export function createUuidV7(): string {
  const unixMillis = BigInt(Date.now());
  const random = fillRandomBytes(new Uint8Array(10));

  const bytes = new Uint8Array(16);
  bytes[0] = Number((unixMillis >> 40n) & 0xffn);
  bytes[1] = Number((unixMillis >> 32n) & 0xffn);
  bytes[2] = Number((unixMillis >> 24n) & 0xffn);
  bytes[3] = Number((unixMillis >> 16n) & 0xffn);
  bytes[4] = Number((unixMillis >> 8n) & 0xffn);
  bytes[5] = Number(unixMillis & 0xffn);
  bytes[6] = 0x70 | (random[0] & 0x0f);
  bytes[7] = random[1];
  bytes[8] = 0x80 | (random[2] & 0x3f);
  bytes[9] = random[3];
  bytes[10] = random[4];
  bytes[11] = random[5];
  bytes[12] = random[6];
  bytes[13] = random[7];
  bytes[14] = random[8];
  bytes[15] = random[9];

  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
