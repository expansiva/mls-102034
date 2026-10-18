/// <mls fileReference="_102034_/l1/scripts/seedLocalTest.ts" enhancement="_blank" />
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { readProjectsConfig } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { resolveOrganizationBinding } from '/_102034_/l1/server/layer_1_external/config/onboardingConfig.js';
import {
  hasDeclaredProjectMode,
  isTestMode,
  parseDatabaseUrl,
  readProjectMode,
  resolveDatabaseUrl,
  type ProjectMode,
} from '/_102034_/l1/server/layer_1_external/config/projectMode.js';
import { createDefaultRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { ensureLocalTestPair, type LocalTestSeedResult } from '/_102034_/l1/mdm/layer_3_usecases/localTestSeed.js';

export interface LocalTestSeedEnvironment {
  declared: boolean;
  mode: ProjectMode;
  runtimeMode: string;
  databaseUrlTest?: string;
  databaseUrl?: string;
}

/** Refuse before any write. Uses only the declared mode and DATABASE_URL_TEST. */
export function assertLocalSeedEnvironment(input: LocalTestSeedEnvironment): { database: string } {
  if (!input.declared) {
    throw new Error('project mode is not explicitly declared; local test seed refuses the default');
  }
  if (!isTestMode(input.mode)) {
    throw new Error(`appEnv='${input.mode}' is not development or presentation`);
  }
  if (input.runtimeMode !== 'postgres') {
    throw new Error('local test seed requires RUNTIME_MODE=postgres');
  }
  if (!input.databaseUrlTest) {
    throw new Error(
      'DATABASE_URL_TEST is not set, and a local test seed must run against the TEST database. '
      + 'PG* and DATABASE_URL are never used as a fallback.',
    );
  }
  const selected = parseDatabaseUrl(input.databaseUrlTest);
  if (!selected?.database) {
    throw new Error('DATABASE_URL_TEST is not a usable connection string');
  }
  if (input.databaseUrl) {
    const production = parseDatabaseUrl(input.databaseUrl);
    if (input.databaseUrl === input.databaseUrlTest || production?.database === selected.database) {
      throw new Error('DATABASE_URL_TEST names the production database');
    }
  }
  return { database: selected.database };
}

export async function runLocalTestSeed(): Promise<LocalTestSeedResult> {
  const env = readAppEnv();
  const projects = readProjectsConfig();
  const projectId = projects.defaultProjectId;
  const mode = readProjectMode(projectId);
  const checked = assertLocalSeedEnvironment({
    declared: hasDeclaredProjectMode(projectId),
    mode,
    runtimeMode: env.runtimeMode,
    databaseUrlTest: process.env.DATABASE_URL_TEST,
    databaseUrl: process.env.DATABASE_URL,
  });
  const selected = resolveDatabaseUrl(mode);
  const selectedName = parseDatabaseUrl(selected)?.database;
  if (selectedName !== checked.database) {
    throw new Error('resolved database does not match DATABASE_URL_TEST');
  }
  console.error(`[seedLocalTest] database ${checked.database}`);

  const binding = resolveOrganizationBinding(projects);
  if (!binding) {
    throw new Error('onboarding organization binding is missing');
  }
  return ensureLocalTestPair(createDefaultRequestContext(), projects, binding);
}

const isMainModule = process.argv[1]?.endsWith('/seedLocalTest.js');

if (isMainModule) {
  runLocalTestSeed()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exit(0);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    });
}
