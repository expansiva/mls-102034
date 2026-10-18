/// <mls fileReference="_102034_/l1/scripts/resetLocalDb.ts" enhancement="_blank" />
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import {
  hasDeclaredProjectMode, isTestMode, parseDatabaseUrl, readProjectMode,
} from '/_102034_/l1/server/layer_1_external/config/projectMode.js';
import { initializeOrganizationForProcess } from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';
import { bootstrapSchema, type SchemaBootstrapResult } from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';
import { formatMigrationReport } from '/_102034_/l1/server/layer_1_external/persistence/schemaModulePlan.js';

const TEST_DATABASE = 'collab_app_test';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export interface ResetLocalDbOptions {
  env?: AppEnv;
  /** Process values under test. Defaults to `process.env` when omitted. */
  databaseUrlTest?: string;
  databaseUrl?: string;
  collabProjectId?: string;
  projectIdEnv?: string;
  bootstrap?: typeof bootstrapSchema;
  initializeOrganization?: () => Promise<void>;
  readMode?: typeof readProjectMode;
  hasDeclared?: typeof hasDeclaredProjectMode;
}

function refuse(reason: string): never {
  throw new Error(`[resetLocalDb] refused before schema write: ${reason}`);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function sameProductiveTarget(testUrl: string, productiveUrl: string, testDatabase: string): boolean {
  if (testUrl === productiveUrl) return true;
  const productive = parseDatabaseUrl(productiveUrl);
  return productive?.database === testDatabase;
}

/** Guards run before bootstrap. Invalid targets never reach DDL. */
export function assertResetTarget(input: {
  env: AppEnv;
  databaseUrlTest: string | undefined;
  databaseUrl: string | undefined;
  collabProjectId: string | undefined;
  projectIdEnv: string | undefined;
  mode: ReturnType<typeof readProjectMode>;
  declared: boolean;
}): { database: string } {
  if (input.env.runtimeMode === 'memory') {
    refuse('RUNTIME_MODE=memory');
  }
  const projectId = input.env.projectId;
  if (!projectId || !input.collabProjectId) {
    refuse('project id is missing');
  }
  if (projectId !== input.collabProjectId || (input.projectIdEnv !== undefined && input.projectIdEnv !== input.collabProjectId)) {
    refuse('project id diverges from config');
  }
  if (!input.declared || !isTestMode(input.mode)) {
    refuse(`appEnv is not a declared test mode (declared=${input.declared}, appEnv='${input.mode}')`);
  }
  const testUrl = input.databaseUrlTest;
  if (!testUrl) {
    refuse('DATABASE_URL_TEST is not set');
  }
  const parsed = parseDatabaseUrl(testUrl);
  if (!parsed) {
    refuse('DATABASE_URL_TEST is not a database url');
  }
  if (parsed.database !== TEST_DATABASE) {
    refuse(`database is '${parsed.database}', expected ${TEST_DATABASE}`);
  }
  const host = hostOf(testUrl);
  if (!host || !LOCAL_HOSTS.has(host)) {
    refuse('DATABASE_URL_TEST is not a local host');
  }
  if (input.databaseUrl && sameProductiveTarget(testUrl, input.databaseUrl, parsed.database)) {
    refuse('DATABASE_URL_TEST matches the productive database');
  }
  return { database: parsed.database };
}

export async function resetLocalDb(options: ResetLocalDbOptions = {}): Promise<SchemaBootstrapResult> {
  const env = options.env ?? readAppEnv();
  const databaseUrlTest = options.env ? options.databaseUrlTest : (options.databaseUrlTest ?? process.env.DATABASE_URL_TEST);
  const databaseUrl = options.env ? options.databaseUrl : (options.databaseUrl ?? process.env.DATABASE_URL);
  const collabProjectId = options.env ? options.collabProjectId : (options.collabProjectId ?? process.env.COLLAB_PROJECT_ID);
  const projectIdEnv = options.env ? options.projectIdEnv : (options.projectIdEnv ?? process.env.PROJECT_ID);
  const readMode = options.readMode ?? readProjectMode;
  const hasDeclared = options.hasDeclared ?? hasDeclaredProjectMode;
  const target = assertResetTarget({
    env,
    databaseUrlTest,
    databaseUrl,
    collabProjectId,
    projectIdEnv,
    mode: readMode(env.projectId),
    declared: hasDeclared(env.projectId),
  });
  const bootstrap = options.bootstrap ?? bootstrapSchema;
  const result = await bootstrap(env, {
    ensureDynamo: false,
    recordSnapshotLog: false,
    forceRebuild: true,
  });
  const initializeOrganization = options.initializeOrganization ?? initializeOrganizationForProcess;
  await initializeOrganization();
  console.info(`[resetLocalDb] projeto ${env.projectId}, banco ${target.database}, mode=${result.report.mode}`);
  console.info(formatMigrationReport(result.report));
  return result;
}

const isMainModule = process.argv[1]?.endsWith('/resetLocalDb.js');

if (isMainModule) {
  resetLocalDb()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
