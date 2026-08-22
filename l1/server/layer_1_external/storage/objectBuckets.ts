/// <mls fileReference="_102034_/l1/server/layer_1_external/storage/objectBuckets.ts" enhancement="_blank" />

/**
 * Object-storage buckets of a published app.
 *
 * One PERMANENT bucket per client project, named with the project id (default `collab-{projectId}`).
 * Business attachments (a pet photo, a signed PDF) live there and nowhere else — a lifecycle rule
 * that expires objects would leave `mdm_attachment` pointing at a dead key.
 *
 * A second, OPTIONAL tmp bucket (default `collab-{projectId}-tmp`) exists for ephemeral artifacts
 * (LLM images that may vanish). MDM attachments never use it. Empty `S3_BUCKET_TMP` disables it.
 *
 * Without AWS credentials, without a resolvable project id, or with `S3_BUCKET` explicitly empty,
 * the runtime falls back to local disk. The reason is always named — never a generic S3 crash.
 */

export type ObjectBucketKind = 'permanent' | 'tmp';
export type ObjectStorageProvider = 's3' | 'local';

export const DEFAULT_PERMANENT_BUCKET_PATTERN = 'collab-{projectId}';
export const DEFAULT_TMP_BUCKET_PATTERN = 'collab-{projectId}-tmp';

export interface ObjectBucketResolution {
  provider: ObjectStorageProvider;
  projectId: string;
  /** Permanent bucket name (S3) or directory leaf (local). Always set. */
  permanent: string;
  /** Tmp bucket name, or null when the operator disabled it. MDM attach never reads this. */
  tmp: string | null;
  /** Why we are on `local`, empty when S3 is ready. */
  localReason: string;
}

export interface ObjectBucketEnv {
  s3BucketPattern?: string | null;
  s3BucketTmpPattern?: string | null;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  projectId?: string;
}

export function applyProjectId(pattern: string, projectId: string): string {
  if (!pattern.includes('{projectId}')) return pattern;
  if (!projectId.trim()) return '';
  return pattern.split('{projectId}').join(projectId.trim());
}

export function resolveObjectBuckets(env: ObjectBucketEnv): ObjectBucketResolution {
  const projectId = (env.projectId ?? '').trim();
  const permanentPattern = env.s3BucketPattern === undefined || env.s3BucketPattern === null
    ? DEFAULT_PERMANENT_BUCKET_PATTERN
    : env.s3BucketPattern.trim();
  const tmpPattern = env.s3BucketTmpPattern === undefined || env.s3BucketTmpPattern === null
    ? DEFAULT_TMP_BUCKET_PATTERN
    : env.s3BucketTmpPattern.trim();

  const permanent = applyProjectId(permanentPattern, projectId);
  const tmp = tmpPattern ? applyProjectId(tmpPattern, projectId) || null : null;

  if (!permanentPattern) {
    return {
      provider: 'local',
      projectId,
      permanent: localPermanentLeaf(projectId),
      tmp: tmp ? localTmpLeaf(projectId) : null,
      localReason: 'S3_BUCKET is empty — object storage is local disk (storageProvider=local)',
    };
  }
  if (permanentPattern.includes('{projectId}') && !projectId) {
    return {
      provider: 'local',
      projectId,
      permanent: localPermanentLeaf(projectId),
      tmp: tmp ? localTmpLeaf(projectId) : null,
      localReason: `PROJECT_ID is missing; cannot resolve per-project bucket '${permanentPattern}'`,
    };
  }
  if (!env.awsAccessKeyId || !env.awsSecretAccessKey) {
    return {
      provider: 'local',
      projectId,
      permanent: localPermanentLeaf(projectId),
      tmp: tmp ? localTmpLeaf(projectId) : null,
      localReason: 'AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY missing — object storage is local disk (storageProvider=local)',
    };
  }
  return {
    provider: 's3',
    projectId,
    permanent,
    tmp: tmp || null,
    localReason: '',
  };
}

export function bucketFor(kind: ObjectBucketKind, resolution: ObjectBucketResolution): string | null {
  return kind === 'tmp' ? resolution.tmp : resolution.permanent;
}

function localPermanentLeaf(projectId: string): string {
  return projectId ? `local-${projectId}` : 'local-unknown';
}

function localTmpLeaf(projectId: string): string {
  return projectId ? `local-${projectId}-tmp` : 'local-unknown-tmp';
}
