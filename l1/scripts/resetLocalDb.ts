/// <mls fileReference="_102034_/l1/scripts/resetLocalDb.ts" enhancement="_blank" />
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { bootstrapSchema } from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';
import { runMigrations } from '/_102034_/l1/scripts/migrate.js';

export async function resetLocalDb(): Promise<void> {
  await bootstrapSchema(readAppEnv(), {
    ensureDynamo: false,
    recordSnapshotLog: false,
  });
}

const isMainModule = process.argv[1]?.endsWith('/resetLocalDb.js');

if (isMainModule) {
  resetLocalDb()
    .then(() => {
      console.info('Local PostgreSQL schema reset');
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
