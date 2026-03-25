/// <mls fileReference="_102034_/l1/scripts/dbDelete.ts" enhancement="_blank" />
import { Pool } from 'pg';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { deleteRegisteredDynamoTables } from '/_102034_/l1/server/layer_1_external/persistence/dynamoAdmin.js';
import { setCliAppEnv } from '/_102034_/l1/scripts/envCli.js';

const DELETE_DB_CONFIRMATION = 'deletebd';

async function deletePostgresDatabase() {
  const env = readAppEnv();
  const adminPool = new Pool({
    host: env.pgHost,
    port: env.pgPort,
    database: 'postgres',
    user: env.pgUser,
    password: env.pgPassword,
  });

  try {
    await adminPool.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1
         AND pid <> pg_backend_pid()`,
      [env.pgDatabase],
    );
    await adminPool.query(`DROP DATABASE IF EXISTS "${env.pgDatabase}"`);
  } finally {
    await adminPool.end();
  }
}

async function deleteDynamoTables() {
  await deleteRegisteredDynamoTables(readAppEnv());
}

export async function dbDelete(inputEnv?: string, confirmation?: string): Promise<void> {
  const appEnv = setCliAppEnv(inputEnv);
  if (confirmation !== DELETE_DB_CONFIRMATION) {
    throw new Error(`Invalid confirmation. Use: ${DELETE_DB_CONFIRMATION}`);
  }

  await deletePostgresDatabase();
  await deleteDynamoTables();
  console.info(`Database and storage deleted for ${appEnv}`);
}

const isMainModule = process.argv[1]?.endsWith('/dbDelete.js');

if (isMainModule) {
  dbDelete(process.argv[2], process.argv[3])
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
