/// <mls fileReference="_102034_/l1/scripts/restoreFromDynamo.ts" enhancement="_blank" />
import { RestoreFromDynamoUsecase } from '/_102034_/l1/mdm/layer_1_external/queue/RestoreFromDynamoUsecase.js';
import { RegistryRestoreFromDynamoUsecase } from '/_102034_/l1/server/layer_1_external/persistence/restoreFromDynamo.js';

async function runRestore(): Promise<void> {
  const target = process.argv[2];
  if (!target) {
    throw new Error('Usage: npm run restore:from-dynamo -- <mdmId> | --relationships | --table <repositoryName>');
  }

  const usecase = new RestoreFromDynamoUsecase();
  const registryUsecase = new RegistryRestoreFromDynamoUsecase();
  if (target === '--relationships') {
    const count = await usecase.restoreAllRelationships();
    console.info(`Restored ${count} relationships from DynamoDB`);
    return;
  }

  if (target === '--table') {
    const tableName = process.argv[3];
    if (!tableName) {
      throw new Error('Usage: npm run restore:from-dynamo -- --table <repositoryName>');
    }
    const count = await registryUsecase.restoreTable(tableName);
    console.info(`Restored ${count} rows into ${tableName} from DynamoDB`);
    return;
  }

  await usecase.restoreById(target);
  console.info(`Restored ${target} from DynamoDB`);
}

const isMainModule = process.argv[1]?.endsWith('/restoreFromDynamo.js');

if (isMainModule) {
  runRestore()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
