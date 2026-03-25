/// <mls fileReference="_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmDocumentRemoteRuntimeDynamo.ts" enhancement="_blank" />
import {
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import type { MdmDocumentRecord } from '/_102034_/l1/mdm/module.js';
import { createDynamoDocumentClient } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/dynamoClient.js';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export class MdmDocumentRemoteRuntimeDynamo {
  private readonly client: DynamoDBDocumentClient;

  public constructor(private readonly env: AppEnv) {
    this.client = createDynamoDocumentClient(env);
  }

  public async get(mdmId: string): Promise<MdmDocumentRecord | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.env.dynamoTableMdm,
        Key: { mdmId },
      }),
    );
    return (result.Item as MdmDocumentRecord | undefined) ?? null;
  }

  public async put(record: MdmDocumentRecord): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.env.dynamoTableMdm,
        Item: record,
      }),
    );
  }
}
