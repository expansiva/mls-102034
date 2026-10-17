/// <mls fileReference="_102034_/l1/scripts/migrate.ts" enhancement="_blank" />
import { Pool } from 'pg';
import { readAppEnv, type AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import {
  databaseUrlEnvFor, ensureTestDatabase, parseDatabaseUrl, readProjectMode,
} from '/_102034_/l1/server/layer_1_external/config/projectMode.js';
import { bootstrapSchema } from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';
import { formatMigrationReport } from '/_102034_/l1/server/layer_1_external/persistence/schemaModulePlan.js';
import { initializeOrganizationForProcess } from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';

/** Database name only — never host, user or password. */
function databaseNameForLog(env: AppEnv): string {
  const mode = readProjectMode(env.projectId);
  const url = process.env[databaseUrlEnvFor(mode)];
  if (url) {
    const parsed = parseDatabaseUrl(url);
    if (parsed?.database) return parsed.database;
  }
  return env.pgDatabase;
}

/**
 * Create the TEST database before bootstrapping into it.
 *
 * "Nothing manual per project": the whole chain of a generated app flows through the publish, so a
 * presentation module pointed at a test database nobody created provisions it here instead of demanding an
 * SSH session. Only in a test mode, only the DATABASE (the schema is the bootstrap right below), and a
 * missing privilege is REPORTED — the legible failure of `resolveDatabaseUrl` is then the correct answer.
 */
async function ensureTestDatabaseExists(): Promise<void> {
  const env = readAppEnv();
  const mode = readProjectMode(env.projectId);
  try {
    const outcome = await ensureTestDatabase(mode, async (adminUrl) => {
      const admin = new Pool({ connectionString: adminUrl });
      return {
        exists: async (database) => {
          const result = await admin.query<{ exists: boolean }>(
            'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS "exists"', [database],
          );
          return result.rows[0]?.exists === true;
        },
        // The name comes from the connection string this server was given, never from a request.
        create: async (database) => { await admin.query(`CREATE DATABASE "${database}"`); },
        end: async () => { await admin.end(); },
      };
    });
    if (outcome.created) console.info(`[migrate] created the test database '${outcome.database}' for appEnv='${mode}'`);
  } catch (error) {
    console.warn(`[migrate] could not auto-provision the test database (${error instanceof Error ? error.message : String(error)}); create it manually if the bootstrap below fails`);
  }
}

export async function runMigrations(): Promise<void> {
  await ensureTestDatabaseExists();
  const env = readAppEnv();
  const mode = readProjectMode(env.projectId);
  console.info(`[migrate] projeto ${env.projectId ?? '—'}, appEnv=${mode}, banco ${databaseNameForLog(env)}`);
  const result = await bootstrapSchema(env, {
    ensureDynamo: false,
    recordSnapshotLog: false,
  });
  console.info(formatMigrationReport(result.report));
  await initializeOrganizationForProcess();
}

const isMainModule = process.argv[1]?.endsWith('/migrate.js');

if (isMainModule) {
  runMigrations()
    .then(() => {
      console.info('Migrations applied');
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
