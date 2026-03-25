/// <mls fileReference="_102034_/l1/scripts/migrate.ts" enhancement="_blank" />
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { bootstrapSchema } from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';

export async function runMigrations(): Promise<void> {
  await bootstrapSchema(readAppEnv(), {
    ensureDynamo: false,
    recordSnapshotLog: false,
  });
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
