/// <mls fileReference="_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmNumberSequenceRemoteRuntimeDynamo.ts" enhancement="_blank" />
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import type { MdmNumberSequenceRecord } from '/_102034_/l1/mdm/module.js';
import { createDynamoDocumentClient } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/dynamoClient.js';

export class MdmNumberSequenceRemoteRuntimeDynamo {
  private readonly client: DynamoDBDocumentClient;

  public constructor(private readonly env: AppEnv) {
    this.client = createDynamoDocumentClient(env);
  }

  public async put(record: MdmNumberSequenceRecord): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.env.dynamoTableMdmNumberSequence,
        Item: record,
      }),
    );
  }

  public async get(id: string): Promise<MdmNumberSequenceRecord | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.env.dynamoTableMdmNumberSequence,
        Key: { id },
      }),
    );
    return (result.Item as MdmNumberSequenceRecord | undefined) ?? null;
  }
}
