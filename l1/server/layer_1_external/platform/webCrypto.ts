/// <mls fileReference="_102034_/l1/server/layer_1_external/platform/webCrypto.ts" enhancement="_blank" />
function getCrypto() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi) {
    throw new Error('Web Crypto API is not available in this runtime');
  }
  return cryptoApi;
}

export function createRuntimeUuid(): string {
  return getCrypto().randomUUID();
}

export function fillRandomBytes(bytes: Uint8Array): Uint8Array {
  getCrypto().getRandomValues(bytes);
  return bytes;
}

export async function sha256Hex(input: string): Promise<string> {
  const source = new TextEncoder().encode(input);
  const digest = await getCrypto().subtle.digest('SHA-256', source);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}
