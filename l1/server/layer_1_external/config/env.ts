/// <mls fileReference="_102034_/l1/server/layer_1_external/config/env.ts" enhancement="_blank" />
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getStorageConfig } from '/_102034_/l1/server/layer_1_external/config/storageConfig.js';
import {
  DEFAULT_ATTACHMENT_MAX_BYTES, parseAllowedMime,
} from '/_102034_/l1/server/layer_1_external/storage/attachmentLimits.js';
import {
  DEFAULT_PERMANENT_BUCKET_PATTERN, DEFAULT_TMP_BUCKET_PATTERN,
} from '/_102034_/l1/server/layer_1_external/storage/objectBuckets.js';

export interface AppEnv {
  appEnv: 'development' | 'staging' | 'production';
  port: number;
  pgHost: string;
  pgPort: number;
  pgDatabase: string;
  pgUser: string;
  pgPassword: string;
  dynamoTableMdm: string;
  dynamoTableMdmRelationship: string;
  dynamoTableMdmProspectRelationship: string;
  dynamoTableMdmAuditLog: string;
  dynamoTableMdmTag: string;
  dynamoTableMdmComment: string;
  dynamoTableMdmAttachment: string;
  dynamoTableMdmNumberSequence: string;
  awsRegion: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsSessionToken?: string;
  writeBehindEnabled: boolean;
  logLevel: string;
  runtimeMode: 'memory' | 'postgres';
  testsEnabled: boolean;
  projectId?: string;
  projectDomain?: string;
  studioEnabled: boolean;
  activeCompanyId?: string;
  activeUnitId?: string;
  currentWorkspaceId?: string;
  actorId?: string;
  actorScope: string[];
  /**
   * Permanent object-storage bucket pattern. `{projectId}` is replaced with the client project
   * (default `collab-{projectId}`). Empty string forces local disk.
   */
  s3BucketPattern: string;
  /** Optional tmp bucket pattern (default `collab-{projectId}-tmp`). Empty disables it. MDM never uses it. */
  s3BucketTmpPattern: string;
  attachmentMaxBytes: number;
  attachmentAllowedMime: string[];
  attachmentLocalDir?: string;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  return value === 'true';
}

function parseStringList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function readEnvValue(
  key: string,
  appEnv: 'development' | 'staging' | 'production',
): string | undefined {
  const suffix = appEnv.toUpperCase();
  return process.env[`${key}_${suffix}`] ?? process.env[key];
}

let envLoaded = false;

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith('\'') && value.endsWith('\''))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function loadEnvFile(): void {
  if (envLoaded) {
    return;
  }

  envLoaded = true;
  const candidatePaths = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '_102034_', 'l1', '.env'),
    resolve(process.cwd(), 'projects', '_102034_', 'l1', '.env'),
  ];

  for (const envPath of candidatePaths) {
    if (!existsSync(envPath)) {
      continue;
    }

    const content = readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const separatorIndex = line.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = stripWrappingQuotes(line.slice(separatorIndex + 1).trim());
      if (!key || process.env[key] !== undefined) {
        continue;
      }

      process.env[key] = value;
    }

    return;
  }
}

