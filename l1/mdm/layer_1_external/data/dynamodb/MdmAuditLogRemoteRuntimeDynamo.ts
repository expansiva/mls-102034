/// <mls fileReference="_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmAuditLogRemoteRuntimeDynamo.ts" enhancement="_blank" />
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import type { MdmAuditLogDocumentRecord } from '/_102034_/l1/mdm/module.js';
import { createDynamoDocumentClient } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/dynamoClient.js';

export class MdmAuditLogRemoteRuntimeDynamo {
  private readonly client: DynamoDBDocumentClient;

  public constructor(private readonly env: AppEnv) {
    this.client = createDynamoDocumentClient(env);
  }

  public async put(record: MdmAuditLogDocumentRecord): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.env.dynamoTableMdmAuditLog,
        Item: record,
      }),
    );
  }

  public async get(id: string): Promise<MdmAuditLogDocumentRecord | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.env.dynamoTableMdmAuditLog,
        Key: { id },
      }),
    );
    const item = result.Item;
    if (!item) {
      return null;
    }
    return item as MdmAuditLogDocumentRecord;
  }
}
