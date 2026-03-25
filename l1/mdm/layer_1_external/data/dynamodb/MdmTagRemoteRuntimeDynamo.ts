/// <mls fileReference="_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmTagRemoteRuntimeDynamo.ts" enhancement="_blank" />
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import type { MdmTagRecord } from '/_102034_/l1/mdm/module.js';
import { createDynamoDocumentClient } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/dynamoClient.js';

export class MdmTagRemoteRuntimeDynamo {
  private readonly client: DynamoDBDocumentClient;

  public constructor(private readonly env: AppEnv) {
    this.client = createDynamoDocumentClient(env);
  }

  public async put(record: MdmTagRecord): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.env.dynamoTableMdmTag,
        Item: record,
      }),
    );
  }

  public async get(id: string): Promise<MdmTagRecord | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.env.dynamoTableMdmTag,
        Key: { id },
      }),
    );
    return (result.Item as MdmTagRecord | undefined) ?? null;
  }
}
