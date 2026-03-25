/// <mls fileReference="_102034_/l1/scripts/setupServer.ts" enhancement="_blank" />
import { Pool } from 'pg';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { bootstrapSchema } from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';

async function ensureDatabaseExists(): Promise<void> {
  const env = readAppEnv();
  const adminPool = new Pool({
    host: env.pgHost,
    port: env.pgPort,
    database: 'postgres',
    user: env.pgUser,
    password: env.pgPassword,
  });

  try {
    const result = await adminPool.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS "exists"',
      [env.pgDatabase],
    );

    if (result.rows[0]?.exists) {
      return;
    }

    await adminPool.query(`CREATE DATABASE "${env.pgDatabase}"`);
  } finally {
    await adminPool.end();
  }
}

async function validateDynamoConfig(): Promise<void> {
  const env = readAppEnv();
  if (env.awsAccessKeyId && !env.awsSecretAccessKey) {
    throw new Error('AWS_SECRET_ACCESS_KEY is required when AWS_ACCESS_KEY_ID is provided');
  }
}

export async function setupServer(): Promise<void> {
  const env = readAppEnv();
  await ensureDatabaseExists();
  await validateDynamoConfig();
  await bootstrapSchema(env, {
    ensureDynamo: true,
    recordSnapshotLog: true,
  });
}

const isMainModule = process.argv[1]?.endsWith('/setupServer.js');

if (isMainModule) {
  setupServer()
    .then(() => {
      console.info('Server setup completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
