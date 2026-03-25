/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/dynamoAdmin.ts" enhancement="_blank" />
import {
  type AttributeDefinition,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  type KeySchemaElement,
  waitUntilTableExists,
  waitUntilTableNotExists,
} from '@aws-sdk/client-dynamodb';
import { DeleteCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDocumentClient } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/dynamoClient.js';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import type { ResolvedTableDefinition, SchemaSnapshot } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import { loadResolvedDynamoTableDefinitions } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';

function createDynamoClient(env: AppEnv) {
  return new DynamoDBClient({
    region: env.awsRegion,
    credentials:
      env.awsAccessKeyId && env.awsSecretAccessKey
        ? {
            accessKeyId: env.awsAccessKeyId,
            secretAccessKey: env.awsSecretAccessKey,
            sessionToken: env.awsSessionToken,
          }
        : undefined,
  });
}

async function ensureDynamoTableDefinition(
  client: DynamoDBClient,
  definition: ResolvedTableDefinition,
) {
  if (!definition.dynamoResolvedTableName || !definition.dynamo) {
    return;
  }

  try {
    await client.send(
      new DescribeTableCommand({
        TableName: definition.dynamoResolvedTableName,
      }),
    );
    return;
  } catch (error) {
    const errorName =
      typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name?: unknown }).name)
        : '';
    const errorType =
      typeof error === 'object' && error !== null && '__type' in error
        ? String((error as { __type?: unknown }).__type)
        : '';
    if (
      errorName !== 'ResourceNotFoundException' &&
      !errorType.includes('ResourceNotFoundException')
    ) {
      throw error;
    }
  }

  const attributeDefinitions: AttributeDefinition[] = [
    {
      AttributeName: definition.dynamo.partitionKey,
      AttributeType: 'S',
    },
  ];
  const keySchema: KeySchemaElement[] = [
    {
      AttributeName: definition.dynamo.partitionKey,
      KeyType: 'HASH',
    },
  ];
  if (definition.dynamo.sortKey) {
    attributeDefinitions.push({
      AttributeName: definition.dynamo.sortKey,
      AttributeType: 'S',
    });
    keySchema.push({
      AttributeName: definition.dynamo.sortKey,
      KeyType: 'RANGE',
    });
  }

  await client.send(
    new CreateTableCommand({
      TableName: definition.dynamoResolvedTableName,
      AttributeDefinitions: attributeDefinitions,
      KeySchema: keySchema,
      BillingMode: 'PAY_PER_REQUEST',
    }),
  );

  await waitUntilTableExists(
    {
      client,
      maxWaitTime: 60,
    },
    {
      TableName: definition.dynamoResolvedTableName,
    },
  );
}

export async function ensureRegisteredDynamoTables(env: AppEnv): Promise<void> {
  const client = createDynamoClient(env);
  const definitions = await loadResolvedDynamoTableDefinitions(env);

  for (const definition of definitions) {
    await ensureDynamoTableDefinition(client, definition);
  }
}

export async function deleteRegisteredDynamoTables(env: AppEnv): Promise<void> {
  const client = createDynamoClient(env);
  const definitions = await loadResolvedDynamoTableDefinitions(env);

  for (const definition of definitions) {
    if (!definition.dynamoResolvedTableName) {
      continue;
    }

    try {
      await client.send(new DeleteTableCommand({ TableName: definition.dynamoResolvedTableName }));
      await waitUntilTableNotExists(
        {
          client,
          maxWaitTime: 60,
        },
        {
          TableName: definition.dynamoResolvedTableName,
        },
      );
    } catch (error) {
      const errorName =
        typeof error === 'object' && error !== null && 'name' in error
          ? String((error as { name?: unknown }).name)
          : '';
      const errorType =
        typeof error === 'object' && error !== null && '__type' in error
          ? String((error as { __type?: unknown }).__type)
          : '';
      if (
        errorName !== 'ResourceNotFoundException' &&
        !errorType.includes('ResourceNotFoundException')
      ) {
        throw error;
      }
    }
  }
}

export async function writeSchemaSnapshotLog(
  env: AppEnv,
  snapshot: SchemaSnapshot,
): Promise<void> {
  const definitions = await loadResolvedDynamoTableDefinitions(env);
  const snapshotDefinition = definitions.find((definition) => definition.repositoryName === 'schemaSnapshotLog');
  if (!snapshotDefinition?.dynamoResolvedTableName) {
    return;
  }

  const client = createDynamoDocumentClient(env);
  await client.send(
    new PutCommand({
      TableName: snapshotDefinition.dynamoResolvedTableName,
      Item: {
        snapshotId: snapshot.id,
        hash: snapshot.hash,
        appliedAt: snapshot.appliedAt,
        tables: snapshot.tables,
      },
    }),
  );
}

export async function deleteDynamoItem(
  env: AppEnv,
  definition: ResolvedTableDefinition,
  key: Record<string, unknown>,
): Promise<void> {
  if (!definition.dynamoResolvedTableName) {
    return;
  }

  const client = createDynamoDocumentClient(env);
  await client.send(
    new DeleteCommand({
      TableName: definition.dynamoResolvedTableName,
      Key: key,
    }),
  );
}

export async function putDynamoItem(
  env: AppEnv,
  definition: ResolvedTableDefinition,
  item: Record<string, unknown>,
): Promise<void> {
  if (!definition.dynamoResolvedTableName) {
    return;
  }

  const client = createDynamoDocumentClient(env);
  await client.send(
    new PutCommand({
      TableName: definition.dynamoResolvedTableName,
      Item: item,
    }),
  );
}

export async function scanAllDynamoItems(
  env: AppEnv,
  definition: ResolvedTableDefinition,
): Promise<Array<Record<string, unknown>>> {
  if (!definition.dynamoResolvedTableName) {
    return [];
  }

  const client = createDynamoDocumentClient(env);
  const items: Array<Record<string, unknown>> = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await client.send(
      new ScanCommand({
        TableName: definition.dynamoResolvedTableName,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    items.push(...((response.Items as Array<Record<string, unknown>> | undefined) ?? []));
    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return items;
}