export function readAppEnv(): AppEnv {
  loadEnvFile();
  const appEnv =
    (process.env.APP_ENV as 'development' | 'staging' | 'production' | undefined) ??
    'development';
  const storage = getStorageConfig(appEnv);
  const defaultRuntimeMode = appEnv === 'development' ? 'memory' : 'postgres';
  const runtimeMode =
    (readEnvValue('RUNTIME_MODE', appEnv) as 'memory' | 'postgres' | undefined) ?? defaultRuntimeMode;
  const writeBehindEnabled = parseBoolean(
    readEnvValue('WRITE_BEHIND_ENABLED', appEnv),
    appEnv !== 'development',
  );

  if (appEnv !== 'development' && runtimeMode === 'memory') {
    throw new Error(`APP_ENV=${appEnv} cannot run with RUNTIME_MODE=memory`);
  }

  return {
    appEnv,
    port: Number(readEnvValue('PORT', appEnv) ?? 3000),
    pgHost: readEnvValue('PGHOST', appEnv) ?? '127.0.0.1',
    pgPort: Number(readEnvValue('PGPORT', appEnv) ?? 5432),
    pgDatabase: readEnvValue('PGDATABASE', appEnv) ?? (appEnv === 'staging' ? 'mdm_test' : 'mdm'),
    pgUser: readEnvValue('PGUSER', appEnv) ?? 'postgres',
    pgPassword: readEnvValue('PGPASSWORD', appEnv) ?? 'postgres',
    dynamoTableMdm: storage.dynamoTableMdm,
    dynamoTableMdmRelationship: storage.dynamoTableMdmRelationship,
    dynamoTableMdmProspectRelationship: storage.dynamoTableMdmProspectRelationship,
    dynamoTableMdmAuditLog: storage.dynamoTableMdmAuditLog,
    dynamoTableMdmTag: storage.dynamoTableMdmTag,
    dynamoTableMdmComment: storage.dynamoTableMdmComment,
    dynamoTableMdmAttachment: storage.dynamoTableMdmAttachment,
    dynamoTableMdmNumberSequence: storage.dynamoTableMdmNumberSequence,
    awsRegion: readEnvValue('AWS_REGION', appEnv) ?? 'us-east-1',
    awsAccessKeyId: readEnvValue('AWS_ACCESS_KEY_ID', appEnv) || undefined,
    awsSecretAccessKey: readEnvValue('AWS_SECRET_ACCESS_KEY', appEnv) || undefined,
    awsSessionToken: readEnvValue('AWS_SESSION_TOKEN', appEnv) || undefined,
    writeBehindEnabled,
    logLevel: readEnvValue('LOG_LEVEL', appEnv) ?? 'info',
    runtimeMode,
    // Opt-in gate for /monitor/tests execution. Outside development the runner uses a
    // disposable in-memory sandbox, so enabling it never touches the production data.
    testsEnabled: parseBoolean(readEnvValue('TESTS_ENABLED', appEnv), appEnv === 'development'),
    projectId: readEnvValue('PROJECT_ID', appEnv) || readEnvValue('COLLAB_PROJECT_ID', appEnv) || undefined,
    projectDomain: readEnvValue('PROJECT_DOMAIN', appEnv) || readEnvValue('DOMAIN', appEnv) || undefined,
    studioEnabled: parseBoolean(readEnvValue('STUDIO_ENABLED', appEnv), false),
    activeCompanyId: readEnvValue('ACTIVE_COMPANY_ID', appEnv) || undefined,
    activeUnitId: readEnvValue('ACTIVE_UNIT_ID', appEnv) || undefined,
    currentWorkspaceId: readEnvValue('CURRENT_WORKSPACE_ID', appEnv) || readEnvValue('WORKSPACE_ID', appEnv) || undefined,
    actorId: readEnvValue('ACTOR_ID', appEnv) || undefined,
    actorScope: parseStringList(readEnvValue('ACTOR_SCOPE', appEnv)),
    s3BucketPattern: readEnvValue('S3_BUCKET', appEnv) ?? DEFAULT_PERMANENT_BUCKET_PATTERN,
    s3BucketTmpPattern: readEnvValue('S3_BUCKET_TMP', appEnv) ?? DEFAULT_TMP_BUCKET_PATTERN,
    attachmentMaxBytes: Number(readEnvValue('ATTACHMENT_MAX_BYTES', appEnv) ?? DEFAULT_ATTACHMENT_MAX_BYTES),
    attachmentAllowedMime: parseAllowedMime(readEnvValue('ATTACHMENT_ALLOWED_MIME', appEnv)),
    attachmentLocalDir: readEnvValue('ATTACHMENT_LOCAL_DIR', appEnv) || undefined,
  };
}
