/// <mls fileReference="_102034_/l1/server/layer_1_external/storage/s3ObjectStore.ts" enhancement="_blank" />

/**
 * Runtime S3 helper, shaped like collab-messages `CollabS3` (upload Buffer, delete, presigned GET).
 * Copied as form, not imported. Presigned PUT is absent — this wave accepts base64 on a dedicated
 * route, not a browser→S3 upload.
 *
 * Signed with AWS Signature V4 over `fetch` so the runtime does not take a new SDK dependency
 * (the workspace already has DynamoDB's client; S3 npm install failed on this machine).
 */
import { createHash, createHmac } from 'node:crypto';
import type { ObjectPutInput, ObjectStore } from '/_102034_/l1/server/layer_1_external/storage/objectStore.js';

export interface S3ObjectStoreConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export const PRESIGNED_GET_EXPIRES_SECONDS = 3600;

export class S3ObjectStore implements ObjectStore {
  public readonly provider = 's3' as const;

  public constructor(private readonly config: S3ObjectStoreConfig) {}

  public async put(input: ObjectPutInput): Promise<void> {
    const payloadHash = sha256Hex(input.body);
    const { url, headers } = this.sign({
      method: 'PUT',
      bucket: input.bucket,
      key: input.key,
      payloadHash,
      extraHeaders: {
        'content-type': input.contentType,
        'content-length': String(input.body.length),
      },
    });
    const response = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(input.body) });
    if (!response.ok) {
      throw new Error(`[aws s3] PUT ${response.status} ${await response.text()}`);
    }
  }

  public async delete(input: { bucket: string; key: string }): Promise<void> {
    const { url, headers } = this.sign({
      method: 'DELETE',
      bucket: input.bucket,
      key: input.key,
      payloadHash: EMPTY_SHA256,
    });
    const response = await fetch(url, { method: 'DELETE', headers });
    if (!response.ok && response.status !== 404) {
      throw new Error(`[aws s3] DELETE ${response.status} ${await response.text()}`);
    }
  }

  public getPresignedGetUrl(input: { bucket: string; key: string; expiresIn: number }): Promise<string> {
    return Promise.resolve(this.presignGet(input.bucket, input.key, input.expiresIn));
  }

  private host(bucket: string): string {
    const region = this.config.region || 'us-east-1';
    return region === 'us-east-1' ? `${bucket}.s3.amazonaws.com` : `${bucket}.s3.${region}.amazonaws.com`;
  }

  private sign(input: {
    method: string;
    bucket: string;
    key: string;
    payloadHash: string;
    extraHeaders?: Record<string, string>;
  }): { url: string; headers: Record<string, string> } {
    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const host = this.host(input.bucket);
    const canonicalUri = encodeS3Path(input.key);
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': input.payloadHash,
      'x-amz-date': amzDate,
      ...(input.extraHeaders ?? {}),
    };
    if (this.config.sessionToken) headers['x-amz-security-token'] = this.config.sessionToken;
    const signedHeaderNames = Object.keys(headers).map(name => name.toLowerCase()).sort();
    const canonicalHeaders = signedHeaderNames.map(name => `${name}:${headers[name].trim()}\n`).join('');
    const signedHeaders = signedHeaderNames.join(';');
    const canonicalRequest = [
      input.method, canonicalUri, '', canonicalHeaders, signedHeaders, input.payloadHash,
    ].join('\n');
    const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest),
    ].join('\n');
    const signature = hmacHex(signingKey(this.config.secretAccessKey, dateStamp, this.config.region), stringToSign);
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return { url: `https://${host}${canonicalUri}`, headers };
  }

  private presignGet(bucket: string, key: string, expiresIn: number): string {
    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const host = this.host(bucket);
    const canonicalUri = encodeS3Path(key);
    const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const credential = `${this.config.accessKeyId}/${credentialScope}`;
    const query: Array<[string, string]> = [
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', credential],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', String(expiresIn)],
      ['X-Amz-SignedHeaders', 'host'],
    ];
    if (this.config.sessionToken) query.push(['X-Amz-Security-Token', this.config.sessionToken]);
    query.sort(([left], [right]) => left.localeCompare(right));
    const canonicalQuery = query.map(([name, value]) => `${uriEncode(name)}=${uriEncode(value)}`).join('&');
    const canonicalRequest = [
      'GET', canonicalUri, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest),
    ].join('\n');
    const signature = hmacHex(signingKey(this.config.secretAccessKey, dateStamp, this.config.region), stringToSign);
    return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }
}

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/gu, '').replace(/\.\d+Z$/u, 'Z');
}

function encodeS3Path(key: string): string {
  return `/${key.split('/').filter(Boolean).map(uriEncode).join('/')}`;
}

function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function hmacHex(key: Buffer, value: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), 's3'), 'aws4_request');
}
