/// <mls fileReference="_102034_/l1/scripts/ensureDynamoTable.ts" enhancement="_blank" />
import {
  readAppEnv,
} from '/_102034_/l1/server/layer_1_external/config/env.js';
import { ensureRegisteredDynamoTables } from '/_102034_/l1/server/layer_1_external/persistence/dynamoAdmin.js';

export async function ensureDynamoTable(): Promise<void> {
  await ensureRegisteredDynamoTables(readAppEnv());
}

const isMainModule = process.argv[1]?.endsWith('/ensureDynamoTable.js');

if (isMainModule) {
  ensureDynamoTable()
    .then(() => {
      console.info('Registered DynamoDB tables are ready');
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
