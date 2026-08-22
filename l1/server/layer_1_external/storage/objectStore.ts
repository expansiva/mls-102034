/// <mls fileReference="_102034_/l1/server/layer_1_external/storage/objectStore.ts" enhancement="_blank" />

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ObjectStorageProvider } from '/_102034_/l1/server/layer_1_external/storage/objectBuckets.js';

export interface ObjectPutInput {
  bucket: string;
  key: string;
  body: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface ObjectStore {
  readonly provider: ObjectStorageProvider;
  put(input: ObjectPutInput): Promise<void>;
  delete(input: { bucket: string; key: string }): Promise<void>;
  getPresignedGetUrl(input: { bucket: string; key: string; expiresIn: number }): Promise<string>;
  /** Local provider only: read the bytes back. S3 reads go through the signed URL. */
  readLocal?(input: { bucket: string; key: string }): Promise<Buffer>;
}

export class MemoryObjectStore implements ObjectStore {
  public readonly provider: ObjectStorageProvider = 'local';
  public readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  public put(input: ObjectPutInput): Promise<void> {
    this.objects.set(`${input.bucket}/${input.key}`, { body: input.body, contentType: input.contentType });
    return Promise.resolve();
  }

  public delete(input: { bucket: string; key: string }): Promise<void> {
    this.objects.delete(`${input.bucket}/${input.key}`);
    return Promise.resolve();
  }

  public getPresignedGetUrl(input: { bucket: string; key: string; expiresIn: number }): Promise<string> {
    return Promise.resolve(`memory://${input.bucket}/${input.key}?expires=${input.expiresIn}`);
  }

  public readLocal(input: { bucket: string; key: string }): Promise<Buffer> {
    const found = this.objects.get(`${input.bucket}/${input.key}`);
    if (!found) return Promise.reject(new Error(`memory object missing: ${input.bucket}/${input.key}`));
    return Promise.resolve(found.body);
  }
}

export class LocalDiskObjectStore implements ObjectStore {
  public readonly provider: ObjectStorageProvider = 'local';

  public constructor(private readonly rootDir: string) {}

  public async put(input: ObjectPutInput): Promise<void> {
    const filePath = this.pathOf(input.bucket, input.key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, input.body);
  }

  public async delete(input: { bucket: string; key: string }): Promise<void> {
    await rm(this.pathOf(input.bucket, input.key), { force: true });
  }

  public getPresignedGetUrl(input: { bucket: string; key: string; expiresIn: number }): Promise<string> {
    void input.expiresIn;
    return Promise.resolve(`/attachments/file?bucket=${encodeURIComponent(input.bucket)}&key=${encodeURIComponent(input.key)}`);
  }

  public async readLocal(input: { bucket: string; key: string }): Promise<Buffer> {
    return readFile(this.pathOf(input.bucket, input.key));
  }

  private pathOf(bucket: string, key: string): string {
    return resolve(this.rootDir, bucket, ...key.split('/').filter(Boolean));
  }
}

export function localAttachmentRoot(override?: string): string {
  return override && override.trim() ? override.trim() : join(process.cwd(), 'data', 'attachments');
}
