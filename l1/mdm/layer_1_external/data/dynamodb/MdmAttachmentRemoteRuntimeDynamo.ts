/// <mls fileReference="_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmAttachmentRemoteRuntimeDynamo.ts" enhancement="_blank" />
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import type { MdmAttachmentRecord } from '/_102034_/l1/mdm/module.js';
import { createDynamoDocumentClient } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/dynamoClient.js';

export class MdmAttachmentRemoteRuntimeDynamo {
  private readonly client: DynamoDBDocumentClient;

  public constructor(private readonly env: AppEnv) {
    this.client = createDynamoDocumentClient(env);
  }

  public async put(record: MdmAttachmentRecord): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.env.dynamoTableMdmAttachment,
        Item: record,
      }),
    );
  }

  public async get(id: string): Promise<MdmAttachmentRecord | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.env.dynamoTableMdmAttachment,
        Key: { id },
      }),
    );
    return (result.Item as MdmAttachmentRecord | undefined) ?? null;
  }
}
