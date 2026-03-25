/// <mls fileReference="_102034_/l1/mdm/layer_1_external/queue/RestoreFromDynamoUsecase.ts" enhancement="_blank" />
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { createPostgresDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/postgres/MdmDataRuntimePostgres.js';
import { MdmDocumentRemoteRuntimeDynamo } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmDocumentRemoteRuntimeDynamo.js';
import { MdmRelationshipRemoteRuntimeDynamo } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmRelationshipRemoteRuntimeDynamo.js';
import { buildEntityIndex, buildProspectIndex } from '/_102034_/l1/mdm/layer_3_usecases/mdmSupport.js';
import { MdmDocumentEntity } from '/_102034_/l1/mdm/layer_4_entities/MdmDocumentEntity.js';
import type {
  MdmDetailRecord,
  MdmDocumentRecord,
  MdmRelationshipDocumentRecord,
} from '/_102034_/l1/mdm/module.js';

export class RestoreFromDynamoUsecase {
  private readonly runtime;
  private readonly remoteRuntime;
  private readonly remoteRelationshipRuntime;

  public constructor(private readonly env: AppEnv = readAppEnv()) {
    this.runtime = createPostgresDataRuntime(env);
    this.remoteRuntime = new MdmDocumentRemoteRuntimeDynamo(env);
    this.remoteRelationshipRuntime = new MdmRelationshipRemoteRuntimeDynamo(env);
  }

  public async restoreDocument(document: MdmDocumentRecord): Promise<void> {
    const details = MdmDocumentEntity.parseDetails(document) as MdmDetailRecord;
    await this.runtime.runInTransaction(async (trx) => {
      await trx.mdmDocument.put({ record: document });
      if (
        details.status === 'New' ||
        details.status === 'InProgress' ||
        details.status === 'PendingMerge' ||
        details.status === 'Promoted' ||
        details.status === 'Expired' ||
        details.status === 'Discarded'
      ) {
        await trx.mdmProspectIndex.delete({ where: { mdmId: details.mdmId } });
        await trx.mdmProspectIndex.insert({ record: buildProspectIndex(details) });
        return;
      }

      await trx.mdmEntityIndex.delete({ where: { mdmId: details.mdmId } });
      await trx.mdmEntityIndex.insert({ record: buildEntityIndex(details) });
    });
  }

  public async restoreById(mdmId: string): Promise<void> {
    const document = await this.remoteRuntime.get(mdmId);
    if (!document) {
      throw new Error(`Document ${mdmId} not found in DynamoDB`);
    }
    await this.restoreDocument(document);
  }

  public async restoreRelationship(
    relationship: MdmRelationshipDocumentRecord,
  ): Promise<void> {
    await this.runtime.runInTransaction(async (trx) => {
      const targetRuntime =
        relationship.scope === 'entity'
          ? trx.mdmRelationship
          : trx.mdmProspectRelationship;
      await targetRuntime.delete({ where: { id: relationship.id } });
      await targetRuntime.insert({
        record: {
          id: relationship.id,
          fromId: relationship.fromId,
          toId: relationship.toId,
          type: relationship.type,
          role: relationship.role ?? null,
          metadata: relationship.metadata ?? {},
          isBidirectional: relationship.isBidirectional,
          validFrom: relationship.validFrom,
          validTo: relationship.validTo ?? null,
          status: relationship.status,
          createdAt: relationship.createdAt,
          updatedAt: relationship.updatedAt,
        },
      });
    });
  }

  public async restoreAllRelationships(): Promise<number> {
    const entityRelationships = await this.remoteRelationshipRuntime.listAll('entity');
    const prospectRelationships = await this.remoteRelationshipRuntime.listAll('prospect');
    const relationships = [...entityRelationships, ...prospectRelationships];
    for (const relationship of relationships) {
      await this.restoreRelationship(relationship);
    }
    return relationships.length;
  }
}
