/// <mls fileReference="_102034_/l1/mdm/layer_1_external/queue/WriteBehindWorker.ts" enhancement="_blank" />
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { deleteDynamoItem, putDynamoItem } from '/_102034_/l1/server/layer_1_external/persistence/dynamoAdmin.js';
import { findResolvedTableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { createPostgresDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/postgres/MdmDataRuntimePostgres.js';
import { MdmAuditLogRemoteRuntimeDynamo } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmAuditLogRemoteRuntimeDynamo.js';
import { MdmAttachmentRemoteRuntimeDynamo } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmAttachmentRemoteRuntimeDynamo.js';
import { MdmCommentRemoteRuntimeDynamo } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmCommentRemoteRuntimeDynamo.js';
import { MdmDocumentRemoteRuntimeDynamo } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmDocumentRemoteRuntimeDynamo.js';
import { MdmNumberSequenceRemoteRuntimeDynamo } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmNumberSequenceRemoteRuntimeDynamo.js';
import { MdmRelationshipRemoteRuntimeDynamo } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmRelationshipRemoteRuntimeDynamo.js';
import { MdmTagRemoteRuntimeDynamo } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmTagRemoteRuntimeDynamo.js';
import type {
  MdmAttachmentRecord,
  MdmAuditLogDocumentRecord,
  MdmCommentRecord,
  MdmDocumentRecord,
  MdmNumberSequenceRecord,
  MdmOutboxRecord,
  MdmRelationshipDocumentRecord,
  MdmTagRecord,
} from '/_102034_/l1/mdm/module.js';

type RegistryTableOutboxPayload = {
  tableName: string;
  repositoryName: string;
  operation: 'upsert' | 'delete';
  key: Record<string, unknown>;
  item?: Record<string, unknown>;
};

function isLegacyPendingMergeOutbox(payload: MdmOutboxRecord): boolean {
  if (payload.topic !== 'mdm.pending-merge') {
    return false;
  }

  if (payload.aggregateType !== 'MdmDocument') {
    return false;
  }

  const candidate = payload.payload as Record<string, unknown> | null | undefined;
  return !candidate || typeof candidate.mdmId !== 'string' || candidate.mdmId.trim().length === 0;
}

export class WriteBehindWorker {
  private readonly runtime;
  private readonly remoteAuditRuntime;
  private readonly remoteRuntime;
  private readonly remoteRelationshipRuntime;
  private readonly remoteTagRuntime;
  private readonly remoteCommentRuntime;
  private readonly remoteAttachmentRuntime;
  private readonly remoteNumberSequenceRuntime;

  public constructor(private readonly env: AppEnv = readAppEnv()) {
    this.runtime = createPostgresDataRuntime(env);
    this.remoteAuditRuntime = new MdmAuditLogRemoteRuntimeDynamo(env);
    this.remoteRuntime = new MdmDocumentRemoteRuntimeDynamo(env);
    this.remoteRelationshipRuntime = new MdmRelationshipRemoteRuntimeDynamo(env);
    this.remoteTagRuntime = new MdmTagRemoteRuntimeDynamo(env);
    this.remoteCommentRuntime = new MdmCommentRemoteRuntimeDynamo(env);
    this.remoteAttachmentRuntime = new MdmAttachmentRemoteRuntimeDynamo(env);
    this.remoteNumberSequenceRuntime = new MdmNumberSequenceRemoteRuntimeDynamo(env);
  }

  private static readonly MAX_ATTEMPT_COUNT = 100;

  public async runOnce(limit = 50): Promise<{ processed: number; failed: number }> {
    const queueItems = (await this.runtime.mdmOutbox.findMany({
      where: {
        processedAt: null,
      },
      orderBy: {
        field: 'createdAt',
        direction: 'asc',
      },
      limit,
    })).filter((item) => item.attemptCount < WriteBehindWorker.MAX_ATTEMPT_COUNT);

    let processed = 0;
    let failed = 0;

    for (const payload of queueItems) {
      try {
        if (isLegacyPendingMergeOutbox(payload)) {
          // Legacy queue messages were written into mdm_outbox with the wrong
          // aggregate type and no document key. They are not write-behind jobs.
        } else if (payload.aggregateType === 'MdmDocument') {
          await this.remoteRuntime.put(payload.payload as unknown as MdmDocumentRecord);
        } else if (payload.aggregateType === 'MdmAuditLog') {
          await this.remoteAuditRuntime.put(
            payload.payload as unknown as MdmAuditLogDocumentRecord,
          );
        } else if (payload.aggregateType === 'MdmTag') {
          await this.remoteTagRuntime.put(payload.payload as unknown as MdmTagRecord);
        } else if (payload.aggregateType === 'MdmComment') {
          await this.remoteCommentRuntime.put(payload.payload as unknown as MdmCommentRecord);
        } else if (payload.aggregateType === 'MdmAttachment') {
          await this.remoteAttachmentRuntime.put(
            payload.payload as unknown as MdmAttachmentRecord,
          );
        } else if (payload.aggregateType === 'MdmNumberSequence') {
          await this.remoteNumberSequenceRuntime.put(
            payload.payload as unknown as MdmNumberSequenceRecord,
          );
        } else if (payload.aggregateType === 'MdmRelationship') {
          if (payload.eventType === 'DeleteRelationship') {
            const relationshipPayload = payload.payload as unknown as MdmRelationshipDocumentRecord;
            await this.remoteRelationshipRuntime.delete(payload.aggregateId, relationshipPayload.scope);
          } else {
            await this.remoteRelationshipRuntime.put(
              payload.payload as unknown as MdmRelationshipDocumentRecord,
            );
          }
        } else if (payload.aggregateType === 'RegistryTable') {
          await this.handleRegistryTablePayload(payload.payload as RegistryTableOutboxPayload);
        }
        await this.runtime.runInTransaction(async (trx) => {
          await trx.mdmOutbox.delete({
            where: { id: payload.id },
          });
        });
        processed += 1;
      } catch (error) {
        failed += 1;
        await this.runtime.runInTransaction(async (trx) => {
          await trx.mdmOutbox.update({
            where: { id: payload.id },
            patch: {
              attemptCount: payload.attemptCount + 1,
              lastError: error instanceof Error ? error.message : String(error),
              updatedAt: new Date().toISOString(),
            },
          });
        });
      }
    }

    return { processed, failed };
  }

  private async handleRegistryTablePayload(payload: RegistryTableOutboxPayload): Promise<void> {
    const definition = await findResolvedTableDefinition(payload.repositoryName, this.env);
    if (!definition.dynamoResolvedTableName) {
      return;
    }

    if (payload.operation === 'delete') {
      await deleteDynamoItem(this.env, definition, payload.key);
      return;
    }

    await putDynamoItem(this.env, definition, payload.item ?? payload.key);
  }
}
