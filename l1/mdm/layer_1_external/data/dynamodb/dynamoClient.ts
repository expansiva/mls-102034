/// <mls fileReference="_102034_/l1/mdm/layer_1_external/data/dynamodb/dynamoClient.ts" enhancement="_blank" />
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';

export function createDynamoDocumentClient(env: AppEnv): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: env.awsRegion,
      credentials:
        env.awsAccessKeyId && env.awsSecretAccessKey
          ? {
              accessKeyId: env.awsAccessKeyId,
              secretAccessKey: env.awsSecretAccessKey,
              sessionToken: env.awsSessionToken,
            }
          : undefined,
    }),
  );
}
