/// <mls fileReference="_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmRelationshipRemoteRuntimeDynamo.ts" enhancement="_blank" />
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  DeleteCommand,
  PutCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import type { MdmRelationshipDocumentRecord } from '/_102034_/l1/mdm/module.js';
import { createDynamoDocumentClient } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/dynamoClient.js';

export class MdmRelationshipRemoteRuntimeDynamo {
  private readonly client: DynamoDBDocumentClient;

  public constructor(private readonly env: AppEnv) {
    this.client = createDynamoDocumentClient(env);
  }

  private getTableName(scope: 'entity' | 'prospect') {
    return scope === 'prospect'
      ? this.env.dynamoTableMdmProspectRelationship
      : this.env.dynamoTableMdmRelationship;
  }

  public async put(record: MdmRelationshipDocumentRecord): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.getTableName(record.scope),
        Item: record,
      }),
    );
  }

  public async delete(id: string, scope: 'entity' | 'prospect'): Promise<void> {
    await this.client.send(
      new DeleteCommand({
        TableName: this.getTableName(scope),
        Key: { id },
      }),
    );
  }

  public async listAll(scope: 'entity' | 'prospect'): Promise<MdmRelationshipDocumentRecord[]> {
    const records: MdmRelationshipDocumentRecord[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.client.send(
        new ScanCommand({
          TableName: this.getTableName(scope),
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      records.push(...((result.Items as MdmRelationshipDocumentRecord[] | undefined) ?? []));
      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);

    return records;
  }
}
