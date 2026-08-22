/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/attachmentUpload.ts" enhancement="_blank" />

import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import {
  resolveObjectBuckets, type ObjectBucketResolution,
} from '/_102034_/l1/server/layer_1_external/storage/objectBuckets.js';
import {
  assertPermanentAttachmentKey, buildPermanentAttachmentKey,
} from '/_102034_/l1/server/layer_1_external/storage/attachmentKey.js';
import {
  decodeAttachmentBase64, validateAttachmentPayload, type AttachmentLimits,
} from '/_102034_/l1/server/layer_1_external/storage/attachmentLimits.js';
import {
  LocalDiskObjectStore, MemoryObjectStore, localAttachmentRoot, type ObjectStore,
} from '/_102034_/l1/server/layer_1_external/storage/objectStore.js';
import { PRESIGNED_GET_EXPIRES_SECONDS, S3ObjectStore } from '/_102034_/l1/server/layer_1_external/storage/s3ObjectStore.js';
import { attachFile } from '/_102034_/l1/mdm/layer_3_usecases/attachmentUsecases.js';
import type { MdmAttachmentRecord } from '/_102034_/l1/mdm/module.js';

export interface UploadAttachmentInput {
  entityType: string;
  entityId: string;
  fileName: string;
  mimeType: string;
  category?: string | null;
  base64: string;
  details?: Record<string, unknown> | null;
}

export interface UploadAttachmentResult {
  record: MdmAttachmentRecord;
  bucket: string;
  /** Why S3 was not used. Empty when provider is s3. */
  localReason: string;
}

export interface AttachmentReadUrl {
  id: string;
  url: string;
  expiresIn: number;
  storageKey: string;
  storageProvider: 's3' | 'local';
}

export interface AttachmentStorageDeps {
  store?: ObjectStore;
  buckets?: ObjectBucketResolution;
  limits?: AttachmentLimits;
}

let sharedStore: ObjectStore | undefined;

export function resetAttachmentStorage(): void {
  sharedStore = undefined;
}

export function resolveAttachmentBucketsFromEnv(): ObjectBucketResolution {
  const env = readAppEnv();
  return resolveObjectBuckets({
    s3BucketPattern: env.s3BucketPattern,
    s3BucketTmpPattern: env.s3BucketTmpPattern,
    awsAccessKeyId: env.awsAccessKeyId,
    awsSecretAccessKey: env.awsSecretAccessKey,
    projectId: env.projectId,
  });
}

export function createAttachmentObjectStore(buckets = resolveAttachmentBucketsFromEnv()): ObjectStore {
  if (buckets.provider === 's3') {
    const env = readAppEnv();
    if (!env.awsAccessKeyId || !env.awsSecretAccessKey) {
      throw new AppError('CONFIG_ERROR', buckets.localReason || 'AWS credentials missing', 500);
    }
    return new S3ObjectStore({
      region: env.awsRegion,
      accessKeyId: env.awsAccessKeyId,
      secretAccessKey: env.awsSecretAccessKey,
      sessionToken: env.awsSessionToken,
    });
  }
  return new LocalDiskObjectStore(localAttachmentRoot(readAppEnv().attachmentLocalDir));
}

function storeFor(deps: AttachmentStorageDeps): { store: ObjectStore; buckets: ObjectBucketResolution } {
  const buckets = deps.buckets ?? resolveAttachmentBucketsFromEnv();
  if (deps.store) return { store: deps.store, buckets };
  if (!sharedStore) sharedStore = createAttachmentObjectStore(buckets);
  return { store: sharedStore, buckets };
}

function projectIdOf(ctx: RequestContext, buckets: ObjectBucketResolution): string {
  return (ctx.sessionContext.project.projectId || buckets.projectId || '').trim();
}

export async function uploadAttachment(
  ctx: RequestContext,
  input: UploadAttachmentInput,
  deps: AttachmentStorageDeps = {},
): Promise<UploadAttachmentResult> {
  const { store, buckets } = storeFor(deps);
  const env = readAppEnv();
  const limits = deps.limits ?? { maxBytes: env.attachmentMaxBytes, allowedMime: env.attachmentAllowedMime };
  const body = decodeAttachmentBase64(input.base64);
  validateAttachmentPayload({ mimeType: input.mimeType, sizeBytes: body.length, limits });
  const projectId = projectIdOf(ctx, buckets);
  if (!projectId) {
    throw new AppError('VALIDATION_ERROR', 'projectId is required to store an attachment (one bucket per project)', 400);
  }
  const attachmentId = ctx.idGenerator.newId();
  const storageKey = buildPermanentAttachmentKey({
    projectId,
    entityType: input.entityType,
    entityId: input.entityId,
    attachmentId,
    fileName: input.fileName,
  });
  await store.put({
    bucket: buckets.permanent,
    key: storageKey,
    body,
    contentType: input.mimeType.trim().toLowerCase(),
    metadata: { entityType: input.entityType, entityId: input.entityId, projectId },
  });
  const record = await attachFile(ctx, {
    entityType: input.entityType,
    entityId: input.entityId,
    fileName: input.fileName,
    mimeType: input.mimeType.trim().toLowerCase(),
    sizeBytes: body.length,
    storageKey,
    storageProvider: store.provider,
    category: input.category ?? null,
    details: input.details ?? null,
  });
  return { record, bucket: buckets.permanent, localReason: buckets.localReason };
}

export async function getAttachmentReadUrl(
  ctx: RequestContext,
  id: string,
  deps: AttachmentStorageDeps = {},
): Promise<AttachmentReadUrl> {
  const { store, buckets } = storeFor(deps);
  const record = await ctx.data.mdmAttachment.findOne({ where: { id } });
  if (!record || record.deletedAt) {
    throw new AppError('NOT_FOUND', 'Attachment not found', 404, { id });
  }
  assertPermanentAttachmentKey(record.storageKey);
  const expiresIn = PRESIGNED_GET_EXPIRES_SECONDS;
  const url = store.provider === 's3'
    ? await store.getPresignedGetUrl({ bucket: buckets.permanent, key: record.storageKey, expiresIn })
    : `/attachments/${record.id}/file`;
  return {
    id: record.id,
    url,
    expiresIn,
    storageKey: record.storageKey,
    storageProvider: record.storageProvider,
  };
}

export async function readLocalAttachmentBytes(
  ctx: RequestContext,
  id: string,
  deps: AttachmentStorageDeps = {},
): Promise<{ body: Buffer; contentType: string; fileName: string }> {
  const { store, buckets } = storeFor(deps);
  const record = await ctx.data.mdmAttachment.findOne({ where: { id } });
  if (!record || record.deletedAt) {
    throw new AppError('NOT_FOUND', 'Attachment not found', 404, { id });
  }
  if (!store.readLocal) {
    throw new AppError('VALIDATION_ERROR', 'S3 attachments are read through the signed URL, not this route', 400);
  }
  const body = await store.readLocal({ bucket: buckets.permanent, key: record.storageKey });
  return { body, contentType: record.mimeType, fileName: record.fileName };
}

export { MemoryObjectStore };
